/**
 * 二次过滤：从 strings.json 中筛出"像 UI 文案"的条目，输出紧凑列表。
 */
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const BAD = [
  "$state", "$derived", "$effect", "=>", "===", "!==", "??", "||", "&&",
  "svelte", "node_modules", "import ", "export ", "const ", "let ", "function ",
  "$props", "addEventListener", "querySelector", ".svelte", "px;", ":;", "()",
  "{", "}", "//", "xmlns", "viewBox", "stroke", "fill=", "role=", "aria-",
  "data-testid", "class=", "href=", "src=", "type=", "width=", "height=",
  "name=", "value=", "id=", "%s", "%o", "%d", "svg", "SVG", "$$", "theme",
  "http", "www", "MIT", "npm", "yaml", "YAML", "XSS", "URL", "JSON", "CSV",
];

const isBad = (s) => BAD.some((b) => s.includes(b));

const out = [];
for (const [s, n] of data.strings) {
  if (s.length < 3 || s.length > 90) continue;
  if (isBad(s)) continue;
  // 必须像自然语言
  const looksLikeUI =
    /[ ]/.test(s) || /^[A-Z][a-zA-Z0-9'’,\-/&.]*$/.test(s) || /[!?]$/.test(s);
  if (!looksLikeUI) continue;
  out.push(s);
}

out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
fs.writeFileSync(process.argv[3], out.join("\n"), "utf8");
console.log("candidates:", out.length);
