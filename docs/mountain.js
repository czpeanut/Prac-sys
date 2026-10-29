// N64 風格的 3D 爬山畫面：低多邊形、頂點上色、低解析度放大（模糊）、霧。
//   const m = createMountain(container, { climbers: [{ name, height, active, me }], units });
//   m.update(climbers); m.dispose();
// height 0～1（熟練度換算），active＝本週有練習（在爬），否則坐著休息。
// 名字用 HTML 標籤疊在畫布上（3D 字在低解析度下會糊掉）。
import * as THREE from "./vendor/three.module.min.js";

const H = 10, R0 = 9;                     // 山高、山腳半徑
const INTERNAL_H = 240;                   // N64 的 240 線，畫好再放大
const BANDS = [0x4f9a3a, 0x3f7f34, 0x8a6a45, 0x8d8d8d, 0xf4f6f8];   // 草地 → 森林 → 岩石 → 碎石 → 雪

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}
const rand = (seed) => () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296;

// 山的剖面：高度 y 處的半徑（略凹的錐形）
const radiusAt = (y) => R0 * Math.pow(Math.max(0, 1 - y / H), 1.15);

function mountainMesh() {
  const radial = 16, rings = 12, rnd = rand(7);
  const pos = [], col = [], idx = [];
  const color = new THREE.Color();
  const jitter = [];
  for (let i = 0; i <= rings; i++) {
    jitter.push([]);
    for (let j = 0; j < radial; j++) jitter[i].push(i === rings ? 0 : 0.75 + rnd() * 0.5);
  }
  for (let i = 0; i <= rings; i++) {
    const y = (i / rings) * H, r = radiusAt(y);
    const band = Math.min(BANDS.length - 1, Math.floor((y / H) * BANDS.length + (rnd() - 0.5) * 0.3));
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const rr = r * (i === rings ? 0 : 0.88 + 0.24 * jitter[i][j] * 0.5);
      pos.push(Math.cos(a) * rr, y + (i && i < rings ? (rnd() - 0.5) * 0.35 : 0), Math.sin(a) * rr);
      color.setHex(BANDS[Math.max(0, band)]).offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
      col.push(color.r, color.g, color.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

function ground() {
  const g = new THREE.CircleGeometry(60, 24);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x5aa846 }));
  m.position.y = -0.02;
  return m;
}

function trees(scene) {
  const rnd = rand(11);
  const trunk = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
  const leaf = new THREE.MeshLambertMaterial({ color: 0x2f6e2a, flatShading: true });
  for (let k = 0; k < 40; k++) {
    const a = rnd() * Math.PI * 2, r = R0 + 2 + rnd() * 22, s = 0.7 + rnd() * 0.8;
    const t = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.6, 5), trunk);
    tr.position.y = 0.3;
    const cn = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 6), leaf);
    cn.position.y = 1.3;
    t.add(tr, cn);
    t.scale.setScalar(s);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    scene.add(t);
  }
}

function flag(color, labelHeight) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, labelHeight, 4), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  pole.position.y = labelHeight / 2;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.03), new THREE.MeshLambertMaterial({ color }));
  cloth.position.set(0.3, labelHeight - 0.2, 0);
  g.add(pole, cloth);
  return g;
}

// 方塊小人：身體顏色由名字決定
function climberMesh(name, me) {
  const rnd = rand(hash(name));
  const shirt = new THREE.Color().setHSL(rnd(), 0.65, 0.5);
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.28), mat(shirt));
  body.position.y = 0.62;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), mat(0xf1c9a0));
  head.position.y = 1.05;
  const hat = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.38), mat(shirt.clone().offsetHSL(0.5, 0, -0.1)));
  hat.position.y = 1.25;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.16), mat(0x7a4b25));
  pack.position.set(0, 0.66, -0.22);
  const legMat = mat(0x2c3e66);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.16), legMat);
  const legR = legL.clone();
  legL.geometry = legL.geometry.clone().translate(0, -0.2, 0);
  legR.geometry = legL.geometry;
  legL.position.set(-0.11, 0.38, 0); legR.position.set(0.11, 0.38, 0);
  g.add(body, head, hat, pack, legL, legR);
  if (me) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 16), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    g.userData.ring = ring;
  }
  g.userData.parts = { body, head, hat, pack, legL, legR };
  g.scale.setScalar(me ? 1.25 : 1.0);
  return g;
}

// 高度 h（0～1）→ 山坡上的位置：沿螺旋往上，每人起點角度由名字決定
function place(name, h) {
  const y = H * (0.02 + 0.93 * h);
  const theta = (hash(name) % 360) * (Math.PI / 180) + h * Math.PI * 2.5;
  const r = radiusAt(y) * 0.98 + 0.15;
  return { pos: new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r), theta };
}

