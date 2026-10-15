// 每日練習前端：名字登入 → 今日 20 題 → 題型進度 → 練習範圍
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY = "pracsys.student";
let me = null, meta = null, today = null;

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `錯誤 ${r.status}`);
  return data;
}
function store(v) { try { v ? localStorage.setItem(KEY, String(v)) : localStorage.removeItem(KEY); } catch {} }
function stored() { try { return localStorage.getItem(KEY); } catch { return null; } }

const unitName = (k) => { const u = meta.units.find((x) => x.key === k); return u ? `${u.code} ${u.title}` : k; };
const stars = (d) => (d ? "★".repeat(d) + "☆".repeat(5 - d) : "");

// ─────────── 登入 ───────────
function show(view) {
  $("#v-login").hidden = view !== "login";
  $("#v-main").hidden = view !== "main";
  $("#who").hidden = view !== "main";
}
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  $("#login-err").textContent = "";
  try { enter(await api("/api/login", { method: "POST", body: { name: $("#login-name").value } })); }
  catch (err) { $("#login-err").textContent = err.message; }
};
$("#logout").onclick = () => { store(null); me = null; show("login"); $("#login-name").value = ""; };

function enter(s) {
  me = s; store(s.id);
  $("#who-name").textContent = s.name;
  show("main"); tab("today");
}

// ─────────── 分頁 ───────────
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
function tab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  for (const t of ["today", "progress", "scope"]) $(`#t-${t}`).hidden = t !== name;
  ({ today: loadToday, progress: loadProgress, scope: loadScope })[name]();
}

// ─────────── 今日練習 ───────────
async function loadToday() {
  $("#items").innerHTML = '<p class="muted">出題中…</p>';
  today = await api(`/api/students/${me.id}/today`);
  $("#today-day").textContent = `${today.day} 的練習`;
  $("#today-scope").textContent = "範圍：" + today.scope.map(unitName).join("、");
  $("#items").innerHTML = "";
  today.items.forEach((it) => $("#items").appendChild(card(it)));
  summary();
}

function summary() {
  const n = today.items.length, done = today.items.filter((i) => i.correct !== null).length;
  const right = today.items.filter((i) => i.correct === true).length;
  $("#today-bar").style.width = n ? `${(100 * done) / n}%` : "0";
  $("#today-count").textContent = `完成 ${done}／${n} 題，答對 ${right} 題`;
  const box = $("#today-done");
  box.hidden = !(n && done === n);
  if (!box.hidden) box.innerHTML = `🎉 今天的 ${n} 題完成了！答對 ${right} 題（${Math.round((100 * right) / n)}%）。<br>
    <button class="link" onclick="tab('progress')">看練習進度</button>`;
}

function card(it) {
  const el = document.createElement("div");
  el.className = "card q";
  el.id = `q${it.id}`;
  if (it.missing) {
    el.innerHTML = `<div class="head"><span class="num">${it.ord}.</span></div><p class="muted">這題已從題庫移除。</p>`;
    return el;
  }
  const head = `<div class="head"><span><span class="num">${it.ord}.</span> ${esc(it.type_name)}</span>
    <span title="難度（AI 評估）">${stars(it.difficulty)}</span></div>`;
  let body = `<div class="stem">${it.stem_html}</div>`;
  if (it.qtype === "single") {
    body += `<div class="opts">${it.options.map((o) => {
      let cls = "opt";
      if (it.answered) {
        if (it.answer.includes(o.label)) cls += " right";
        else if (it.response === o.label) cls += " wrong";
      }
      return `<button class="${cls}" data-l="${esc(o.label)}" ${it.answered ? "disabled" : ""}>
        <span class="ol">(${esc(o.label)})</span><span>${o.html}</span></button>`;
    }).join("")}</div>`;
    if (!it.answered) body += `<div class="actions"><button class="primary submit" disabled>送出</button></div>`;
  } else if (!it.answered) {
    body += `<textarea class="fill-input" rows="2" placeholder="把答案寫在紙上或這裡，寫好再看答案"></textarea>
      <div class="actions"><button class="primary reveal">看答案</button></div>`;
  } else if (it.response) {
    body += `<div class="muted small">你寫的：${esc(it.response)}</div>`;
  }
  if (it.answered) body += result(it);
  el.innerHTML = head + body + `<div class="cite">出處 ${esc(it.cite)}</div>`;

  let choice = null;
  el.querySelectorAll(".opt:not([disabled])").forEach((b) => (b.onclick = () => {
    choice = b.dataset.l;
    el.querySelectorAll(".opt").forEach((x) => x.classList.toggle("sel", x === b));
    el.querySelector(".submit").disabled = false;
  }));
  const submit = el.querySelector(".submit, .reveal");
  if (submit) submit.onclick = async () => {
    submit.disabled = true;
    const response = it.qtype === "single" ? choice : el.querySelector("textarea").value;
    try { replace(await api(`/api/students/${me.id}/items/${it.id}/answer`, { method: "POST", body: { response } })); }
    catch (err) { alert(err.message); submit.disabled = false; }
  };
  el.querySelectorAll(".mark").forEach((b) => (b.onclick = async () => {
    try { replace(await api(`/api/students/${me.id}/items/${it.id}/mark`, { method: "POST", body: { correct: b.dataset.v === "1" } })); }
    catch (err) { alert(err.message); }
  }));
  return el;
}

