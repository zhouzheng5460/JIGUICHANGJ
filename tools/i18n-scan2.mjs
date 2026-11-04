/**
 * i18n 全量扫描（轻量版，不做 hover）
 * =================================================================================
 * 输出：所有「含拉丁字母且不含中文」的可见文本 / 属性值，按串去重。
 * 覆盖：默认视图 → 命令面板 → 设置弹窗 → 关于面板 → 布局库。
 * 用法：RACK3D_URL=http://localhost:5200/ node tools/i18n-scan2.mjs
 */

import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5200/";
const UNITS_PER_U = 6;
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-0000000000ab";

const YAML = YAMLNS.default ?? YAMLNS;
const parseYaml = YAML.parse ?? YAMLNS.parse;
const template = parseYaml(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);

const layout = {
  version: "26.9.0",
  name: "i18n 扫描",
  racks: [
    {
      id: "rack-1",
      name: "机柜 A",
      height: 12,
      width: 19,
      desc_units: false,
      show_rear: true,
      form_factor: "4-post-cabinet",
      starting_unit: 1,
      position: 0,
      view: "front",
      devices: [
        {
          id: "dev-server-1",
          device_type: "1u-server",
          name: "应用服务器",
          position: 9 * UNITS_PER_U,
          face: "front",
        },
      ],
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "i18n 扫描", schema_version: "1.1" },
};

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error("找不到 msedge.exe");
  process.exit(2);
}

const SCAN_FN = `(() => {
  const HAS_CJK = /[\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]/;
  const HAS_LETTER = /[A-Za-z]/;
  const path = (el) => {
    const parts = [];
    let n = el;
    for (let i = 0; i < 3 && n && n.nodeType === 1; i += 1) {
      let s = n.tagName.toLowerCase();
      const cls = (n.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      if (n.dataset && n.dataset.testid) s += "[" + n.dataset.testid + "]";
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(">");
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  const texts = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = (node.parentElement && node.parentElement.tagName) || "";
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(tag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let t = walker.nextNode();
  while (t) {
    const raw = (t.data || "").replace(/\\s+/g, " ").trim();
    if (raw && HAS_LETTER.test(raw) && !HAS_CJK.test(raw) && raw.length < 80) {
      const p = t.parentElement;
      if (p && visible(p) && !texts.has(raw)) texts.set(raw, path(p));
    }
    t = walker.nextNode();
  }
  const attrs = new Map();
  const ATTRS = ["title", "aria-label", "placeholder", "alt", "data-tooltip"];
  for (const el of document.querySelectorAll("*")) {
    if (!visible(el)) continue;
    for (const a of ATTRS) {
      const v = (el.getAttribute(a) || "").replace(/\\s+/g, " ").trim();
      if (!v || !HAS_LETTER.test(v) || HAS_CJK.test(v) || v.length > 100) continue;
      const key = a + " :: " + v;
      if (!attrs.has(key)) attrs.set(key, path(el));
    }
  }
  return {
    texts: Array.from(texts, ([k, v]) => k + "  @  " + v).sort(),
    attrs: Array.from(attrs, ([k, v]) => k + "  @  " + v).sort(),
  };
})()`;

const report = {};
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.setDefaultTimeout(6000);

const merge = (bucket, res) => {
  for (const k of ["texts", "attrs"]) {
    report[bucket + "." + k] = Array.from(
      new Set([...(report[bucket + "." + k] ?? []), ...res[k]]),
    ).sort();
  }
};

try {
  await page.addInitScript(
    ({ layoutId, layout }) => {
      localStorage.setItem(
        `Rackula:layout:${layoutId}`,
        JSON.stringify({
          schemaVersion: 2,
          layout,
          savedAt: new Date().toISOString(),
          writerTabId: crypto.randomUUID(),
        }),
      );
      localStorage.setItem(
        "Rackula:workspace",
        JSON.stringify({
          schemaVersion: 2,
          activeId: layoutId,
          openTabs: [layoutId],
          library: {
            [layoutId]: {
              name: layout.name,
              updatedAt: new Date().toISOString(),
              changesSinceExport: 0,
              hasEverExported: false,
              lastExportedAt: null,
              writeFailed: false,
              storageMode: "browser",
            },
          },
        }),
      );
      localStorage.setItem("Rackula:everHadLayouts", "1");
      localStorage.setItem("rack3d_locale", "zh-CN");
    },
    { layoutId: LAYOUT_ID, layout },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);
  merge("default", await page.evaluate(SCAN_FN));
  report.title = await page.title();

  // 命令面板
  await page.locator('[data-testid="btn-command-palette"]').click();
  await page.waitForTimeout(900);
  merge("palette", await page.evaluate(SCAN_FN));
  report.paletteHeadings = await page.locator(".command-group-heading").allInnerTexts();
  report.paletteFooter = await page
    .locator(".command-footer")
    .allInnerTexts()
    .catch(() => []);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // 设置弹窗
  await page.locator('[data-testid="btn-command-palette"]').click();
  await page.waitForTimeout(700);
  await page.locator('[data-testid="command-palette-settings"]').click();
  await page.waitForSelector('[data-testid="settings-dialog"]', { timeout: 8000 });
  await page.waitForTimeout(600);
  merge("settings", await page.evaluate(SCAN_FN));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // 关于/快捷键
  await page.locator('[data-testid="btn-command-palette"]').click();
  await page.waitForTimeout(700);
  await page.keyboard.type("about");
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  merge("about", await page.evaluate(SCAN_FN));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // 布局库
  await page.locator('[data-testid="btn-command-palette"]').click();
  await page.waitForTimeout(700);
  await page.keyboard.type("layouts");
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  merge("library", await page.evaluate(SCAN_FN));
} catch (e) {
  report.FATAL = e.message;
} finally {
  await browser.close();
}

writeFileSync("tools/_i18n-scan2.json", JSON.stringify(report, null, 2), "utf8");
console.log("written");
