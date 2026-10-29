// 排行榜表格與爬山畫面（學生頁、老師投影共用）
import * as P from "./practice.js";
import { esc } from "./ui.js";

const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`;

// rows：[{name, done, goalDays, height}]；只列前 top 名，自己不在裡面就另外列在最後
export function boardTable(rows, { me = null, top = 10, day = P.today() } = {}) {
  const w = P.weekOf(day);
  const ranked = P.rank(rows.filter((r) => r.done > 0));
  const head = ranked.slice(0, top);
  const mine = me ? ranked.find((r) => r.name === me) : null;
  const tr = (r) => `<tr class="${r.name === me ? "me" : ""}"><td class="rk">${r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td>
      <td>${esc(r.name)}</td><td class="n">${r.done}</td><td class="n">${r.goalDays}</td></tr>`;
  let body = head.map(tr).join("");
  if (mine && !head.includes(mine)) body += `<tr><td colspan="4" class="muted small">⋯</td></tr>${tr(mine)}`;
  if (!ranked.length) body = `<tr><td colspan="4" class="muted">本週還沒有人作答，搶第一個！</td></tr>`;
  const myLine = me ? (mine ? `你是第 <b>${mine.rank}</b> 名（共 ${ranked.length} 人本週有練習）` : "你本週還沒作答，做一題就會上榜。") : `本週有練習：${ranked.length} 人`;
  return `<h3>本週排行　<span class="muted small">第 ${w.index} 週（${md(w.start)} 五～${md(w.end)} 四），每週五重新開始</span></h3>
    <p class="small">${myLine}</p>
    <table class="list board"><tr><th></th><th>名字</th><th class="n">本週作答</th><th class="n">達標天數</th></tr>${body}</table>`;
}

// 爬山畫面：WebGL 不能用時退回 2D 長條
export async function mountainView(container, rows, { me = null, units = [], day = P.today() } = {}) {
  const climbers = rows.map((r) => ({ name: r.name, height: r.height ?? 0, active: r.done > 0, me: r.name === me }));
  try {
    const M = await import("./mountain.js");
    if (!M.webglAvailable()) throw new Error("no webgl");
    container.innerHTML = "";
    return M.createMountain(container, { climbers, units });
  } catch {
    container.classList.add("flat");
    container.innerHTML = [...climbers].sort((a, b) => b.height - a.height).map((c) => `<div class="flat-row${c.me ? " me" : ""}">
        <span>${esc(c.name)}</span><span class="meter"><i style="width:${Math.round(c.height * 100)}%"></i></span>${Math.round(c.height * 100)}%</div>`).join("");
    return { update() {}, dispose() {} };
  }
}