function result(it) {
  const ai = it.answer_ai ? '<span class="ai">AI 作答，未經人工確認</span>' : "";
  const ans = `<span class="ans">正確答案：${it.answer_html}</span>${ai}`;
  if (it.correct === true) return `<div class="result ok">✔ 答對了！　${ans}</div>`;
  if (it.correct === false) return `<div class="result bad">✘ 答錯了，再想想看。　${ans}</div>`;
  return `<div class="result pending">${ans}
    <div class="actions">跟你的答案一樣嗎？
      <button class="mark" data-v="1">✔ 我答對了</button><button class="mark" data-v="0">✘ 我答錯了</button></div></div>`;
}

function replace(it) {
  const i = today.items.findIndex((x) => x.id === it.id);
  today.items[i] = it;
  $(`#q${it.id}`).replaceWith(card(it));
  summary();
}

// ─────────── 練習進度 ───────────
async function loadProgress() {
  const p = await api(`/api/students/${me.id}/progress`);
  const pct = p.type_count ? Math.round((100 * p.mastered) / p.type_count) : 0;
  const total = p.units.reduce((a, u) => a + u.attempts, 0);
  $("#prog-summary").innerHTML = `<div class="stats">
      <div><div class="muted small">已熟練題型</div><div class="big">${p.mastered}<span class="muted small"> ／ ${p.type_count}</span></div></div>
      <div><div class="muted small">總進度</div><div class="big">${pct}%</div></div>
      <div><div class="muted small">累計作答</div><div class="big">${total}</div></div>
      <div><div class="muted small">連續練習</div><div class="big">${p.streak}<span class="muted small"> 天</span></div></div>
    </div><div class="bar"><i style="width:${pct}%"></i></div>`;
  $("#prog-units").innerHTML = p.units.map((u) => {
    const up = u.type_count ? Math.round((100 * u.mastered) / u.type_count) : 0;
    const rows = u.types.map((t) => {
      const s = { 未練習: "s0", 練習中: "s1", 已熟練: "s2" }[t.status];
      const rate = t.rate === null ? "—" : `${Math.round(t.rate * 100)}%`;
      return `<tr><td>${esc(t.name)}<div class="muted small">${esc(t.desc)}</div></td>
        <td class="n">${t.correct}／${t.attempts}</td><td class="n">${rate}</td><td><span class="tag ${s}">${t.status}</span></td></tr>`;
    }).join("");
    return `<div class="card unit"><h3><span>${esc(u.book)} ${esc(u.code)} ${esc(u.title)}</span>
        <span class="muted small">熟練 ${u.mastered}／${u.type_count} 題型</span></h3>
      <div class="bar"><i style="width:${up}%"></i></div>
      <details ${u.attempts ? "open" : ""}><summary class="muted small">各題型進度</summary>
      <div class="scroll"><table class="types"><tr><th>題型</th><th>答對／作答</th><th>近 5 題</th><th></th></tr>${rows}</table></div>
      </details></div>`;
  }).join("");
  $("#prog-days").innerHTML = p.days.length
    ? p.days.map((d) => `<span>${d.day.slice(5)}　${d.ok ?? 0}／${d.n}</span>`).join("")
    : '<span class="muted">還沒有紀錄</span>';
}

// ─────────── 練習範圍 ───────────
async function loadScope() {
  me = await api(`/api/students/${me.id}`);
  $("#scope-msg").textContent = "";
  $("#scope-list").innerHTML = meta.units.map((u) => `<label class="scope-row">
      <input type="checkbox" value="${esc(u.key)}" ${me.scope.includes(u.key) ? "checked" : ""}>
      <span><b>${esc(u.book)} ${esc(u.code)}</b> ${esc(u.title)}<br><span class="muted small">${u.types.length} 個題型、${u.n} 題</span></span>
    </label>`).join("");
}
$("#scope-save").onclick = async () => {
  const units = [...document.querySelectorAll("#scope-list input:checked")].map((x) => x.value);
  try {
    me = await api(`/api/students/${me.id}/scope`, { method: "PUT", body: { units } });
    try {
      await api(`/api/students/${me.id}/today/regenerate`, { method: "POST" });
      $("#scope-msg").textContent = "已儲存，今天的題目已依新範圍重新出題。";
    } catch (err) {
      $("#scope-msg").textContent = `已儲存。${err.message}。`;
    }
  } catch (err) { $("#scope-msg").textContent = err.message; }
};

// ─────────── 啟動 ───────────
(async () => {
  meta = await api("/api/meta");
  const id = stored();
  if (id) {
    try { return enter(await api(`/api/students/${id}`)); } catch { store(null); }
  }
  show("login");
})();
