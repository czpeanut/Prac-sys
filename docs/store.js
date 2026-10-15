// 練習紀錄的存取：有設定 Supabase（config.js）就存到線上資料庫，沒有就存在這台裝置的瀏覽器。
// 兩種模式對外的介面相同：login(name) → 學生物件 {id, name, scope, sets}，saveSet / saveScope 寫回。
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const online = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const LOCAL = "pracsys.v1";          // 本機模式：所有學生的紀錄
const SESSION = "pracsys.session";   // 線上模式：記住這台裝置目前登入的學生 id

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
const norm = (name) => name.replace(/\s+/g, " ").trim();
const keyOf = (name) => norm(name).toLowerCase();

async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.message || `資料庫錯誤 ${r.status}`);
  return data;
}

// ─────────── 本機模式 ───────────
const local = {
  db() { return readLocal(LOCAL, { current: null, students: {} }); },
  known() { return Object.values(this.db().students).map((s) => s.name); },
  async resume() {
    const db = this.db();
    return db.current && db.students[db.current] ? { id: db.current, ...db.students[db.current] } : null;
  },
  async login(name, defaultScope) {
    const db = this.db(), k = keyOf(name);
    if (!db.students[k]) db.students[k] = { name: norm(name), scope: defaultScope, sets: {}, created: new Date().toISOString() };
    db.current = k;
    if (!writeLocal(LOCAL, db)) throw new Error("這個瀏覽器無法儲存練習紀錄（可能是無痕模式）");
    return { id: k, ...db.students[k] };
  },
  logout() { const db = this.db(); db.current = null; writeLocal(LOCAL, db); },
  persist(student) {
    const db = this.db();
    const { id, ...rest } = student;
    db.students[id] = rest;
    if (!writeLocal(LOCAL, db)) throw new Error("這個瀏覽器無法儲存練習紀錄（可能是無痕模式）");
  },
  async saveSet(student) { this.persist(student); },
  async saveScope(student) { this.persist(student); },
  restore(data) {           // 還原備份檔：{學生鍵: 學生資料}
    const db = this.db();
    Object.assign(db.students, data);
    writeLocal(LOCAL, db);
  },
};

// ─────────── 線上模式（Supabase） ───────────
const remote = {
  known() { return []; },
  async resume() {
    const id = readLocal(SESSION, null);
    if (!id) return null;
    const s = await rpc("pracsys_get", { p_student: id });
    if (!s) { writeLocal(SESSION, null); return null; }
    return s;
  },
  async login(name, defaultScope) {
    const s = await rpc("pracsys_login", { p_name: name, p_default_scope: defaultScope });
    writeLocal(SESSION, s.id);
    return rpc("pracsys_get", { p_student: s.id });
  },
  logout() { writeLocal(SESSION, null); },
  async saveSet(student, day) {
    const set = student.sets[day];
    await rpc("pracsys_save_set", { p_student: student.id, p_day: day, p_scope: set.scope, p_items: set.items });
  },
  async saveScope(student) {
    await rpc("pracsys_save_scope", { p_student: student.id, p_scope: student.scope });
  },
};

export const store = online ? remote : local;

// 老師總覽：全部學生與練習（只有線上模式）
export function overview(key) {
  return rpc("pracsys_overview", { p_key: key });
}
