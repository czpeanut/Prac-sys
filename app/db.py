"""學生練習紀錄資料庫（SQLite）。

學生用名字登入，每人每天一份練習（預設 20 題），每題作答結果都留下來，
題型進度直接從作答紀錄算出來（見 practice.progress）。

題目的單元與題型在出題當下**快照**到 item 上：之後重建題目池（題型目錄調整、題目被剔除）
也不會讓舊紀錄對不回去。
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("PRACSYS_DB", Path(__file__).resolve().parent.parent / "data/practice.db"))

SCHEMA = """
create table if not exists student (
    id          integer primary key autoincrement,
    name        text not null unique collate nocase,
    scope       text not null default '[]',          -- 練習範圍：單元鍵的 JSON 陣列
    created_at  text not null default (datetime('now'))
);

create table if not exists daily_set (
    id          integer primary key autoincrement,
    student_id  integer not null references student(id) on delete cascade,
    day         text not null,                       -- 台灣日期 YYYY-MM-DD
    scope       text not null,                       -- 出題當下的範圍
    created_at  text not null default (datetime('now')),
    unique (student_id, day)
);

create table if not exists item (
    id           integer primary key autoincrement,
    set_id       integer not null references daily_set(id) on delete cascade,
    ord          integer not null,
    question_id  text not null,
    unit         text not null,                      -- 出題當下的單元、題型（快照）
    type_code    text not null,
    response     text,                               -- 學生的答案（選擇題是選項代號，填充題是自己寫的）
    correct      integer,                            -- 1 對、0 錯、null 未作答／尚未自己對答案
    answered_at  text,
    unique (set_id, ord)
);
create index if not exists ix_item_question on item(question_id);
"""


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    p = Path(path or DB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(p, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("pragma foreign_keys = on")
    con.execute("pragma journal_mode = wal")
    con.executescript(SCHEMA)
    return con
