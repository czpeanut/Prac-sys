// node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "../docs/practice.js";

const raw = JSON.parse(readFileSync(new URL("../docs/pool.json", import.meta.url)));
const pool = { ...raw, byId: Object.fromEntries(raw.questions.map((q) => [q.id, q])) };
const U = pool.units[0].key;

test("題目池只有純文字單選題，且答案是選項代號", () => {
  for (const q of pool.questions) {
    assert.equal(q.qtype, "single");
    assert.ok(q.answer.every((a) => q.options.some((o) => o.label === a)), q.id);
    assert.ok(!("answer_ai" in q));
  }
});

test("每天一份 DAILY_N 題、只從範圍內出、不重複", () => {
  const me = { scope: [U], sets: {} };
  const set = P.newSet(pool, me, "2026-10-15", P.seeded(1));
  assert.equal(set.items.length, P.DAILY_N);
  assert.equal(new Set(set.items.map((i) => i.q)).size, P.DAILY_N);
  assert.ok(set.items.every((i) => i.unit === U));
});

test("答錯的題目隔天優先再出（最多 4 題），答對的不重出", () => {
  const ids = pool.questions.filter((q) => q.unit === U).map((q) => q.id);
  const items = ids.slice(0, 10).map((q, i) => ({ q, unit: U, type: pool.byId[q].type_code, r: "A", ok: i >= 6, at: `2026-10-14T0${i}` }));
  const me = { scope: [U], sets: { "2026-10-14": { scope: [U], items } } };
  const next = P.newSet(pool, me, "2026-10-15", P.seeded(2)).items.map((i) => i.q);
  assert.equal(ids.slice(0, 6).filter((q) => next.includes(q)).length, P.REVIEW_MAX);
  assert.equal(ids.slice(6, 10).filter((q) => next.includes(q)).length, 0);
});

test("沒熟練的題型抽得比已熟練的多", () => {
  const types = pool.units[0].types.filter((t) => t.code !== P.OTHER).map((t) => t.code);
  const stats = new Map();
  for (const c of types.slice(0, -1)) {
    const st = new P.TypeStat();
    for (let i = 0; i < 5; i++) st.add({ q: `x${i}`, ok: true, day: "2026-10-15" });
    stats.set(`${U}|${c}`, st);
  }
  const picked = P.choose(pool, [U], new Map(), stats, "2026-10-15", 10, P.seeded(3));
  assert.ok(picked.filter((q) => pool.byId[q].type_code === types.at(-1)).length >= 2);
});

test("熟練度量尺：考量總作答數、不同題目、近期穩定度與間隔", () => {
  const run = (pattern, { days, same } = {}) => {
    const st = new P.TypeStat();
    [...pattern].forEach((c, i) => st.add({ q: same ? "q" : `q${i}`, ok: c === "1", day: days?.[i] ?? "2026-10-23" }));
    st.today = "2026-10-23";
    return st;
  };
  assert.equal(new P.TypeStat().status, "未練習");
  assert.equal(run("11").status, "起步");                 // 兩題全對：證據不足
  assert.equal(run("111").status, "接近熟練");            // 三題全對：還不夠確認
  assert.equal(run("11111").status, "熟練");              // 五題全對
  assert.equal(run("11110").status, "接近熟練");          // 4/5：Wilson 下界 0.51 不足
  assert.equal(run("10100101").status, "學習中");          // 一半對一半錯
  assert.equal(run("0100100010001000").status, "學習中");  // 接近亂猜
  assert.ok(run("0100100010001000").stuck);                // 練很多還是常錯：卡關
  assert.equal(run("1011110111").status, "熟練");          // 9/10
  assert.equal(run("11111", { same: true }).status, "接近熟練");   // 同一題答對五次不算熟練（要不同題目）
  const twelve = "111111111111";
  assert.equal(run(twelve).status, "熟練");                // 同一天做 12 題：還不到精熟
  const days = [...twelve].map((_, i) => ["2026-10-23", "2026-10-27", "2026-10-31"][Math.floor(i / 4)]);
  assert.equal(run(twelve, { days }).status, "精熟");      // 分散在 3 天、相隔 8 天
  const old = run("11111"); old.today = "2026-11-10";
  assert.ok(old.needsReview && !old.mastered);             // 18 天沒練：需複習，出題時當作未熟練
  assert.deepEqual([P.wilsonLower(5, 5), P.wilsonLower(8, 10), P.wilsonLower(7, 10)].map((x) => +x.toFixed(2)), [0.75, 0.6, 0.5]);
});

test("進度：單元熟練數＝熟練以上的題型數", () => {
  const ids = pool.questions.filter((q) => q.unit === U && q.type_code === "T01").map((q) => q.id).slice(0, 5);
  const items = ids.map((q, i) => ({ q, unit: U, type: "T01", r: "A", ok: true, at: `2026-10-15T0${i}` }));
  const me = { scope: [U], sets: { "2026-10-15": { scope: [U], items } } };
  const p = P.progress(pool, me, "2026-10-15");
  const t = p.units[0].types.find((x) => x.code === "T01");
  assert.deepEqual([t.status, t.level, t.attempts, t.correct], ["熟練", 4, 5, 5]);
  assert.equal(p.units[0].mastered, 1);
});

