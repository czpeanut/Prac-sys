// 學生頁與老師總覽共用的畫面片段：題型熟練度表格、量尺說明
import * as P from "./practice.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);

export function levelTag(t) {
  const L = P.MASTERY_LEVELS[t.level];
  const flags = [t.review ? `<span class="tag flag-review" title="${P.MASTERY.reviewAfter} 天以上沒練，會安排複習">需複習</span>` : "",
    t.stuck ? `<span class="tag flag-stuck" title="作答 ${P.MASTERY.stuck.attempts} 題以上、近期正確率仍低於 ${P.MASTERY.stuck.rate * 100}%">卡關</span>` : ""].join("");
  return `<span class="tag ${L.key}" title="${esc(L.note)}">${esc(L.label)}</span>${flags}`;
}

// 一個單元的題型表：等級、掌握度、答對不同題數／作答數、近期正確率
export function typeTable(u, { desc = false } = {}) {
  const rows = u.types.map((t) => `<tr>
      <td title="${esc(t.desc)}">${esc(t.name)}${desc ? `<div class="muted small">${esc(t.desc)}</div>` : ""}</td>
      <td>${levelTag(t)}</td>
      <td class="n"><span class="meter" title="BKT 掌握度"><i style="width:${t.pL === null ? 0 : Math.round(t.pL * 100)}%"></i></span>${pct(t.pL)}</td>
      <td class="n">${t.correct}／${t.attempts}</td>
      <td class="n">${pct(t.rate)}${t.recentN ? `<div class="muted small">近 ${t.recentN} 題</div>` : ""}</td></tr>`).join("");
  return `<div class="scroll"><table class="types"><tr><th>題型</th><th>等級</th><th>掌握度</th><th>答對不同題／作答</th><th>近期正確率</th></tr>${rows}</table></div>`;
}

export function masteryLegend() {
  const M = P.MASTERY, g = M.mastered, e = M.expert;
  const rows = P.MASTERY_LEVELS.map((l) => `<tr><td><span class="tag ${l.key}">${esc(l.label)}</span></td><td>${esc(l.note)}</td></tr>`).join("");
  return `<details class="legend-box"><summary>熟練度量尺怎麼算？</summary>
    <table class="types">${rows}
      <tr><td><span class="tag flag-review">需複習</span></td><td>熟練以上，但 ${M.reviewAfter} 天以上沒練（會忘記），出題時會再安排</td></tr>
      <tr><td><span class="tag flag-stuck">卡關</span></td><td>已作答 ${M.stuck.attempts} 題以上，近期正確率仍低於 ${M.stuck.rate * 100}%，建議請老師講解</td></tr></table>
    <ul class="small">
      <li><b>掌握度</b>：每作答一題就更新一次「真的學會」的機率（貝氏知識追蹤）。四選一可能用猜的（猜對機率 25%），也可能會但粗心（10%），所以答對一題不會直接算學會，答錯一題也不會全盤否定。</li>
      <li><b>作答量</b>：作答不到 ${M.minAttempts} 題不下判斷；「熟練」至少要作答 ${g.attempts} 題、答對 ${g.distinct} 道<b>不同</b>的題目（換題目也會，才不是背答案）。</li>
      <li><b>穩定度</b>：看最近 ${P.RECENT} 次作答的正確率，並依作答量打折（Wilson 下界 ≥ ${g.lower * 100}%）：5 題全對、或 10 題對 8 題才算穩定；4/5 還不夠。</li>
      <li><b>保留</b>：「精熟」要作答 ${e.attempts} 題以上，答對分散在 ${e.days} 天以上、首尾相隔 ${e.span} 天以上——隔幾天還會，才是真的記住。</li>
    </ul></details>`;
}
