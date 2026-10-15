// 每日練習前端（GitHub Pages 純靜態）：名字登入 → 今日 20 題 → 題型進度 → 練習範圍
// 練習紀錄存在這台裝置的瀏覽器（localStorage），以名字區分。
import * as P from "./practice.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY = "pracsys.v1";
let pool, db, me, todaySet;

// ─────────── 紀錄 ───────────
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { current: null, students: {} }; }
  catch { return { current: null, students: {} }; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch { alert("這個瀏覽器無法儲存練習紀錄（可能是無痕模式），關掉頁面後紀錄會消失。"); }
}
const norm = (name) => name.replace(/\s+/g, " ").trim();
const keyOf = (name) => norm(name).toLowerCase();

// ─────────── 登入 ───────────
function show(view) {
  $("#v-login").hidden = view !== "login";
  $("#v-main").hidden = view !== "main";
  $("#who").hidden = view !== "main";
}
function renderKnown() {
  const names = Object.values(db.students).map((s) => s.name);
  $("#known").innerHTML = names.length ? "這台裝置上的同學：" + names.map((n) =>
    `<button class="link pick" data-n="${esc(n)}">${esc(n)}</button>`).join("　") : "";
  document.querySelectorAll(".pick").forEach((b) => (b.onclick = () => enter(b.dataset.n)));
}
$("#login-form").onsubmit = (e) => {
  e.preventDefault();
  const name = norm($("#login-name").value);
  if (name.length < 1 || name.length > 20) { $("#login-err").textContent = "名字請填 1～20 個字"; return; }
  enter(name);
};
$("#logout").onclick = () => { db.current = null; save(); show("login"); $("#login-name").value = ""; renderKnown(); };

function enter(name) {
  const k = keyOf(name);
  if (!db.students[k]) db.students[k] = { name: norm(name), scope: [pool.units[0].key], sets: {}, created: new Date().toISOString() };
  db.current = k; save();
  me = db.students[k];
  $("#who-name").textContent = me.name;
  show("main"); tab("today");
}

// ─────────── 分頁 ───────────
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
function tab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  for (const t of ["today", "progress", "scope"]) $(`#t-${t}`).hidden = t !== name;
  ({ today: loadToday, progress: loadProgress, scope: loadScope })[name]();
}
window.tab = tab;

// ─────────── 今日練習 ───────────
const unitName = (k) => { const u = pool.units.find((x) => x.key === k); return u ? `${u.code} ${u.title}` : k; };
const typeName = (unit, code) => pool.units.find((u) => u.key === unit)?.types.find((t) => t.code === code)?.name ?? code;
const stars = (d) => (d ? "★".repeat(d) + "☆".repeat(5 - d) : "");

function loadToday() {
  const day = P.today();
  if (!me.sets[day]) { me.sets[day] = P.newSet(pool, me, day); save(); }
  todaySet = me.sets[day];
  $("#today-day").textContent = `${day} 的練習`;
  $("#today-scope").textContent = "範圍：" + todaySet.scope.map(unitName).join("、");
  $("#items").innerHTML = "";
  todaySet.items.forEach((it, i) => $("#items").appendChild(card(it, i)));
  summary();
}

function summary() {
  const items = todaySet.items, n = items.length;
  const done = items.filter((i) => i.ok !== null).length, right = items.filter((i) => i.ok).length;
  $("#today-bar").style.width = n ? `${(100 * done) / n}%` : "0";
  $("#today-count").textContent = `完成 ${done}／${n} 題，答對 ${right} 題`;
  const box = $("#today-done");
  box.hidden = !(n && done === n);
  if (!box.hidden) box.innerHTML = `🎉 今天的 ${n} 題完成了！答對 ${right} 題（${Math.round((100 * right) / n)}%）。<br>
    <button class="link" onclick="tab('progress')">看練習進度</button>`;
}

function card(it, idx) {
  const el = document.createElement("div");
  el.className = "card q";
  const q = pool.byId[it.q];
  if (!q) {
    el.innerHTML = `<div class="head"><span class="num">${idx + 1}.</span></div><p class="muted">這題已從題庫移除。</p>`;
    return el;
  }
  const answered = it.r !== null;
  const opts = q.options.map((o) => {
    let cls = "opt";
    if (answered) {
      if (q.answer.includes(o.label)) cls += " right";
      else if (it.r === o.label) cls += " wrong";
    }
    return `<button class="${cls}" data-l="${esc(o.label)}" ${answered ? "disabled" : ""}>
      <span class="ol">(${esc(o.label)})</span><span>${o.html}</span></button>`;
  }).join("");
  const result = !answered ? `<div class="actions"><button class="primary submit" disabled>送出</button></div>`
    : it.ok ? `<div class="result ok">✔ 答對了！</div>`
    : `<div class="result bad">✘ 答錯了，正確答案是 (${esc(q.answer.join("、"))})。</div>`;
  el.innerHTML = `<div class="head"><span><span class="num">${idx + 1}.</span> ${esc(typeName(it.unit, it.type))}</span>
      <span title="難度">${stars(q.difficulty)}</span></div>
    <div class="stem">${q.stem_html}</div><div class="opts">${opts}</div>${result}
    <div class="cite">出處 ${esc(q.cite)}</div>`;

  let choice = null;
  el.querySelectorAll(".opt:not([disabled])").forEach((b) => (b.onclick = () => {
    choice = b.dataset.l;
    el.querySelectorAll(".opt").forEach((x) => x.classList.toggle("sel", x === b));
    el.querySelector(".submit").disabled = false;
  }));
  const submit = el.querySelector(".submit");
  if (submit) submit.onclick = () => {
    if (!choice) return;
    Object.assign(it, { r: choice, ok: q.answer.includes(choice), at: new Date().toISOString() });
    save();
    el.replaceWith(card(it, idx));
    summary();
  };
  return el;
}

