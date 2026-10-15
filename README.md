# Prac-sys — 每日數學練習

給學生每天練習 10 題的小網頁，部署在 GitHub Pages（純靜態，`docs/` 目錄）。
題目取自 [OLE-QS](https://github.com/czpeanut/OLE-QS) 題庫（**唯讀**，不寫回），
練習進度用 OLE-QS 的**數學題型分類**計算，學生用名字登入，練習紀錄存在 **Supabase**。

目前範圍：**國二上學期（八上）2-2 ～ 4-1，純文字單選題**（帶圖的題目、填充題之後再逐步加入）

| 單元 | 題目 | 題型 |
|---|---|---|
| 2-2 根式的運算 | 227 | 12 |
| 2-3 畢氏定理 | 110 | 10 |
| 3-1 提公因式與乘法公式作因式分解 | 163 | 12 |
| 3-2 利用十字交乘法因式分解 | 163 | 11 |
| 4-1 因式分解法解一元二次方程式 | 312 | 13 |

（題型數含「其他題型」，它不計入熟練進度。）

## 部署到 GitHub Pages

repo 的 Settings → Pages → Build and deployment：
Source 選 **Deploy from a branch**，Branch 選預設分支、資料夾選 **/docs**，儲存。
之後每次推送到該分支就會自動更新。

本機預覽：`cd docs && python -m http.server 8000`，開 http://127.0.0.1:8000
（要用 http 開，直接雙擊 index.html 會讀不到題目池）。

## 使用方式

- **名字登入**：輸入名字就開始，同一個名字就是同一個人（不分大小寫）。
- **名字選單**：已經練習過的同學從下拉選單選名字；第一次練習的人輸入名字新增。
- **練習章節**：今日練習頁最上方勾選 2-2、2-3、3-1、3-2、4-1（可複選），按「換成這些章節」立即換題 ——
  今天已作答的題目保留，其餘換成新章節的題目，總數不變。新學生預設從 2-2 開始。
- **今日練習**：每人每天一份 10 題，當天重開還是同一份；選好選項按「送出」直接判對錯。做完可以按「再練 10 題」繼續。
- **每日進度與欠題量表**：從 2026/10/16 起每天要完成 10 題（`docs/practice.js` 的 `GOAL_START`、`DAILY_GOAL`）。
  今天沒做滿 10 題就顯示「今天還沒練完，還差 N 題」。欠題＝過去每天應完成的總數 − 實際作答；
  今天先做滿今天的 10 題，多做的才拿去還之前欠的。量表依欠題數分五級：

  | 等級 | 欠題數 |
  |---|---|
  | 進度正常 | 0 |
  | 輕微落後 | 1～9（不到一天的份） |
  | 注意 | 10～29 |
  | 嚴重落後 | 30～59 |
  | 非常嚴重 | 60 以上 |
- **練習進度**：每個單元、每個題型的答對／作答數、近 5 題正確率與狀態（未練習／練習中／已熟練）。

- **老師總覽**（`teacher.html`）：輸入老師密碼，看全班今天是否練完、欠題等級（欠最多的排前面）、各單元的熟練題型數、作答數、正確率、連續達標天數，點名字看各題型細節。

## 練習紀錄資料庫（Supabase）

GitHub Pages 只能放靜態檔案，網頁直接用 Supabase 的 anon 金鑰呼叫資料庫函式。設定步驟：

1. 建一個 Supabase 專案（免費方案即可；也可以和 OLE-QS 共用同一個專案，資料表都以 `pracsys_` 開頭）
2. SQL Editor 貼上 [`supabase/schema.sql`](supabase/schema.sql) 執行（可重複執行），再設定老師密碼：
   ```sql
   select pracsys_set_teacher_key('換成老師密碼');
   ```
3. Project Settings → API 取得 Project URL 與 **anon / publishable** 金鑰，填進 [`docs/config.js`](docs/config.js)，推上 GitHub。
   **不要填 service_role / secret 金鑰**——它會公開在網頁上。

資料表：`pracsys_student`（名字、練習範圍）、`pracsys_set`（每人每天一列，當天的題目與作答）、`pracsys_config`（老師密碼的 bcrypt 雜湊）。

安全設計：

- 資料表全開 RLS 且沒有任何 policy，anon 金鑰**不能直接讀寫資料表**，只能呼叫 `pracsys_login`、`pracsys_get`、
  `pracsys_save_set`、`pracsys_save_scope`、`pracsys_overview` 這幾個函式
- 全班紀錄只有 `pracsys_overview` 拿得到，要老師密碼；設定老師密碼的函式網頁呼叫不到
- 學生只用名字登入、沒有密碼：知道某位同學的名字就能用他的名字作答。適合班級內練習；需要更嚴格可再加座號或密碼

`docs/config.js` 留空時改存在學生裝置的瀏覽器（localStorage），換裝置就看不到紀錄，「練習範圍」頁可下載備份與還原；老師總覽不能用。

### 出題規則（`docs/practice.js`）

1. 先放之前答錯、還沒再答對的題目（昨天以前的，最多 4 題）
2. 其餘依題型輪流抽：還沒熟練的題型每輪 2 題、已熟練的 1 題，正確率低、做得少的題型排前面；
   優先出沒做過的題目，題型的新題用完才重出最久以前答對的題目
3. 依單元順序、難度由易到難排列

### 進度計算

- **題型熟練**：答對過 4 題以上（不同題目），且最近 5 次作答答對 80% 以上
- **單元進度**＝已熟練題型數 ／ 題型數（「其他題型」＝題型目錄歸不進去的題目，不計）
- 題目的單元與題型在出題時記在紀錄上，之後重建題目池也不影響舊紀錄

## 題目池（`docs/pool.json`）

由 `scripts/build_pool.py` 從 OLE-QS 產生。公式在建置時用 **KaTeX** 預先排版成 HTML
（`scripts/katex_render.mjs`，分數一律用完整大小），網頁只載入 `docs/katex/` 的樣式與字型，不需要外部 CDN：

```bash
pip install -r requirements.txt
npm install                                                           # KaTeX
python scripts/build_pool.py --oleqs ../OLE-QS                         # 預設範圍 八上 2-2～4-1
python scripts/build_pool.py --oleqs ../OLE-QS --units 8-1_2-2,8-1_2-3,8-1_3-1,8-1_3-2,8-1_4-1,8-1_4-2
```

讀的 OLE-QS 資料（全部唯讀）：

| 來源 | 用途 |
|---|---|
| `data/bank/*.yaml` | 題目、答案、出處 |
| `data/curriculum/math_patterns/*.yaml` | 各單元的題型目錄（名稱、說明） |
| `data/pipeline_records/math_patterns_*.tar.gz` | 每題的題型歸類與難度 |
| `apps/api/quality.py`、`apps/api/mathfmt.py` | 品管閘門、公式轉 HTML（與組卷平台同一套） |

收錄條件：單選題、通過 OLE-QS 品管閘門、有答案且不是「有疑義」、沒有附圖
（題幹寫「如圖」卻沒附圖的也排除）、題幹與選項完全相同的只留一題。
八上 2-2～4-1 在題庫裡有題型歸類的 1,958 題中收錄 975 題。

## 授權與來源標註

依 OLE-QS 的授權條件，**每題下方固定顯示出處**（`[縣市 學校 學年度]`），不可關閉。

## 目錄

```
docs/index.html, app.js, style.css   網頁（GitHub Pages 從這裡發布）
docs/teacher.html                    老師總覽
docs/practice.js                     出題、題型進度（純函式）
docs/store.js, config.js             練習紀錄存取（Supabase／本機）、連線設定
supabase/schema.sql                  資料庫結構與函式
docs/pool.json, katex/               題目池（公式已排版）、KaTeX 樣式與字型（build_pool.py 產生）
scripts/build_pool.py                從 OLE-QS 產生題目池
scripts/katex_render.mjs             公式預先排版
tests/practice.test.mjs              測試：npm test
```