function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 64;
  const x = c.getContext("2d");
  const grd = x.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, "#2b5fd9"); grd.addColorStop(0.6, "#7fb2ff"); grd.addColorStop(1, "#d8ecff");
  x.fillStyle = grd; x.fillRect(0, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createMountain(container, { climbers = [], units = [] } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "mtn-canvas";
  const labels = document.createElement("div");
  labels.className = "mtn-labels";
  container.append(canvas, labels);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xcfe4ff, 22, 60);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6b2a, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(10, 18, 6);
  scene.add(sun);
  scene.add(mountainMesh(), ground());
  trees(scene);

  // 每一段山坡＝一個章節，段落交界插營地旗；山頂插大旗
  const camps = [];
  units.forEach((u, i) => {
    const y = H * (0.02 + 0.93 * (i / units.length));
    const a = -Math.PI / 2 + i * 1.3, r = radiusAt(y) * 0.98;
    const f = flag(0xe23b3b, 0.9);
    f.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    scene.add(f);
    camps.push({ obj: f, text: u.code });
  });
  const top = flag(0xffd400, 1.6);
  top.position.set(0, H - 0.1, 0);
  scene.add(top);
  camps.push({ obj: top, text: "山頂" });

  let people = [];
  function update(list) {
    for (const p of people) { scene.remove(p.mesh); p.label.remove(); }
    // 人太多時只標名字：自己、高度前 10 名
    const shown = new Set([...list].sort((a, b) => b.height - a.height).slice(0, 10).map((c) => c.name));
    people = list.map((c) => {
      const mesh = climberMesh(c.name, c.me);
      const { pos, theta } = place(c.name, c.height);
      mesh.position.copy(pos);
      mesh.rotation.y = -theta + (c.active ? 0 : Math.PI / 2);   // 爬的人面向前進方向，休息的人面向外
      scene.add(mesh);
      const label = document.createElement("span");
      label.className = `mtn-name${c.me ? " me" : ""}`;
      label.textContent = c.name;
      label.hidden = !(c.me || shown.has(c.name) || list.length <= 20);
      labels.append(label);
      return { ...c, mesh, label, phase: (hash(c.name) % 100) / 16 };
    });
    const me = people.find((p) => p.me);
    if (me) angle = Math.atan2(me.mesh.position.z, me.mesh.position.x);   // 鏡頭先轉到自己
    camY = me ? Math.min(H * 0.9, me.mesh.position.y + 3) : H * 0.55;
  }

  // 鏡頭：繞著山轉，可拖曳；沒在拖就慢慢自轉（使用者偏好減少動態時不轉）
  let angle = 0, camY = H * 0.55, dist = 19, dragging = null;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  canvas.addEventListener("pointerdown", (e) => { dragging = { x: e.clientX, y: e.clientY, a: angle, cy: camY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    angle = dragging.a - (e.clientX - dragging.x) * 0.01;
    camY = Math.max(1, Math.min(H * 1.3, dragging.cy + (e.clientY - dragging.y) * 0.04));
  });
  canvas.addEventListener("pointerup", () => { dragging = null; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); dist = Math.max(12, Math.min(40, dist + e.deltaY * 0.02)); }, { passive: false });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight || 360;
    const scale = Math.min(1, INTERNAL_H / h);                   // 內部只畫 240 線，CSS 放大 → N64 的模糊感
    renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const v = new THREE.Vector3();
  function placeLabel(el, obj, dy) {
    obj.getWorldPosition(v);
    v.y += dy;
    v.project(camera);
    const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    el.style.display = visible ? "" : "none";
    el.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * container.clientWidth}px, ${(-v.y * 0.5 + 0.5) * container.clientHeight}px)`;
  }
  const campLabels = camps.map((c) => {
    const el = document.createElement("span");
    el.className = "mtn-camp";
    el.textContent = c.text;
    labels.append(el);
    return el;
  });

  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const t = clock.getElapsedTime();
    if (!dragging && !still) angle += 0.0025;
    camera.position.set(Math.cos(angle) * dist, camY + 4, Math.sin(angle) * dist);
    camera.lookAt(0, Math.min(camY, H * 0.75), 0);
    for (const p of people) {
      const { legL, legR, body, head, hat, pack } = p.mesh.userData.parts;
      if (p.active) {                                            // 走路：腳前後擺、身體上下晃
        const s = Math.sin(t * 6 + p.phase);
        legL.rotation.x = s * 0.6; legR.rotation.x = -s * 0.6;
        p.mesh.position.y = place(p.name, p.height).pos.y + Math.abs(s) * 0.06;
      } else {                                                   // 坐著休息：腳往前伸、身體放低
        legL.rotation.x = legR.rotation.x = -Math.PI / 2;
        for (const part of [body, head, hat, pack]) part.position.y = part.userData.y0 ?? (part.userData.y0 = part.position.y), part.position.y = part.userData.y0 - 0.25;
      }
      if (p.mesh.userData.ring) p.mesh.userData.ring.rotation.z = t;
      placeLabel(p.label, p.mesh, 1.3);
    }
    camps.forEach((c, i) => placeLabel(campLabels[i], c.obj, c.text === "山頂" ? 1.8 : 1.1));
    renderer.render(scene, camera);
  }
  update(climbers);
  frame();

  return {
    update,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      canvas.remove(); labels.remove();
    },
  };
}

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch { return false; }
}
