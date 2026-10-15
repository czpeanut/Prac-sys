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

test("每天 20 題、只從範圍內出、不重複", () => {
  const me = { scope: [U], sets: {} };
  const set = P.newSet(pool, me, "2026-10-15", P.seeded(1));
  assert.equal(set.items.length, 20);
  assert.equal(new Set(set.items.map((i) => i.q)).size, 20);
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
  const picked = P.choose(pool, [U], new Map(), stats, "2026-10-15", 20, P.seeded(3));
  assert.ok(picked.filter((q) => pool.byId[q].type_code === types.at(-1)).length >= 2);
});

test("熟練規則與進度、連續天數", () => {
  const ids = pool.questions.filter((q) => q.unit === U && q.type_code === "T01").map((q) => q.id).slice(0, 5);
  const items = ids.map((q, i) => ({ q, unit: U, type: "T01", r: "A", ok: true, at: `2026-10-15T0${i}` }));
  const me = { scope: [U], sets: { "2026-10-14": { scope: [U], items: [{ ...items[0], at: "2026-10-14T00" }] }, "2026-10-15": { scope: [U], items } } };
  const p = P.progress(pool, me, "2026-10-15");
  assert.equal(p.units[0].types.find((t) => t.code === "T01").status, "已熟練");
  assert.equal(p.units[0].mastered, 1);
  assert.equal(p.streak, 2);
  assert.equal(P.today(new Date("2026-10-15T17:00:00Z")), "2026-10-16");   // 台灣時間已過午夜
});
