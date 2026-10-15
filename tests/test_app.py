"""端對端：名字登入 → 今日 20 題 → 作答 → 題型進度。"""

import importlib
import random

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PRACSYS_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("PRACSYS_TEACHER", "pw")
    import app.db, app.main
    importlib.reload(app.db)
    m = importlib.reload(app.main)
    return TestClient(m.app), m


def test_daily_flow(client):
    c, m = client
    s = c.post("/api/login", json={"name": " 王小明 "}).json()
    assert s["name"] == "王小明" and s["scope"] == ["8-1_2-2"]
    assert c.post("/api/login", json={"name": "王小明"}).json()["id"] == s["id"]   # 同名＝同一人

    t = c.get(f"/api/students/{s['id']}/today").json()
    assert len(t["items"]) == 20
    assert all(i["unit"] == "8-1_2-2" for i in t["items"])
    assert all("answer" not in i for i in t["items"])                          # 作答前不給答案
    assert c.get(f"/api/students/{s['id']}/today").json()["id"] == t["id"]       # 同一天同一份

    singles = [i for i in t["items"] if i["qtype"] == "single"]
    fills = [i for i in t["items"] if i["qtype"] == "fill"]
    for i in singles:
        r = c.post(f"/api/students/{s['id']}/items/{i['id']}/answer", json={"response": i["options"][0]["label"]}).json()
        assert r["correct"] in (True, False) and r["answer"]
    assert c.post(f"/api/students/{s['id']}/items/{singles[0]['id']}/answer", json={"response": "A"}).status_code == 409
    if fills:
        r = c.post(f"/api/students/{s['id']}/items/{fills[0]['id']}/answer", json={"response": "3"}).json()
        assert r["correct"] is None and r["answer_html"]
        r = c.post(f"/api/students/{s['id']}/items/{fills[0]['id']}/mark", json={"correct": True}).json()
        assert r["correct"] is True

    p = c.get(f"/api/students/{s['id']}/progress").json()
    u = p["units"][0]
    assert u["attempts"] == len(singles) + (1 if fills else 0)
    assert p["days"][0]["done"] == u["attempts"]

    # 已開始作答就不能換範圍重出
    c.put(f"/api/students/{s['id']}/scope", json={"units": ["8-1_4-1"]})
    assert c.post(f"/api/students/{s['id']}/today/regenerate").status_code == 409

    # 別人的題目不能作答
    o = c.post("/api/login", json={"name": "李同學"}).json()
    assert c.post(f"/api/students/{o['id']}/items/{fills[0]['id'] if fills else singles[0]['id']}/answer",
                  json={"response": "A"}).status_code == 404

    assert c.get("/api/teacher").status_code == 401
    assert len(c.get("/api/teacher", headers={"X-Teacher-Key": "pw"}).json()["students"]) == 2


def test_regenerate_with_new_scope(client):
    c, _ = client
    s = c.post("/api/login", json={"name": "A"}).json()
    c.get(f"/api/students/{s['id']}/today")
    c.put(f"/api/students/{s['id']}/scope", json={"units": ["8-1_3-1", "8-1_3-2"]})
    t = c.post(f"/api/students/{s['id']}/today/regenerate").json()
    assert {i["unit"] for i in t["items"]} <= {"8-1_3-1", "8-1_3-2"} and len(t["items"]) == 20


def test_choose_prioritizes_wrong_and_weak_types(client):
    _, m = client
    from app import practice as P
    pool = m.pool
    unit = "8-1_2-2"
    ids = [q for q, v in pool.questions.items() if v["unit"] == unit]
    wrong = ids[:6]
    hist = {q: [("2026-01-01", 0)] for q in wrong}
    picked = P.choose(pool, [unit], hist, {}, "2026-01-02", rng=random.Random(1))
    assert len(picked) == 20 and len(set(picked)) == 20
    assert len(set(wrong) & set(picked)) == P.REVIEW_MAX
    # 已熟練的題型每輪只抽 1 題、沒熟練的抽 2 題
    types = [t["code"] for t in pool.units[0]["types"] if t["code"] != "OTHER"]
    stats = {}
    for code in types[:-1]:
        st = P.TypeStat(attempts=5, correct_ids={f"x{i}" for i in range(5)}, recent=[1] * 5)
        stats[(unit, code)] = st
    picked = P.choose(pool, [unit], {}, stats, "2026-01-02", rng=random.Random(2))
    weak = [q for q in picked if pool.questions[q]["type_code"] == types[-1]]
    assert len(weak) >= 2


def test_mastery_rule():
    from app.practice import TypeStat
    assert TypeStat(attempts=4, correct_ids={1, 2, 3, 4}, recent=[1, 1, 1, 1]).status == "已熟練"
    assert TypeStat(attempts=5, correct_ids={1, 2, 3, 4}, recent=[0, 0, 1, 1, 1]).status == "練習中"
    assert TypeStat().status == "未練習"
