// 每日練習前端（GitHub Pages 純靜態）：名字登入 → 今日 20 題 → 題型進度 → 練習範圍
// 練習紀錄存在 Supabase（docs/config.js 有設定時），否則存在這台裝置的瀏覽器；見 store.js。
import * as P from "./practice.js";
import { online, store } from "./store.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let pool, me, todaySet;

// ─────────── 紀錄 ───────────
// 每次作答都把當天整份寫回；寫不進去就顯示提示，下一次寫入會一併補上（整份覆寫）。
async function sync(what) {
  try {
    if (what === "scope") await store.saveScope(me);
    else await store.saveSet(me, what);
    $("#sync").hidden = true;
    return true;
  } catch (err) {
    $("#sync").hidden = false;
    $("#sync").textContent = `⚠ 紀錄沒有存進去（${err.message}）。請檢查網路，下一題作答時會再試一次。`;
    return false;
  }
}
const norm = (name) => name.replace(/\s+/g, " ").trim();

// ─────────── 登入 ───────────
function show(view) {
  $("#v-login").hidden = view !== "login";
  $("#v-main").hidden = view !== "main";
  $("#who").hidden = view !== "main";
}
// 登入畫面：既有的名字用選單選，第一次練習的人另外輸入名字
let knownNames = [];
async function renderKnown() {
  $("#login-loading").hidden = false;
  try { knownNames = await store.known(); }
  catch (err) { knownNames = []; $("#login-err").textContent = `讀不到名單：${err.message}`; }
  $("#login-loading").hidden = true;
  const has = knownNames.length > 0;
  $("#pick-name").innerHTML = '<option value="">— 請選擇 —</option>' +
    knownNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  $("#pick-form").hidden = !has;
  $("#login-title").textContent = has ? "選擇你的名字" : "輸入你的名字";
  $("#new-hint").hidden = !has;
  $("#new-wrap").hidden = false;
}
$("#pick-form").onsubmit = (e) => {
  e.preventDefault();
  if ($("#pick-name").value) enter($("#pick-name").value, e.submitter);
};
$("#login-form").onsubmit = (e) => {
  e.preventDefault();
  const name = norm($("#login-name").value);
  if (name.length < 1 || name.length > 20) { $("#login-err").textContent = "名字請填 1～20 個字"; return; }
  // 已經在名單上的名字（不分大小寫、空白）直接當成同一個人
  const same = knownNames.find((n) => norm(n).toLowerCase() === name.toLowerCase());
  enter(same ?? name, e.submitter);
};
$("#logout").onclick = () => { store.logout(); me = null; show("login"); $("#login-name").value = ""; renderKnown(); };

async function enter(name, btn) {
  if (btn) btn.disabled = true;
  $("#login-err").textContent = "";
  try { start(await store.login(name, [pool.units[0].key])); }
  catch (err) { $("#login-err").textContent = err.message; }
  finally { if (btn) btn.disabled = false; }
}

function start(student) {
  me = student;
  me.sets ||= {};
  $("#who-name").textContent = me.name;
  $("#backup-card").hidden = online;
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
  if (!me.sets[day]) { me.sets[day] = P.newSet(pool, me, day); sync(day); }
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
    sync(P.today());
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
$("#scope-save").onclick = async () => {
  const units = [...document.querySelectorAll("#scope-list input:checked")].map((x) => x.value);
  if (!units.length) { $("#scope-msg").textContent = "至少要選一個單元"; return; }
  me.scope = units;
  const day = P.today(), set = me.sets[day];
  if (set && set.items.some((i) => i.r !== null)) {
    $("#scope-msg").textContent = "已儲存。今天已經開始作答，明天才會依新範圍出題。";
  } else {
    me.sets[day] = P.newSet(pool, me, day);
    $("#scope-msg").textContent = "已儲存，今天的題目已依新範圍重新出題。";
    await sync(day);
  }
  if (!(await sync("scope"))) $("#scope-msg").textContent = "沒有存進去，請檢查網路後再按一次。";
};

// ─────────── 備份 ───────────
$("#backup").onclick = () => {
  const { id, ...rest } = me;
  const blob = new Blob([JSON.stringify({ [id]: rest }, null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `練習紀錄_${me.name}_${P.today()}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};
$("#restore").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    for (const s of Object.values(data)) {
      if (!s || typeof s.name !== "string" || typeof s.sets !== "object" || !Array.isArray(s.scope)) throw new Error();
    }
    store.restore(data);
    $("#scope-msg").textContent = `已還原：${Object.values(data).map((s) => s.name).join("、")}`;
    if (data[me.id]) me = { id: me.id, ...data[me.id] };
  } catch { $("#scope-msg").textContent = "檔案格式不對，沒有還原。"; }
  e.target.value = "";
};

// ─────────── 啟動 ───────────
(async () => {
  const raw = await fetch("pool.json").then((r) => r.json());
  pool = { ...raw, byId: Object.fromEntries(raw.questions.map((q) => [q.id, q])) };
  try {
    const s = await store.resume();
    if (s) return start(s);
  } catch (err) { $("#login-err").textContent = `連不上資料庫：${err.message}`; }
  show("login"); renderKnown();
})();
