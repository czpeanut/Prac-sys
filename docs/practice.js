// 出題與進度計算（純函式，不碰瀏覽器，tests/ 用 node 直接測）。
//
// 每日出題（一份 DAILY_N 題，做完可以再加；只從學生選的練習範圍裡出）：
//   1. 先放「之前答錯、還沒再答對」的題目（最多 REVIEW_MAX 題，昨天以前的）
//   2. 其餘依題型輪流抽：還沒熟練（或需複習）的題型每輪抽 2 題、熟練以上的 1 題，
//      弱的題型（正確率低、做得少）排前面；優先抽沒做過的題目，題型的新題用完才重出最久以前答對的題目
//   3. 依單元順序、難度由易到難排好
//
// 題型熟練度量尺（每個學生 × 每個題型，詳見 README「熟練度量尺」）：
//   掌握度 P(L)：貝氏知識追蹤（BKT，Corbett & Anderson 1995），依作答先後逐題更新，
//                四選一單選題的猜對機率 P(G)=0.25、會但粗心的失誤 P(S)=0.10
//   證據門檻：總作答數（樣本太少不下判斷）、答對過的不同題目數（遷移，不是背答案）、
//             最近 10 次作答正確率的 Wilson 下界（作答越少越保守）
//   保留：答對分散在不同天（間隔效果）；久未練習標「需複習」（遺忘曲線）
//   等級：未練習 → 起步 → 學習中 → 接近熟練 → 熟練 → 精熟（MASTERY_LEVELS）
// 單元進度＝達「熟練」以上的題型數／該單元的題型數（不含「其他題型」）。
//
// 每日進度與欠題（debt）：從 GOAL_START 起，以一週為週期，每天要完成 DAILY_GOAL 題，
// 但 REST_WEEKDAYS（週四）不計題目。
//   欠題＝過去應完成的總數 −（累計作答 − 今天算進今天份的題數）
//   也就是今天先做滿今天的份，多做的才拿去還之前欠的（休息日做的全部拿去還）；
//   欠越多，量表等級越嚴重（DEBT_LEVELS）。

export const DAILY_N = 10;
export const DAILY_GOAL = 10;
export const GOAL_START = "2026-10-23";  // 週五；每個週期是週五到下週四
export const REST_WEEKDAYS = [4];        // 0＝週日 … 4＝週四：不計題目
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
export const MAX_PER_DAY = 100;          // 一天最多出幾題（資料庫一列的上限）
export const REVIEW_MAX = 3;
// 熟練度量尺參數
export const BKT = { init: 0.15, learn: 0.10, guess: 0.25, slip: 0.10 };
export const RECENT = 10;                // 近期表現看最近幾次作答
export const WILSON_Z = 1.28;            // 單尾 90% 信賴下界
export const MASTERY = {
  minAttempts: 3,                        // 少於這個數：證據不足，只標「起步」
  learning: 0.7,                         // P(L) 未達：學習中
  mastered: { pL: 0.85, attempts: 5, distinct: 4, lower: 0.6 },
  expert: { attempts: 12, days: 3, span: 7 },   // 精熟：答對分散在 ≥3 天、首尾相隔 ≥7 天
  reviewAfter: 14,                       // 熟練以上、超過幾天沒練：需複習
  stuck: { attempts: 8, rate: 0.5 },     // 作答夠多但近期正確率仍低於此：卡關，需要老師協助
};
export const MASTERY_LEVELS = [
  { key: "m0", label: "未練習", note: "還沒有作答" },
  { key: "m1", label: "起步", note: `作答不到 ${MASTERY.minAttempts} 題，還看不出程度` },
  { key: "m2", label: "學習中", note: `掌握度未達 ${MASTERY.learning * 100}%` },
  { key: "m3", label: "接近熟練", note: "掌握度夠了，但作答量或穩定度還不足以確認" },
  { key: "m4", label: "熟練", note: `掌握度 ≥ ${MASTERY.mastered.pL * 100}%、作答 ≥ ${MASTERY.mastered.attempts} 題、答對 ≥ ${MASTERY.mastered.distinct} 道不同題目、近期穩定答對` },
  { key: "m5", label: "精熟", note: `熟練，且作答 ≥ ${MASTERY.expert.attempts} 題、答對分散在 ${MASTERY.expert.days} 天以上（相隔 ≥ ${MASTERY.expert.span} 天）` },
];
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

