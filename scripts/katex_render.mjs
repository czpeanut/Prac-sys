// 把題目池裡的 <span class="tex">…</span>（build_pool.py 標出的公式原文）用 KaTeX 預先排版成 HTML。
//   node scripts/katex_render.mjs docs/pool.json
// 排版失敗的公式保留原文並標成紅字（throwOnError: false），結束時列出失敗的數量與例子。
import { readFileSync, writeFileSync } from "node:fs";
import katex from "katex";

const path = process.argv[2];
const pool = JSON.parse(readFileSync(path, "utf8"));
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
let n = 0;
const bad = new Map();

function tex(src) {
  // 國中考卷的寫法修正：全形符號、KaTeX 不認得的命令
  return src
    .replace(/\\degree/g, "^{\\circ}")
    .replace(/\\(?:t)?frac(?![a-z])/g, "\\dfrac")        // 分數用完整大小，跟考卷印的一樣好讀
    .replace(/（/g, "(").replace(/）/g, ")")
    .replace(/，/g, ",\\,");
}

function render(html) {
  return html.replace(/<span class="tex">([\s\S]*?)<\/span>/g, (_, body) => {
    n++;
    const src = tex(unescape(body));
    try {
      return katex.renderToString(src, { throwOnError: true, strict: "ignore", output: "html" });
    } catch (e) {
      bad.set(src, (bad.get(src) ?? 0) + 1);
      return katex.renderToString(src, { throwOnError: false, strict: "ignore", output: "html" });
    }
  });
}

for (const q of pool.questions) {
  for (const k of ["stem_html", "group_html", "answer_html"]) if (q[k]) q[k] = render(q[k]);
  for (const o of q.options) o.html = render(o.html);
}
writeFileSync(path, JSON.stringify(pool));
console.log(`KaTeX 排版 ${n} 個公式，失敗 ${[...bad.values()].reduce((a, b) => a + b, 0)} 個`);
for (const [src, c] of [...bad].slice(0, 15)) console.log(`  ×${c}  ${src}`);
