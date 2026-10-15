// 出題與進度計算（純函式，不碰瀏覽器，tests/ 用 node 直接測）。
//
// 每日出題（預設 20 題，只從學生選的練習範圍裡出）：
//   1. 先放「之前答錯、還沒再答對」的題目（最多 REVIEW_MAX 題，昨天以前的）
//   2. 其餘依題型輪流抽：還沒熟練的題型每輪抽 2 題、已熟練的 1 題，
//      弱的題型（正確率低、做得少）排前面；優先抽沒做過的題目，題型的新題用完才重出最久以前答對的題目
//   3. 依單元順序、難度由易到難排好
//
// 題型進度（每個學生 × 每個題型）：
//   答對題數＝答對過的「不同題目」數；近期正確率＝最近 RECENT 次作答的正確率
//   熟練＝答對題數 ≥ MASTER_CORRECT 且近期正確率 ≥ MASTER_RATE
// 單元進度＝已熟練的題型數／該單元的題型數（不含「其他題型」）。

export const DAILY_N = 20;
export const REVIEW_MAX = 4;
export const RECENT = 5;
export const MASTER_CORRECT = 4;
export const MASTER_RATE = 0.8;
export const OTHER = "OTHER";

// 台灣日期（固定 +8，沒有日光節約時間）
export function today(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 可重現的亂數（mulberry32），測試用
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 一個學生的全部作答紀錄（已作答的），由舊到新：[{q, unit, type, ok, day, at}]
export function records(student) {
  const out = [];
  for (const [day, set] of Object.entries(student.sets || {})) {
    for (const it of set.items) if (it.ok !== null && it.ok !== undefined) out.push({ ...it, day });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export class TypeStat {
  constructor() { this.attempts = 0; this.correctIds = new Set(); this.recent = []; }
  get rate() { return this.recent.length ? this.recent.reduce((a, b) => a + b, 0) / this.recent.length : null; }
  get mastered() { return this.correctIds.size >= MASTER_CORRECT && (this.rate ?? 0) >= MASTER_RATE; }
  get status() { return !this.attempts ? "未練習" : this.mastered ? "已熟練" : "練習中"; }
}

export function typeStats(recs) {
  const stats = new Map();
  for (let i = recs.length - 1; i >= 0; i--) {       // 由新到舊
    const r = recs[i], k = `${r.unit}|${r.type}`;
    if (!stats.has(k)) stats.set(k, new TypeStat());
    const st = stats.get(k);
    st.attempts++;
    if (r.ok) st.correctIds.add(r.q);
    if (st.recent.length < RECENT) st.recent.push(r.ok ? 1 : 0);
  }
  return stats;
}

// 題號 → [{day, ok}]，由舊到新
export function history(recs) {
  const h = new Map();
  for (const r of recs) {
    if (!h.has(r.q)) h.set(r.q, []);
    h.get(r.q).push({ day: r.day, ok: r.ok });
  }
  return h;
}

export function choose(pool, scope, hist, stats, day, n = DAILY_N, rng = Math.random, exclude = []) {
  const unitKeys = pool.units.map((u) => u.key);
  scope = unitKeys.filter((u) => scope.includes(u));
  if (!scope.length) scope = unitKeys.slice(0, 1);
  const byId = pool.byId;
  const inScope = pool.questions.filter((q) => scope.includes(q.unit)).map((q) => q.id);
  const last = (id) => hist.get(id)?.at(-1);
  const picked = [];
  const skip = new Set(exclude);

  // 1. 答錯還沒再答對的題目，隔天以後再出一次
  const wrong = inScope.filter((id) => !skip.has(id) && last(id) && !last(id).ok && last(id).day < day)
    .sort((a, b) => (last(a).day < last(b).day ? -1 : 1));
  picked.push(...wrong.slice(0, Math.min(REVIEW_MAX, n)));

  // 2. 依題型輪流抽
  const queues = new Map();
  for (const u of scope) {
    for (const t of pool.units.find((x) => x.key === u).types) {
      const ids = pool.questions.filter((q) => q.unit === u && q.type_code === t.code && !picked.includes(q.id) && !skip.has(q.id)).map((q) => q.id);
      const fresh = shuffle(ids.filter((id) => !hist.has(id)), rng);
      const old = ids.filter((id) => hist.has(id) && last(id).ok).sort((a, b) => (last(a).day < last(b).day ? -1 : 1));
      queues.set(`${u}|${t.code}`, [...fresh, ...old]);
    }
  }
  const stat = (k) => stats.get(k) || new TypeStat();
  const tie = new Map([...queues.keys()].map((k) => [k, rng()]));
  const weakness = (k) => [stat(k).mastered ? 1 : 0, k.endsWith(`|${OTHER}`) ? 1 : 0, stat(k).rate ?? -1, stat(k).attempts, tie.get(k)];
  const order = [...queues.keys()].sort((a, b) => {
    const x = weakness(a), y = weakness(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
  while (picked.length < n && [...queues.values()].some((q) => q.length)) {
    for (const k of order) {
      const take = stat(k).mastered || k.endsWith(`|${OTHER}`) ? 1 : 2;
      for (let i = 0; i < take && queues.get(k).length && picked.length < n; i++) picked.push(queues.get(k).shift());
    }
  }

  const unitOrd = new Map(unitKeys.map((u, i) => [u, i]));
  return picked.sort((a, b) => unitOrd.get(byId[a].unit) - unitOrd.get(byId[b].unit) || (byId[a].difficulty ?? 3) - (byId[b].difficulty ?? 3));
}

export function newSet(pool, student, day, rng = Math.random) {
  const recs = records(student);
  const ids = choose(pool, student.scope, history(recs), typeStats(recs), day, DAILY_N, rng);
  return { scope: [...student.scope], items: ids.map((id) => ({ q: id, unit: pool.byId[id].unit, type: pool.byId[id].type_code, r: null, ok: null, at: null })) };
}

// 換練習章節：今天已作答的題目保留，沒作答的換成新範圍的題目，總數仍是 DAILY_N
export function rescope(pool, student, day, rng = Math.random) {
  const set = student.sets?.[day];
  if (!set) return newSet(pool, student, day, rng);
  const kept = set.items.filter((i) => i.r !== null);
  const recs = records(student);
  const ids = choose(pool, student.scope, history(recs), typeStats(recs), day, DAILY_N - kept.length, rng, kept.map((i) => i.q));
  return { scope: [...student.scope], items: [...kept, ...ids.map((id) => ({ q: id, unit: pool.byId[id].unit, type: pool.byId[id].type_code, r: null, ok: null, at: null }))] };
}

export function streak(student, day) {
  const done = new Set(Object.entries(student.sets || {}).filter(([, s]) => s.items.some((i) => i.ok !== null)).map(([d]) => d));
  let d = done.has(day) ? day : addDays(day, -1), n = 0;
  while (done.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function progress(pool, student, day) {
  const stats = typeStats(records(student));
  let typeCount = 0, mastered = 0;
  const units = pool.units.map((u) => {
    const types = u.types.map((t) => {
      const st = stats.get(`${u.key}|${t.code}`) || new TypeStat();
      return { code: t.code, name: t.name, desc: t.desc, attempts: st.attempts, correct: st.correctIds.size, rate: st.rate, status: st.status };
    });
    const counted = types.filter((t) => t.code !== OTHER);
    const m = counted.filter((t) => t.status === "已熟練").length;
    typeCount += counted.length; mastered += m;
    return { key: u.key, book: u.book, code: u.code, title: u.title, types, mastered: m, typeCount: counted.length,
      attempts: types.reduce((a, t) => a + t.attempts, 0) };
  });
  const days = Object.entries(student.sets || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 60)
    .map(([d, s]) => ({ day: d, n: s.items.length, done: s.items.filter((i) => i.ok !== null).length, ok: s.items.filter((i) => i.ok).length }));
  return { units, mastered, typeCount, streak: streak(student, day), days };
}