// Wilson 分數區間下界：正確率的保守估計，作答越少越低（5 題全對 ≈ 0.75、4/5 ≈ 0.51、8/10 ≈ 0.60）
export function wilsonLower(k, n, z = WILSON_Z) {
  if (!n) return 0;
  const p = k / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

// BKT：作答一次後更新「已學會」的機率
export function bktUpdate(pL, ok, b = BKT) {
  const post = ok ? (pL * (1 - b.slip)) / (pL * (1 - b.slip) + (1 - pL) * b.guess)
    : (pL * b.slip) / (pL * b.slip + (1 - pL) * (1 - b.guess));
  return post + (1 - post) * b.learn;
}

export class TypeStat {
  constructor() {
    this.attempts = 0; this.correctIds = new Set(); this.recent = [];   // recent：由新到舊
    this.pL = BKT.init; this.okDays = new Set(); this.lastDay = null; this.today = null;
  }
  add(r) {                                // 依時間先後加入一次作答
    this.attempts++;
    this.pL = bktUpdate(this.pL, !!r.ok);
    if (r.ok) { this.correctIds.add(r.q); this.okDays.add(r.day); }
    this.recent.unshift(r.ok ? 1 : 0);
    if (this.recent.length > RECENT) this.recent.pop();
    this.lastDay = r.day;
  }
  get rate() { return this.recent.length ? this.recent.reduce((a, b) => a + b, 0) / this.recent.length : null; }
  get lower() { return wilsonLower(this.recent.reduce((a, b) => a + b, 0), this.recent.length); }
  get span() {
    const d = [...this.okDays].sort();
    return d.length ? Math.round((new Date(`${d.at(-1)}T00:00:00Z`) - new Date(`${d[0]}T00:00:00Z`)) / 864e5) : 0;
  }
  get levelIndex() {
    const M = MASTERY;
    if (!this.attempts) return 0;
    if (this.attempts < M.minAttempts) return 1;
    if (this.pL < M.learning) return 2;
    const g = M.mastered;
    if (!(this.pL >= g.pL && this.attempts >= g.attempts && this.correctIds.size >= g.distinct && this.lower >= g.lower)) return 3;
    const e = M.expert;
    return this.attempts >= e.attempts && this.okDays.size >= e.days && this.span >= e.span ? 5 : 4;
  }
  get level() { return MASTERY_LEVELS[this.levelIndex]; }
  get needsReview() {                     // 熟練以上但很久沒練：遺忘曲線，安排複習
    if (this.levelIndex < 4 || !this.lastDay || !this.today) return false;
    return (new Date(`${this.today}T00:00:00Z`) - new Date(`${this.lastDay}T00:00:00Z`)) / 864e5 >= MASTERY.reviewAfter;
  }
  get stuck() {                           // 練很多還是常錯：需要老師協助（不是再多練就會）
    return this.attempts >= MASTERY.stuck.attempts && this.levelIndex <= 2 && (this.rate ?? 0) < MASTERY.stuck.rate;
  }
  // 出題用：熟練以上且不需複習才當作「已熟練」，少出一點
  get mastered() { return this.levelIndex >= 4 && !this.needsReview; }
  get status() { return this.level.label; }
}

export function typeStats(recs, today = null) {
  const stats = new Map();
  for (const r of recs) {                 // 由舊到新
    const k = `${r.unit}|${r.type}`;
    if (!stats.has(k)) stats.set(k, new TypeStat());
    stats.get(k).add(r);
  }
  for (const st of stats.values()) st.today = today;
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
  const ids = choose(pool, student.scope, history(recs), typeStats(recs, day), day, DAILY_N, rng);
  return { scope: [...student.scope], items: ids.map((id) => ({ q: id, unit: pool.byId[id].unit, type: pool.byId[id].type_code, r: null, ok: null, at: null })) };
}

const item = (pool, id) => ({ q: id, unit: pool.byId[id].unit, type: pool.byId[id].type_code, r: null, ok: null, at: null });

// 換練習章節：今天已作答的題目保留，沒作答的換成新範圍的題目，總數不變
export function rescope(pool, student, day, rng = Math.random) {
  const set = student.sets?.[day];
  if (!set) return newSet(pool, student, day, rng);
  const kept = set.items.filter((i) => i.r !== null);
  const total = Math.max(set.items.length, DAILY_N);
  const recs = records(student);
  const ids = choose(pool, student.scope, history(recs), typeStats(recs, day), day, total - kept.length, rng, kept.map((i) => i.q));
  return { scope: [...student.scope], items: [...kept, ...ids.map((id) => item(pool, id))] };
}

// 今天的題目做完後再加 n 題（多練、或補之前欠的）
export function extend(pool, student, day, n = DAILY_N, rng = Math.random) {
  const set = student.sets[day];
  n = Math.min(n, MAX_PER_DAY - set.items.length);
  if (n <= 0) return set;
  const recs = records(student);
  const ids = choose(pool, student.scope, history(recs), typeStats(recs, day), day, n, rng, set.items.map((i) => i.q));
  return { ...set, items: [...set.items, ...ids.map((id) => item(pool, id))] };
}

// ─────────── 每日進度與欠題 ───────────

// 欠題量表：欠題數 ≥ min 就是這一級（由輕到重）
export const DEBT_LEVELS = [
  { min: 0, key: "ok", label: "進度正常", note: "沒有欠題" },
  { min: 1, key: "l1", label: "輕微落後", note: "欠不到一天的份" },
  { min: 10, key: "l2", label: "注意", note: "欠 1～2 天的份" },
  { min: 30, key: "l3", label: "嚴重落後", note: "欠 3～5 天的份" },
  { min: 60, key: "l4", label: "非常嚴重", note: "欠 6 天以上的份" },
];
export const DEBT_SCALE_MAX = 80;       // 量表畫到這裡為滿格

export function answeredOn(student, day) {
  return (student.sets?.[day]?.items ?? []).filter((i) => i.ok !== null && i.ok !== undefined).length;
}

export const weekdayName = (day) => WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()];
export const isRestDay = (day) => REST_WEEKDAYS.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
// 這一天應完成幾題（起算日前、休息日都是 0）
export const goalOn = (day) => (day < GOAL_START || isRestDay(day) ? 0 : DAILY_GOAL);
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);

