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
    const st = new P.TypeStat(); st.attempts = 5; st.correctIds = new Set([1, 2, 3, 4, 5]); st.recent = [1, 1, 1, 1, 1];
    stats.set(`${U}|${c}`, st);
  }
  const picked = P.choose(pool, [U], new Map(), stats, "2026-10-15", 10, P.seeded(3));
  assert.ok(picked.filter((q) => pool.byId[q].type_code === types.at(-1)).length >= 2);
});

test("熟練規則與進度、連續天數", () => {
  const ids = pool.questions.filter((q) => q.unit === U && q.type_code === "T01").map((q) => q.id).slice(0, 5);
  const items = ids.map((q, i) => ({ q, unit: U, type: "T01", r: "A", ok: true, at: `2026-10-15T0${i}` }));
  const me = { scope: [U], sets: { "2026-10-15": { scope: [U], items } } };
  const p = P.progress(pool, me, "2026-10-15");
  assert.equal(p.units[0].types.find((t) => t.code === "T01").status, "已熟練");
  assert.equal(p.units[0].mastered, 1);
  assert.equal(P.today(new Date("2026-10-15T17:00:00Z")), "2026-10-16");   // 台灣時間已過午夜
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

test("欠題：每天 10 題從 GOAL_START 起算，今天多做的才還債", () => {
  const S = P.GOAL_START, d = (n) => P.addDays(S, n);
  assert.deepEqual([P.debt(student({}), d(-1)).owed, P.debt(student({}), d(-1)).started], [0, false]);   // 還沒開始
  let r = P.debt(student({}), S);                      // 第一天：今天還沒做，但還不算欠
  assert.deepEqual([r.owed, r.todayLeft, r.level.key], [0, 10, "ok"]);
  r = P.debt(student({ [S]: 4 }), d(1));               // 昨天只做 4 題
  assert.deepEqual([r.owed, r.level.key], [6, "l1"]);
  r = P.debt(student({ [S]: 4 }), d(3));               // 之後三天都沒做：6 + 10 + 10 = 26
  assert.deepEqual([r.owed, r.level.key], [26, "l2"]);
  r = P.debt(student({ [S]: 4, [d(3)]: 10 }), d(3));   // 今天做滿 10 題：今天的份，欠題不變
  assert.deepEqual([r.owed, r.todayLeft], [26, 0]);
  r = P.debt(student({ [S]: 4, [d(3)]: 30 }), d(3));   // 今天做 30 題：多的 20 題還債
  assert.equal(r.owed, 6);
  r = P.debt(student({}), d(7));                       // 7 天都沒做
  assert.deepEqual([r.owed, r.level.key], [70, "l4"]);
  assert.equal(P.debt(student({}), d(4)).level.key, "l3");
});

test("再練 10 題：加在後面、不重複，連續達標天數要每天滿 10 題", () => {
  const S = P.GOAL_START;
  const me = student({ [S]: 10 });
  me.sets[S] = P.extend(pool, me, S, 10, P.seeded(6));
  assert.equal(me.sets[S].items.length, 20);
  assert.equal(new Set(me.sets[S].items.map((i) => i.q)).size, 20);
  assert.equal(P.streak(student({ [S]: 10, [P.addDays(S, 1)]: 12 }), P.addDays(S, 1)), 2);
  assert.equal(P.streak(student({ [S]: 9, [P.addDays(S, 1)]: 12 }), P.addDays(S, 1)), 1);
});
