"""出題與進度計算。

每日出題（預設 20 題，只從學生選的練習範圍裡出）：
  1. 先放「之前答錯、還沒再答對」的題目（最多 REVIEW_MAX 題，昨天以前的）
  2. 其餘依題型輪流抽：還沒熟練的題型每輪抽 2 題、已熟練的 1 題，
     弱的題型（正確率低、做得少）排前面；優先抽沒做過的題目，題型的新題用完才重出已答對的舊題
  3. 依單元順序、難度由易到難排好

題型進度（每個學生 × 每個題型）：
  - 作答：做過幾題（自己對答案前的填充題不算）
  - 答對題數：答對過的「不同題目」數
  - 近期正確率：最近 RECENT 次作答的正確率
  - 熟練：答對題數 ≥ MASTER_CORRECT 且近期正確率 ≥ MASTER_RATE
單元進度＝已熟練的題型數 ／ 該單元的題型數（不含「其他題型」）。
"""

from __future__ import annotations

import json
import random
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

DAILY_N = 20
REVIEW_MAX = 4
RECENT = 5
MASTER_CORRECT = 4
MASTER_RATE = 0.8
OTHER = "OTHER"
TW = timezone(timedelta(hours=8))        # 台灣沒有日光節約時間，固定 +8


def today() -> str:
    return datetime.now(TW).date().isoformat()