// 這一天所在的週期（從 GOAL_START 起每 7 天一個週期）
export function weekOf(day) {
  const k = Math.max(0, Math.floor(daysBetween(GOAL_START, day) / 7));
  const start = addDays(GOAL_START, 7 * k);
  return { index: k + 1, start, end: addDays(start, 6) };
}

export function debt(student, day) {
  const started = day >= GOAL_START;
  const todayGoal = goalOn(day);
  const todayDone = started ? answeredOn(student, day) : 0;
  let required = 0, done = 0;
  for (let d = GOAL_START; d < day; d = addDays(d, 1)) {
    required += goalOn(d);
    done += answeredOn(student, d);
  }
  const extra = Math.max(0, todayDone - todayGoal);      // 今天的份做滿後，多做的拿去還之前欠的
  const owed = Math.max(0, required - done - extra);
  const level = [...DEBT_LEVELS].reverse().find((l) => owed >= l.min);
  // 本週：應完成（整週）與已完成
  const w = weekOf(day);
  let weekGoal = 0, weekDone = 0;
  for (let d = w.start; d <= w.end; d = addDays(d, 1)) {
    weekGoal += goalOn(d);
    if (d <= day) weekDone += answeredOn(student, d);
  }
  return {
    started, owed, level, rest: started && todayGoal === 0, todayGoal,
    todayDone, todayLeft: Math.max(0, todayGoal - todayDone),
    week: { ...w, goal: weekGoal, done: weekDone },
  };
}