// ─────────── 練習進度 ───────────
function loadProgress() {
  const p = P.progress(pool, me, P.today());
  const pct = p.typeCount ? Math.round((100 * p.mastered) / p.typeCount) : 0;
  const total = p.units.reduce((a, u) => a + u.attempts, 0);
  $("#prog-summary").innerHTML = `<div class="stats">
      <div><div class="muted small">已熟練題型</div><div class="big">${p.mastered}<span class="muted small"> ／ ${p.typeCount}</span></div></div>
      <div><div class="muted small">總進度</div><div class="big">${pct}%</div></div>
      <div><div class="muted small">累計作答</div><div class="big">${total}</div></div>
      <div><div class="muted small">連續練習</div><div class="big">${p.streak}<span class="muted small"> 天</span></div></div>
    </div><div class="bar"><i style="width:${pct}%"></i></div>`;
  $("#prog-units").innerHTML = p.units.map((u) => {
    const up = u.typeCount ? Math.round((100 * u.mastered) / u.typeCount) : 0;
    const rows = u.types.map((t) => {
      const s = { 未練習: "s0", 練習中: "s1", 已熟練: "s2" }[t.status];
      const rate = t.rate === null ? "—" : `${Math.round(t.rate * 100)}%`;
      return `<tr><td>${esc(t.name)}<div class="muted small">${esc(t.desc)}</div></td>
        <td class="n">${t.correct}／${t.attempts}</td><td class="n">${rate}</td><td><span class="tag ${s}">${t.status}</span></td></tr>`;
    }).join("");
    return `<div class="card unit"><h3><span>${esc(u.book)} ${esc(u.code)} ${esc(u.title)}</span>
        <span class="muted small">熟練 ${u.mastered}／${u.typeCount} 題型</span></h3>
      <div class="bar"><i style="width:${up}%"></i></div>
      <details ${u.attempts ? "open" : ""}><summary class="muted small">各題型進度</summary>
      <div class="scroll"><table class="types"><tr><th>題型</th><th>答對／作答</th><th>近 5 題</th><th></th></tr>${rows}</table></div>
      </details></div>`;
  }).join("");
  $("#prog-days").innerHTML = p.days.length
    ? p.days.map((d) => `<span>${d.day.slice(5)}　${d.ok}／${d.n}</span>`).join("")
    : '<span class="muted">還沒有紀錄</span>';
}

// ─────────── 練習範圍 ───────────
function loadScope() {
  $("#scope-msg").textContent = "";
  $("#scope-list").innerHTML = pool.units.map((u) => `<label class="scope-row">
      <input type="checkbox" value="${esc(u.key)}" ${me.scope.includes(u.key) ? "checked" : ""}>
      <span><b>${esc(u.book)} ${esc(u.code)}</b> ${esc(u.title)}<br><span class="muted small">${u.types.length} 個題型、${u.n} 題</span></span>
    </label>`).join("");
}
$("#scope-save").onclick = () => {
  const units = [...document.querySelectorAll("#scope-list input:checked")].map((x) => x.value);
  if (!units.length) { $("#scope-msg").textContent = "至少要選一個單元"; return; }
  me.scope = units;
  const day = P.today(), set = me.sets[day];
  if (set && set.items.some((i) => i.r !== null)) {
    $("#scope-msg").textContent = "已儲存。今天已經開始作答，明天才會依新範圍出題。";
  } else {
    me.sets[day] = P.newSet(pool, me, day);
    $("#scope-msg").textContent = "已儲存，今天的題目已依新範圍重新出題。";
  }
  save();
};

// ─────────── 備份 ───────────
$("#backup").onclick = () => {
  const blob = new Blob([JSON.stringify({ [keyOf(me.name)]: me }, null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `練習紀錄_${me.name}_${P.today()}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};
$("#restore").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    for (const [k, s] of Object.entries(data)) {
      if (!s || typeof s.name !== "string" || typeof s.sets !== "object" || !Array.isArray(s.scope)) throw new Error();
      db.students[k] = s;
    }
    save();
    $("#scope-msg").textContent = `已還原：${Object.values(data).map((s) => s.name).join("、")}`;
    if (db.students[db.current]) me = db.students[db.current];
  } catch { $("#scope-msg").textContent = "檔案格式不對，沒有還原。"; }
  e.target.value = "";
};

// ─────────── 啟動 ───────────
(async () => {
  const raw = await fetch("pool.json").then((r) => r.json());
  pool = { ...raw, byId: Object.fromEntries(raw.questions.map((q) => [q.id, q])) };
  db = load();
  if (db.current && db.students[db.current]) return enter(db.students[db.current].name);
  show("login"); renderKnown();
})();
