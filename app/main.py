"""每日練習 API + 網頁。

    uvicorn app.main:app --host 0.0.0.0 --port 8100

環境變數：
  PRACSYS_DB       練習紀錄資料庫（預設 data/practice.db）
  PRACSYS_POOL     題目池（預設 data/pool.json，由 scripts/build_pool.py 產生）
  PRACSYS_TEACHER  老師總覽的密碼；沒設就不開放總覽
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, practice

ROOT = Path(__file__).resolve().parent
POOL_PATH = Path(os.environ.get("PRACSYS_POOL", ROOT.parent / "data/pool.json"))

app = FastAPI(title="Prac-sys 每日練習")
pool = practice.Pool.load(POOL_PATH)
con = db.connect()
lock = threading.Lock()            # sqlite 連線共用，寫入時排隊


class Login(BaseModel):
    name: str


class Scope(BaseModel):
    units: list[str]


class Answer(BaseModel):
    response: str = ""


class Mark(BaseModel):
    correct: bool


def student_or_404(sid: int) -> dict:
    row = con.execute("select * from student where id = ?", (sid,)).fetchone()
    if not row:
        raise HTTPException(404, "找不到這位學生")
    return {"id": row["id"], "name": row["name"], "scope": json.loads(row["scope"])}


def item_view(r, reveal: bool) -> dict:
    q = pool.questions.get(r["question_id"])
    out = {"id": r["id"], "ord": r["ord"], "unit": r["unit"], "type_code": r["type_code"],
           "type_name": pool.type_name(r["unit"], r["type_code"]),
           "response": r["response"], "correct": None if r["correct"] is None else bool(r["correct"]),
           "answered": r["response"] is not None}
    if q is None:      # 題目池重建後這題被拿掉了
        return {**out, "missing": True}
    out.update(qtype=q["qtype"], difficulty=q["difficulty"], stem_html=q["stem_html"],
               options=q["options"], cite=q["cite"])
    if reveal:
        out.update(answer=q["answer"], answer_html=q["answer_html"], answer_ai=q["answer_ai"])
    return out


def set_view(sid: int, set_id: int) -> dict:
    s = con.execute("select * from daily_set where id = ?", (set_id,)).fetchone()
    rows = con.execute("select * from item where set_id = ? order by ord", (set_id,)).fetchall()
    items = [item_view(r, reveal=r["response"] is not None) for r in rows]
    return {"id": s["id"], "day": s["day"], "scope": json.loads(s["scope"]), "items": items,
            "done": sum(i["correct"] is not None for i in items),
            "right": sum(i["correct"] is True for i in items)}


def own_item(sid: int, item_id: int):
    r = con.execute("""select i.* from item i join daily_set s on s.id = i.set_id
                       where i.id = ? and s.student_id = ?""", (item_id, sid)).fetchone()
    if not r:
        raise HTTPException(404, "找不到這一題")
    return r


# ─────────────────────────── API ───────────────────────────

@app.get("/api/meta")
def meta():
    return {"units": pool.units, "daily_n": practice.DAILY_N, "today": practice.today()}


@app.get("/math.css", response_class=PlainTextResponse)
def math_css():
    return PlainTextResponse(pool.math_css, media_type="text/css")


@app.post("/api/login")
def login(body: Login):
    name = re.sub(r"\s+", " ", body.name).strip()
    if not 1 <= len(name) <= 20:
        raise HTTPException(400, "名字請填 1～20 個字")
    with lock:
        row = con.execute("select id from student where name = ?", (name,)).fetchone()
        if not row:
            con.execute("insert into student (name, scope) values (?, ?)", (name, json.dumps(pool.unit_keys[:1])))
            con.commit()
            row = con.execute("select id from student where name = ?", (name,)).fetchone()
    return student_or_404(row["id"])


@app.get("/api/students/{sid}")
def get_student(sid: int):
    return student_or_404(sid)


@app.put("/api/students/{sid}/scope")
def set_scope(sid: int, body: Scope):
    student_or_404(sid)
    units = [u for u in pool.unit_keys if u in body.units]
    if not units:
        raise HTTPException(400, "至少要選一個單元")
    with lock:
        con.execute("update student set scope = ? where id = ?", (json.dumps(units), sid))
        con.commit()
    return student_or_404(sid)


@app.get("/api/students/{sid}/today")
def get_today(sid: int):
    student_or_404(sid)
    with lock:
        set_id = practice.ensure_today(con, pool, sid)
    return set_view(sid, set_id)


@app.post("/api/students/{sid}/today/regenerate")
def regenerate(sid: int):
    """換了練習範圍後重出今天的題目；今天已經開始作答就不能重出。"""
    student_or_404(sid)
    with lock:
        set_id = practice.ensure_today(con, pool, sid)
        n = con.execute("select count(*) from item where set_id = ? and response is not null", (set_id,)).fetchone()[0]
        if n:
            raise HTTPException(409, "今天已經開始作答，明天才會依新範圍出題")
        set_id = practice.ensure_today(con, pool, sid, regenerate=True)
    return set_view(sid, set_id)


@app.post("/api/students/{sid}/items/{item_id}/answer")
def answer(sid: int, item_id: int, body: Answer):
    """作答。選擇題直接判對錯；填充題先記下學生寫的答案、顯示正解，再由學生自己對答案（/mark）。"""
    with lock:
        r = own_item(sid, item_id)
        if r["response"] is not None:
            raise HTTPException(409, "這題已經作答過了")
        q = pool.questions.get(r["question_id"])
        if q is None:
            raise HTTPException(410, "這題已從題目池移除")
        resp = body.response.strip()
        if q["qtype"] == "single":
            labels = {o["label"] for o in q["options"]}
            if resp not in labels:
                raise HTTPException(400, "請選一個選項")
            correct = int(resp in q["answer"])
        else:
            correct = None
        con.execute("update item set response = ?, correct = ?, answered_at = datetime('now') where id = ?",
                    (resp, correct, item_id))
        con.commit()
        return item_view(own_item(sid, item_id), reveal=True)


@app.post("/api/students/{sid}/items/{item_id}/mark")
def mark(sid: int, item_id: int, body: Mark):
    with lock:
        r = own_item(sid, item_id)
        q = pool.questions.get(r["question_id"])
        if r["response"] is None or q is None or q["qtype"] != "fill":
            raise HTTPException(409, "只有看過答案的填充題可以自己對答案")
        con.execute("update item set correct = ?, answered_at = datetime('now') where id = ?",
                    (int(body.correct), item_id))
        con.commit()
        return item_view(own_item(sid, item_id), reveal=True)


@app.get("/api/students/{sid}/progress")
def get_progress(sid: int):
    s = student_or_404(sid)
    return {"student": s, **practice.progress(con, pool, sid)}


@app.get("/api/teacher")
def teacher(x_teacher_key: str = Header(default="")):
    key = os.environ.get("PRACSYS_TEACHER", "")
    if not key:
        raise HTTPException(403, "沒有設定 PRACSYS_TEACHER，總覽未開放")
    if not secrets.compare_digest(x_teacher_key, key):
        raise HTTPException(401, "密碼不對")
    out = []
    for s in con.execute("select id, name from student order by name").fetchall():
        p = practice.progress(con, pool, s["id"])
        last = p["days"][0] if p["days"] else None
        out.append({"id": s["id"], "name": s["name"], "mastered": p["mastered"], "type_count": p["type_count"],
                    "streak": p["streak"], "last_day": last and last["day"],
                    "attempts": sum(u["attempts"] for u in p["units"]),
                    "units": [{"key": u["key"], "mastered": u["mastered"], "type_count": u["type_count"],
                               "attempts": u["attempts"]} for u in p["units"]]})
    return {"units": [{"key": u["key"], "code": u["code"], "title": u["title"]} for u in pool.units],
            "students": out}


# ─────────────────────────── 網頁 ───────────────────────────

app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "static/index.html")


@app.get("/teacher")
def teacher_page():
    return FileResponse(ROOT / "static/teacher.html")
