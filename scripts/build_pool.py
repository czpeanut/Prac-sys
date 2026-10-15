#!/usr/bin/env python3
"""從 OLE-QS 題庫（唯讀）產生每日練習的題目池 docs/pool.json。

公式用 KaTeX 預先排版（scripts/katex_render.mjs，要先 npm install），網頁只需要 KaTeX 的 CSS 與字型（docs/katex/）。

    python scripts/build_pool.py --oleqs ../OLE-QS
    python scripts/build_pool.py --oleqs ../OLE-QS --units 8-1_2-2,8-1_2-3   # 改範圍

讀的東西（全部唯讀，不寫回 OLE-QS）：
  - data/bank/*.yaml                          題目、答案、出處
  - data/curriculum/math_patterns/*.yaml      各單元的題型目錄（名稱、說明）
  - data/pipeline_records/math_patterns_*.tar.gz   每題歸到哪個題型、難度
  - apps/api/quality.py、apps/api/mathfmt.py  品管閘門、公式轉 HTML（與組卷平台同一套）

收錄條件（學生要能自己作答、自動對答案）：
  - 單選題（--qtypes 可加 fill 收填充題，但目前網頁只支援單選），且通過 OLE-QS 的品管閘門
  - 有答案，且答案不是「有疑義（disputed）」
  - 沒有附圖、選項圖、共用素材或題組前文 —— 題庫的圖檔不在版控裡，帶圖的題目看不到圖就沒辦法作答；
    題幹寫「如圖」「下圖」卻沒附圖的也排除
  - 題幹與選項完全相同的題目只留一題（同一份卷常被多校沿用）
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import html
import re
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent

# 國二上學期 2-2 根式的運算 → 4-1 因式分解（依教學順序）
DEFAULT_UNITS = ["8-1_2-2", "8-1_2-3", "8-1_3-1", "8-1_3-2", "8-1_4-1"]
OTHER = "OTHER"                      # 題型目錄歸不進去的題目
OTHER_NAME = "其他題型"
FIGURE_WORDS = re.compile(r"如圖|下圖|右圖|左圖|附圖|上圖|圖中|圖\s*[(（]?[一二三四五六七八九十\d]")
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


def load_classification(oleqs: Path, units: list[str]) -> dict[str, dict]:
    """題號 → {unit, type_code, difficulty}，取自 math_patterns 的歸類備份（取最新一份）。"""
    tars = sorted((oleqs / "data/pipeline_records").glob("math_patterns_*.tar.gz"))
    if not tars:
        sys.exit("找不到 OLE-QS/data/pipeline_records/math_patterns_*.tar.gz")
    out: dict[str, dict] = {}
    with tarfile.open(tars[-1]) as tf:
        for u in units:
            f = tf.extractfile(f"math_patterns/{u}.json")
            if f is None:
                sys.exit(f"歸類備份裡沒有單元 {u}")
            for qid, r in json.load(f)["results"].items():
                out[qid] = {"unit": u, "type_code": r.get("type_code") or OTHER,
                            "difficulty": r.get("difficulty")}
    return out


def has_figure(q: dict) -> bool:
    return bool(q.get("assets") or q.get("shared_asset") or (q.get("group_stem") or "").strip()
                or any(o.get("asset") for o in q.get("options") or []))


def answer_ok(q: dict) -> bool:
    ans = q.get("answer")
    if not ans or q.get("answer_status") == "disputed":
        return False
    return all(str(a).strip() for a in (ans if isinstance(ans, list) else [ans]))


def as_math(a: str) -> str:
    """填充題答案多半是裸的 LaTeX（\\frac{9\\sqrt{2}}{2}），包成 $…$ 才會轉成公式。"""
    a = str(a).strip()
    return a if "$" in a or not re.search(r"[\\^_{}]", a) else f"${a}$"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--oleqs", type=Path, default=REPO.parent / "OLE-QS", help="OLE-QS 專案目錄（唯讀）")
    ap.add_argument("--units", default=",".join(DEFAULT_UNITS), help="單元鍵，依教學順序，逗號分隔")
    ap.add_argument("--qtypes", default="single", help="收錄的題型，逗號分隔（single、fill）")
    ap.add_argument("-o", "--out", type=Path, default=REPO / "docs/pool.json")
    args = ap.parse_args()

    oleqs = args.oleqs.resolve()
    sys.dont_write_bytecode = True       # 唯讀：不在 OLE-QS 裡留下 __pycache__
    sys.path.insert(0, str(oleqs))
    from apps.api import mathfmt  # noqa: E402
    # 沿用 OLE-QS 的 Markdown 處理（逸出、粗體、表格、換行），公式則只標出原文，交給 KaTeX 排版
    mathfmt.latex_to_html = lambda tex: f'<span class="tex">{html.escape(tex)}</span>'
    render = mathfmt.render
    from apps.api.quality import evaluate  # noqa: E402

    units = [u.strip() for u in args.units.split(",") if u.strip()]
    qtypes = {t.strip() for t in args.qtypes.split(",") if t.strip()}
    cls = load_classification(oleqs, units)
    docs = sorted({qid.rsplit("_s", 1)[0] for qid in cls})

    questions, seen = [], set()
    skipped = collections.Counter()
    for d in docs:
        path = oleqs / "data/bank" / f"{d}.yaml"
        if not path.exists():
            skipped["卷檔不存在"] += 1
            continue
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        meta = doc["document"]
        cite = f"[{meta.get('city', '')} {meta.get('school_short', '')} {meta.get('academic_year_roc', '')}]"
        for q in doc.get("questions") or []:
            c = cls.get(q["id"])
            if not c:
                continue
            if q.get("type") not in qtypes:
                skipped[f"題型不是 {'、'.join(sorted(qtypes))}"] += 1
                continue
            if not evaluate(q, doc)[0]:
                skipped["未通過品管閘門"] += 1
                continue
            if not answer_ok(q):
                skipped["沒有答案或答案有疑義"] += 1
                continue
            stem = (q.get("stem") or "").strip()
            if has_figure(q) or FIGURE_WORDS.search(stem):
                skipped["需要附圖"] += 1
                continue
            opts = q.get("options") or []
            key = hashlib.sha1("\x1f".join([re.sub(r"\s+", "", stem)] +
                                           [re.sub(r"\s+", "", o.get("content") or "") for o in opts])
                               .encode()).hexdigest()
            if key in seen:
                skipped["重複題"] += 1
                continue
            seen.add(key)

            ans = q["answer"] if isinstance(q["answer"], list) else [q["answer"]]
            ans = [str(a).strip() for a in ans]
            if q["type"] == "single":
                answer_html = "、".join(ans)
            elif len(ans) == 1:
                answer_html = render(as_math(ans[0]))
            else:
                answer_html = "　".join(f"{CIRCLED[i] if i < len(CIRCLED) else f'({i + 1})'} {render(as_math(a))}"
                                       for i, a in enumerate(ans))
            questions.append({
                "id": q["id"],
                "unit": c["unit"],
                "type_code": c["type_code"],
                "difficulty": c["difficulty"],
                "qtype": q["type"],
                "stem_html": render(stem),
                "options": [{"label": o["label"], "html": render(o.get("content") or "")} for o in opts],
                "answer": ans,
                **({"answer_html": answer_html} if q["type"] != "single" else {}),
                "cite": cite,
            })

    # 題型目錄：只列出題目池裡真的有題目的題型
    n_type = collections.Counter((q["unit"], q["type_code"]) for q in questions)
    unit_meta = []
    for u in units:
        cat = yaml.safe_load((oleqs / "data/curriculum/math_patterns" / f"{u}.yaml").read_text(encoding="utf-8"))
        types = [{"code": t["code"], "name": t["name"], "desc": t.get("desc", ""), "n": n_type[(u, t["code"])]}
                 for t in cat.get("types") or [] if n_type[(u, t["code"])]]
        if n_type[(u, OTHER)]:
            types.append({"code": OTHER, "name": OTHER_NAME, "desc": "題型目錄歸不進去的題目", "n": n_type[(u, OTHER)]})
        g, rest = u.split("_")
        unit_meta.append({"key": u, "book": {"8-1": "八上", "8-2": "八下", "7-1": "七上", "7-2": "七下",
                                            "9-1": "九上", "9-2": "九下"}.get(g, g),
                          "code": rest, "title": cat["unit"]["title"],
                          "n": sum(t["n"] for t in types), "types": types})

    order = {u: i for i, u in enumerate(units)}
    questions.sort(key=lambda q: (order[q["unit"]], q["type_code"], q["id"]))
    pool = {"built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "OLE-QS", "units": unit_meta, "questions": questions}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(pool, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    subprocess.run(["node", str(REPO / "scripts/katex_render.mjs"), str(args.out)], check=True)
    # KaTeX 的樣式與字型放進網站（只帶 woff2，現代瀏覽器都支援）
    dist = REPO / "node_modules/katex/dist"
    kdir = args.out.parent / "katex"
    shutil.rmtree(kdir, ignore_errors=True)
    (kdir / "fonts").mkdir(parents=True)
    shutil.copy(dist / "katex.min.css", kdir)
    for f in (dist / "fonts").glob("*.woff2"):
        shutil.copy(f, kdir / "fonts")
    (args.out.parent / "math.css").unlink(missing_ok=True)

    print(f"題目池 {len(questions)} 題 → {args.out}")
    for m in unit_meta:
        print(f"  {m['book']} {m['code']} {m['title']}：{m['n']} 題、{len(m['types'])} 個題型")
    for k, v in skipped.most_common():
        print(f"  排除 {v} 題：{k}")


if __name__ == "__main__":
    main()