// 連續達標天數（要計題目的日子每天作答 ≥ DAILY_GOAL；休息日跳過，不中斷也不算一天），
// 算到今天或昨天為止
export function streak(student, day) {
  const ok = (d) => answeredOn(student, d) >= DAILY_GOAL;
  const counts = (d) => d >= GOAL_START && !isRestDay(d);
  let d = day, n = 0;
  if (!counts(d) || !ok(d)) d = addDays(d, -1);           // 今天還沒達標不算中斷
  for (; d >= GOAL_START; d = addDays(d, -1)) {
    if (!counts(d)) continue;
    if (!ok(d)) break;
    n++;
  }
  return n;
}

export function progress(pool, student, day) {
  const stats = typeStats(records(student), day);
  let typeCount = 0, mastered = 0;
  const units = pool.units.map((u) => {
    const types = u.types.map((t) => {
      const st = stats.get(`${u.key}|${t.code}`) || new TypeStat();
      return { code: t.code, name: t.name, desc: t.desc, attempts: st.attempts, correct: st.correctIds.size,
        rate: st.rate, recentN: st.recent.length, pL: st.attempts ? st.pL : null, days: st.okDays.size,
        level: st.levelIndex, status: st.status, review: st.needsReview, stuck: st.stuck };
    });
    const counted = types.filter((t) => t.code !== OTHER);
    const m = counted.filter((t) => t.level >= 4).length;
    typeCount += counted.length; mastered += m;
    return { key: u.key, book: u.book, code: u.code, title: u.title, types, mastered: m, typeCount: counted.length,
      attempts: types.reduce((a, t) => a + t.attempts, 0) };
  });
  const days = Object.entries(student.sets || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 60)
    .map(([d, s]) => ({ day: d, n: s.items.length, done: s.items.filter((i) => i.ok !== null).length, ok: s.items.filter((i) => i.ok).length }));
  return { units, mastered, typeCount, streak: streak(student, day), days };
}

// ─────────── 排行榜與爬山高度 ───────────

// 爬山高度（0～1）：各題型熟練度等級的平均，山頂＝所有題型都精熟（「其他題型」不計）
export const LEVEL_HEIGHT = [0, 0.1, 0.3, 0.6, 0.85, 1];
export function climbHeight(pool, student, day) {
  const stats = typeStats(records(student), day);
  let sum = 0, n = 0;
  for (const u of pool.units) for (const t of u.types) {
    if (t.code === OTHER) continue;
    n++;
    sum += LEVEL_HEIGHT[stats.get(`${u.key}|${t.code}`)?.levelIndex ?? 0];
  }
  return n ? Math.round((sum / n) * 1000) / 1000 : 0;
}

// 本週（週五到下週四）排行用：作答題數、達標天數（休息日不算）
export function weekStats(student, day) {
  const w = weekOf(day);
  let done = 0, goalDays = 0;
  for (let d = w.start; d <= day && d <= w.end; d = addDays(d, 1)) {
    const n = answeredOn(student, d);
    done += n;
    if (goalOn(d) && n >= goalOn(d)) goalDays++;
  }
  return { week: w, done, goalDays };
}

// 排序：本週作答多的在前，同分看達標天數；同分同名次
export function rank(rows) {
  const sorted = [...rows].sort((a, b) => b.done - a.done || b.goalDays - a.goalDays || a.name.localeCompare(b.name, "zh-Hant"));
  let prev = null;
  sorted.forEach((r, i) => {
    r.rank = prev && prev.done === r.done && prev.goalDays === r.goalDays ? prev.rank : i + 1;
    prev = r;
  });
  return sorted;
}
