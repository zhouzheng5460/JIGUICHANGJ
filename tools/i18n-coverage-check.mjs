/**
 * 把「用户可见英文串」与词典做一次机器比对，报告词典未覆盖的。
 *
 * 思路：静态扫描 src/lib 下所有 .ts/.svelte（排除 tests）里
 *   1) showToast(...) / toast(...) 的第一个参数（字符串字面量或模板串）；
 *   2) 常见提示常量（= "..." 且 key 名带 MESSAGE/NOTICE/TEXT/LABEL）。
 * 然后检查该串是否**逐字**出现在 dict.zh-CN.ts 里（TEXT 键或 RULES 中的字面量）。
 * 这是近似判定：命中 RULES 动态规则的串会与源串不完全一致，故仅作提示，不作断言。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/lib";
const DICT = readFileSync("src/lib/i18n/dict.zh-CN.ts", "utf8");

const HAS_CJK = /[\u4e00-\u9fff]/;
/** 纯技术串 / 非文案 */
const SKIP = [
  /^[a-z0-9_:./-]+$/, // 标识符、类名、mime
  /^\s*$/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "tests" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|svelte)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(ROOT);
const found = new Map(); // literal -> Set(file)

function add(lit, file) {
  const s = lit.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'");
  if (!/[A-Za-z]/.test(s)) return;
  if (HAS_CJK.test(s)) return;
  if (SKIP.some((r) => r.test(s))) return;
  if (!found.has(s)) found.set(s, new Set());
  found.get(s).add(file);
}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  // showToast("...", ...) / ctx.showToast("...") / showToast(`...`)
  const toastRe = /showToast\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
  let m;
  while ((m = toastRe.exec(src))) add(m[1].slice(1, -1), file);

  // 提示类常量（*_MESSAGE / *_NOTICE / *_TEXT 的字符串字面量）
  const constRe =
    /(?:const|let)\s+[A-Z0-9_]*(?:MESSAGE|NOTICE|TEXT)[A-Z0-9_]*\s*=\s*(?:\n\s*)?("(?:[^"\\]|\\.)*")/g;
  while ((m = constRe.exec(src))) add(m[1].slice(1, -1), file);
}

const missing = [];
for (const [lit, files] of found) {
  // 词典里是否逐字出现（TEXT 键或规则字面量）
  if (DICT.includes(lit)) continue;
  // 去掉句末句点的兜底规则能否接住：源串以 "." 结尾时不报（兜底会原样返回英文，
  // 若整句其它部分已译则不算漏 —— 但这里只报"完全没出现"的）
  missing.push({ literal: lit, files: [...files].map((f) => f.replace(/\\/g, "/")) });
}

missing.sort((a, b) => a.literal.localeCompare(b.literal));
console.log(
  JSON.stringify(
    { scannedFiles: files.length, literalsSeen: found.size, missing },
    null,
    2,
  ),
);