test("換章節：已作答的保留，其餘換成新範圍，總數不變", () => {
  const units = pool.units.map((u) => u.key);
  const me = { scope: [units[0]], sets: {} };
  me.sets["2026-10-15"] = P.newSet(pool, me, "2026-10-15", P.seeded(4));
  const done = me.sets["2026-10-15"].items.slice(0, 3);
  done.forEach((it, i) => Object.assign(it, { r: "A", ok: i === 0, at: `2026-10-15T0${i}` }));
  me.scope = [units[2], units[4]];
  const s = P.rescope(pool, me, "2026-10-15", P.seeded(5));
  assert.equal(s.items.length, P.DAILY_N);
  assert.deepEqual(s.items.slice(0, 3).map((i) => i.q), done.map((i) => i.q));
  assert.ok(s.items.slice(3).every((i) => [units[2], units[4]].includes(i.unit) && i.r === null));
  assert.equal(new Set(s.items.map((i) => i.q)).size, P.DAILY_N);
});

// 造一個在指定日期各作答 n 題的學生
function student(perDay) {
  const ids = pool.questions.map((q) => q.id);
  let k = 0;
  const sets = {};
  for (const [day, n] of Object.entries(perDay)) {
    sets[day] = { scope: [U], items: Array.from({ length: n }, (_, i) => ({ q: ids[k++], unit: U, type: "T01", r: "A", ok: true, at: `${day}T${String(i).padStart(2, "0")}` })) };
  }
  return { scope: [U], sets };
}

test("欠題：10/23（週五）起每天 10 題，週四不計，今天多做的才還債", () => {
  const S = P.GOAL_START, d = (n) => P.addDays(S, n);   // d(0)＝10/23 週五 … d(6)＝10/29 週四
  assert.equal(S, "2026-10-23");
  assert.deepEqual([P.weekdayName(d(0)), P.isRestDay(d(6)), P.goalOn(d(6))], ["五", true, 0]);
  let r = P.debt(student({ "2026-10-20": 3 }), "2026-10-22");   // 起算前的紀錄不算
  assert.deepEqual([r.started, r.owed, r.todayLeft, r.rest], [false, 0, 0, false]);
  r = P.debt(student({}), S);                          // 第一天：今天還沒做，但還不算欠
  assert.deepEqual([r.owed, r.todayLeft, r.level.key], [0, 10, "ok"]);
  r = P.debt(student({ [S]: 4 }), d(1));               // 昨天只做 4 題
  assert.deepEqual([r.owed, r.level.key], [6, "l1"]);
  r = P.debt(student({ [S]: 4 }), d(3));               // 之後兩天都沒做：6 + 10 + 10 = 26
  assert.deepEqual([r.owed, r.level.key], [26, "l2"]);
  r = P.debt(student({ [S]: 4, [d(3)]: 10 }), d(3));   // 今天做滿 10 題：今天的份，欠題不變
  assert.deepEqual([r.owed, r.todayLeft], [26, 0]);
  r = P.debt(student({ [S]: 4, [d(3)]: 30 }), d(3));   // 今天做 30 題：多的 20 題還債
  assert.equal(r.owed, 6);
  r = P.debt(student({}), d(6));                       // 週四：不用做，欠的是週五～週三 6 天
  assert.deepEqual([r.rest, r.todayLeft, r.owed, r.level.key], [true, 0, 60, "l4"]);
  r = P.debt(student({ [d(6)]: 15 }), d(6));           // 週四做的全部拿去還
  assert.equal(r.owed, 45);
  r = P.debt(student({}), d(7));                       // 下週五：週四沒有增加欠題
  assert.equal(r.owed, 60);
  assert.equal(P.debt(student({}), d(4)).level.key, "l3");
});

test("週期：週五到下週四，一週要做 60 題", () => {
  const S = P.GOAL_START, d = (n) => P.addDays(S, n);
  const r = P.debt(student({ [S]: 10, [d(1)]: 12, [d(7)]: 5 }), d(2));
  assert.deepEqual([r.week.index, r.week.start, r.week.end, r.week.goal, r.week.done], [1, S, d(6), 60, 22]);
  const r2 = P.debt(student({ [S]: 10, [d(7)]: 5 }), d(7));
  assert.deepEqual([r2.week.index, r2.week.start, r2.week.done], [2, d(7), 5]);
});

test("再練 10 題：加在後面、不重複，連續達標天數要每天滿 10 題", () => {
  const S = P.GOAL_START;
  const me = student({ [S]: 10 });
  me.sets[S] = P.extend(pool, me, S, 10, P.seeded(6));
  assert.equal(me.sets[S].items.length, 20);
  assert.equal(new Set(me.sets[S].items.map((i) => i.q)).size, 20);
  assert.equal(P.streak(student({ [S]: 10, [P.addDays(S, 1)]: 12 }), P.addDays(S, 1)), 2);
  assert.equal(P.streak(student({ [S]: 9, [P.addDays(S, 1)]: 12 }), P.addDays(S, 1)), 1);
  // 週三、週五都達標，中間的週四休息不中斷
  const d = (n) => P.addDays(S, n);
  assert.equal(P.streak(student({ [d(5)]: 10, [d(7)]: 10 }), d(7)), 2);
  assert.equal(P.streak(student({ [d(5)]: 10 }), d(6)), 1);       // 週四當天：算到週三
});
