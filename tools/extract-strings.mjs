/**
 * 从 Rackula 源码中提取"用户可见英文文案"候选，产出 JSON 供人工翻译。
 * 用法: node tools/extract-strings.mjs <rackulaSrcDir> <outFile>
 */
import fs from "node:fs";
import path from "node:path";

const srcDir = process.argv[2];
const outFile = process.argv[3];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.svelte$/.test(e.name)) files.push(p);
  }
})(srcDir);

const found = new Map(); // string -> count
function add(s) {
  if (s === undefined || s === null) return;
  const v = String(s).replace(/\s+/g, " ").trim();
  if (!v) return;
  if (v.length < 2 || v.length > 120) return;
  // 排除纯符号 / 纯数字 / 纯表达式 / 纯 CSS 值
  if (!/[A-Za-z]/.test(v)) return;
  if (/^[a-z-]+$/.test(v) && v.includes("-")) return; // css token
  if (/^[#$.]/.test(v)) return;
  if (/^[a-z_]+\(/.test(v)) return;
  if (/^\{|\}$/.test(v)) return;
  if (/^[a-z]+(_[a-z]+)+$/.test(v)) return; // snake_case 常量
  if (/^(https?:|\/|\.\/)/.test(v)) return;
  if (/^\d+(\.\d+)?(px|rem|em|%|ms|s|vh|vw)?$/.test(v)) return;
  if (v.includes("var(--")) return;
  found.set(v, (found.get(v) ?? 0) + 1);
}

for (const f of files) {
  const text = fs.readFileSync(f, "utf8");

  // 1) 标签之间的文本: >text<
  for (const m of text.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) add(m[1]);
  // 2) 属性: placeholder / title / aria-label / alt / label
  for (const m of text.matchAll(
    /\b(?:placeholder|title|aria-label|alt|label|data-tooltip)\s*=\s*"([^"{}]+)"/g,
  ))
    add(m[1]);
  // 3) 双引号字面量中文候选（toast 文案、常量表等）
  for (const m of text.matchAll(/"([^"\\\n{}]{4,120})"/g)) {
    const v = m[1];
    if (/^[a-z0-9-_/.@$:]+$/.test(v)) continue; // 标识符 / 路径 / slug
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) continue;
    add(v);
  }
}

const sorted = [...found.entries()].sort((a, b) => {
  if (b[1] !== a[1]) return b[1] - a[1];
  return a[0].localeCompare(b[0]);
});

fs.writeFileSync(
  outFile,
  JSON.stringify(
    { fileCount: files.length, total: sorted.length, strings: sorted },
    null,
    1,
  ),
  "utf8",
);
console.log("scanned files:", files.length, "unique strings:", sorted.length);