@dataclass
class Pool:
    units: list[dict]
    questions: dict[str, dict]
    math_css: str = ""
    by_unit_type: dict[tuple[str, str], list[str]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "Pool":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        qs = {q["id"]: q for q in raw["questions"]}
        p = cls(units=raw["units"], questions=qs, math_css=raw.get("math_css", ""))
        for q in raw["questions"]:
            p.by_unit_type.setdefault((q["unit"], q["type_code"]), []).append(q["id"])
        return p

    @property
    def unit_keys(self) -> list[str]:
        return [u["key"] for u in self.units]

    def type_name(self, unit: str, code: str) -> str:
        for u in self.units:
            if u["key"] == unit:
                for t in u["types"]:
                    if t["code"] == code:
                        return t["name"]
        return code


# ─────────────────────────── 進度 ───────────────────────────

@dataclass
class TypeStat:
    attempts: int = 0
    correct_ids: set = field(default_factory=set)
    recent: list = field(default_factory=list)       # 由新到舊的對錯

    @property
    def rate(self) -> float | None:
        return sum(self.recent) / len(self.recent) if self.recent else None

    @property
    def mastered(self) -> bool:
        return len(self.correct_ids) >= MASTER_CORRECT and (self.rate or 0) >= MASTER_RATE

    @property
    def status(self) -> str:
        return "未練習" if not self.attempts else "已熟練" if self.mastered else "練習中"


def type_stats(con: sqlite3.Connection, student_id: int) -> dict[tuple[str, str], TypeStat]:
    rows = con.execute(
        """select i.unit, i.type_code, i.question_id, i.correct from item i join daily_set s on s.id = i.set_id
           where s.student_id = ? and i.correct is not null order by i.answered_at desc, i.id desc""",
        (student_id,)).fetchall()
    stats: dict[tuple[str, str], TypeStat] = defaultdict(TypeStat)
    for r in rows:
        st = stats[(r["unit"], r["type_code"])]
        st.attempts += 1
        if r["correct"]:
            st.correct_ids.add(r["question_id"])
        if len(st.recent) < RECENT:
            st.recent.append(r["correct"])
    return stats


def progress(con: sqlite3.Connection, pool: Pool, student_id: int) -> dict:
    stats = type_stats(con, student_id)
    units, total_types, total_mastered = [], 0, 0
    for u in pool.units:
        types = []
        for t in u["types"]:
            st = stats.get((u["key"], t["code"]), TypeStat())
            types.append({"code": t["code"], "name": t["name"], "desc": t["desc"], "pool": t["n"],
                          "attempts": st.attempts, "correct": len(st.correct_ids),
                          "rate": None if st.rate is None else round(st.rate, 2), "status": st.status})
        counted = [t for t in types if t["code"] != OTHER]
        mastered = sum(t["status"] == "已熟練" for t in counted)
        total_types += len(counted)
        total_mastered += mastered
        units.append({"key": u["key"], "book": u["book"], "code": u["code"], "title": u["title"],
                      "types": types, "mastered": mastered, "type_count": len(counted),
                      "attempts": sum(t["attempts"] for t in types)})
    days = con.execute(
        """select s.day, count(i.id) n, sum(i.correct is not null) done, sum(i.correct = 1) ok
           from daily_set s left join item i on i.set_id = s.id where s.student_id = ?
           group by s.id order by s.day desc limit 60""", (student_id,)).fetchall()
    return {"units": units, "mastered": total_mastered, "type_count": total_types,
            "streak": streak([d["day"] for d in days if d["done"]]),
            "days": [dict(d) for d in days]}


def streak(done_days: list[str]) -> int:
    """連續練習天數（到今天或昨天為止）。"""
    have = set(done_days)
    d = datetime.now(TW).date()
    if d.isoformat() not in have:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in have:
        n += 1
        d -= timedelta(days=1)
    return n


# ─────────────────────────── 出題 ───────────────────────────

def history(con: sqlite3.Connection, student_id: int) -> dict[str, list[tuple[str, int]]]:
    """題號 → [(日期, 對錯)]，由舊到新。"""
    rows = con.execute(
        """select i.question_id, s.day, i.correct from item i join daily_set s on s.id = i.set_id
           where s.student_id = ? and i.correct is not null order by i.answered_at, i.id""",
        (student_id,)).fetchall()
    h: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for r in rows:
        h[r["question_id"]].append((r["day"], r["correct"]))
    return h


def choose(pool: Pool, scope: list[str], hist: dict[str, list[tuple[str, int]]],
           stats: dict[tuple[str, str], TypeStat], day: str, n: int = DAILY_N,
           rng: random.Random | None = None) -> list[str]:
    rng = rng or random.Random()
    scope = [u for u in pool.unit_keys if u in scope] or pool.unit_keys[:1]
    in_scope = [qid for qid, q in pool.questions.items() if q["unit"] in scope]
    picked: list[str] = []

    # 1. 答錯還沒再答對的題目，隔天以後再出一次
    wrong = [qid for qid in in_scope if hist.get(qid) and hist[qid][-1][1] == 0 and hist[qid][-1][0] < day]
    wrong.sort(key=lambda qid: hist[qid][-1][0])
    picked += wrong[:min(REVIEW_MAX, n)]

    # 2. 依題型輪流抽
    queues: dict[tuple[str, str], list[str]] = {}
    for u in scope:
        for t in next(x for x in pool.units if x["key"] == u)["types"]:
            ids = [q for q in pool.by_unit_type.get((u, t["code"]), []) if q not in picked]
            fresh = [q for q in ids if q not in hist]
            # 做過且答對的題目當備用，最久沒做的先出
            old = sorted((q for q in ids if q in hist and hist[q][-1][1] == 1), key=lambda q: hist[q][-1][0])
            rng.shuffle(fresh)
            queues[(u, t["code"])] = fresh + old

    def weakness(k: tuple[str, str]):
        st = stats.get(k, TypeStat())
        return (st.mastered, k[1] == OTHER, st.rate if st.rate is not None else -1, st.attempts, rng.random())

    order = sorted(queues, key=weakness)
    while len(picked) < n and any(queues.values()):
        for k in order:
            take = 1 if stats.get(k, TypeStat()).mastered or k[1] == OTHER else 2
            for _ in range(take):
                if queues[k] and len(picked) < n:
                    picked.append(queues[k].pop(0))

    unit_ord = {u: i for i, u in enumerate(pool.unit_keys)}
    return sorted(picked, key=lambda q: (unit_ord[pool.questions[q]["unit"]], pool.questions[q]["difficulty"] or 3))


def ensure_today(con: sqlite3.Connection, pool: Pool, student_id: int, regenerate: bool = False) -> int:
    day = today()
    row = con.execute("select id from daily_set where student_id = ? and day = ?", (student_id, day)).fetchone()
    if row and not regenerate:
        return row["id"]
    scope = json.loads(con.execute("select scope from student where id = ?", (student_id,)).fetchone()["scope"])
    if row:
        # 換範圍重出：只在今天還沒作答時允許（由呼叫端檢查），舊的直接刪掉
        con.execute("delete from daily_set where id = ?", (row["id"],))
    ids = choose(pool, scope, history(con, student_id), type_stats(con, student_id), day)
    cur = con.execute("insert into daily_set (student_id, day, scope) values (?, ?, ?)",
                      (student_id, day, json.dumps(scope)))
    set_id = cur.lastrowid
    con.executemany("insert into item (set_id, ord, question_id, unit, type_code) values (?, ?, ?, ?, ?)",
                    [(set_id, i + 1, q, pool.questions[q]["unit"], pool.questions[q]["type_code"])
                     for i, q in enumerate(ids)])
    con.commit()
    return set_id
