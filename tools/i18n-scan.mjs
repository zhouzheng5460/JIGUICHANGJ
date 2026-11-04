/**
 * i18n 诊断扫描（只报告，不断言）
 * =================================================================================
 * 目标：找出运行期仍以英文呈现的文本，分四类输出：
 *   1) 命令面板：分组标题 / 命令标签 / 底部提示
 *   2) 气泡（bits-ui Tooltip / DragTooltip / PortTooltip）内容
 *   3) 全量可见文本节点中的「纯英文」串（带祖先路径，便于定位）
 *   4) 参与翻译的属性值（title / aria-label / placeholder / alt / data-tooltip）
 *
 * 用法：RACK3D_URL=http://localhost:5200/ node tools/i18n-scan.mjs
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
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-0000000000aa";

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

const out = {};

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });

/** 页面内通用扫描：返回「含拉丁字母且无中文」的串（去重、限长） */
const SCAN_FN = `(() => {
  const HAS_CJK = /[\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]/;
  const HAS_LETTER = /[A-Za-z]/;
  const path = (el) => {
    const parts = [];
    let n = el;
    for (let i = 0; i < 4 && n && n.nodeType === 1; i += 1) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += "#" + n.id;
      const cls = (n.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 3);
      if (cls.length) s += "." + cls.join(".");
      if (n.dataset && n.dataset.testid) s += "[tid=" + n.dataset.testid + "]";
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return false;
    return true;
  };
  const texts = [];
  const seenT = new Set();
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
    if (raw && HAS_LETTER.test(raw) && !HAS_CJK.test(raw) && raw.length < 90) {
      const p = t.parentElement;
      if (p && visible(p)) {
        const key = raw + "||" + path(p);
        if (!seenT.has(key)) { seenT.add(key); texts.push({ text: raw, where: path(p) }); }
      }
    }
    t = walker.nextNode();
  }
  const attrs = [];
  const seenA = new Set();
  const ATTRS = ["title", "aria-label", "placeholder", "alt", "data-tooltip"];
  for (const el of document.querySelectorAll("*")) {
    if (!visible(el)) continue;
    for (const a of ATTRS) {
      const v = (el.getAttribute(a) || "").replace(/\\s+/g, " ").trim();
      if (!v || !HAS_LETTER.test(v) || HAS_CJK.test(v) || v.length > 110) continue;
      const key = a + "=" + v + "||" + path(el);
      if (seenA.has(key)) continue;
      seenA.add(key);
      attrs.push({ attr: a, value: v, where: path(el) });
    }
  }
  return { texts, attrs };
})()`;

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
  await page.waitForTimeout(6000);

  // ---------------- 1. 命令面板 ----------------
  await page.locator('[data-testid="btn-command-palette"]').click();
  await page.waitForTimeout(900);
  out.paletteHeadings = await page
    .locator(".command-group-heading")
    .allInnerTexts();
  out.paletteItems = await page.locator(".command-item").allInnerTexts();
  out.paletteFooter = await page
    .locator(".command-footer")
    .allInnerTexts()
    .catch(() => []);
  const footerHtml = await page
    .locator(".command-footer")
    .first()
    .innerHTML()
    .catch(() => "(none)");
  out.paletteFooterHtml = footerHtml;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ---------------- 2. 全局文本 / 属性 ----------------
  const scan1 = await page.evaluate(SCAN_FN);
  out.textsBeforeHover = scan1.texts;
  out.attrsBeforeHover = scan1.attrs;

  // ---------------- 3. 气泡：逐个 hover 触发 ----------------
  const TRIG_SEL = ".tooltip-trigger, [data-tooltip-trigger]";
  const triggerCount = await page.locator(TRIG_SEL).count();
  out.tooltipTriggerCount = triggerCount;
  out.tooltipTriggerSample = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".tooltip-trigger, [data-tooltip-trigger]"))
      .slice(0, 12)
      .map((e) => (e.getAttribute("class") || "") + " | " + (e.textContent || "").slice(0, 30)),
  );
  const bubbles = [];
  const seenBubble = new Set();
  for (let i = 0; i < triggerCount; i += 1) {
    const trig = page.locator(TRIG_SEL).nth(i);
    try {
      await trig.scrollIntoViewIfNeeded({ timeout: 1500 });
      await trig.hover({ force: true, timeout: 2000 });
      await page.waitForTimeout(420);
      const txt = await page.evaluate(() => {
        const c =
          document.querySelector(".tooltip-content") ||
          document.querySelector('[role="tooltip"]');
        return c
          ? (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim()
          : null;
      });
      if (txt && !seenBubble.has(txt)) {
        seenBubble.add(txt);
        bubbles.push({ i, text: txt });
      }
    } catch {
      /* 该触发器不可 hover，跳过 */
    }
  }
  out.tooltipBubbles = bubbles;

  // 鼠标移开，避免 computedStyle 残留 hover 态
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);

  // ---------------- 4. 3D 视图内气泡 ----------------
  const launched = await page
    .locator(".rack3d-launcher")
    .first()
    .click({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  out.rack3dLaunched = launched;
  if (launched) {
    await page.waitForTimeout(4500);
    const scan3d = await page.evaluate(SCAN_FN);
    out.textsIn3D = scan3d.texts;
    out.attrsIn3D = scan3d.attrs;
  }
} catch (e) {
  out.FATAL = e.message + "\n" + e.stack;
} finally {
  await browser.close();
}

const REPORT = JSON.stringify(compact(out), null, 2);
writeFileSync("tools/_i18n-scan.json", REPORT, "utf8");
console.log("i18n scan written to tools/_i18n-scan.json (" + REPORT.length + " bytes)");

function compact(o) {
  const r = { ...o };
  const flat = (arr, pick) => {
    const seen = new Set();
    const list = [];
    for (const item of arr ?? []) {
      const key = pick(item);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(key);
    }
    return list.sort();
  };
  r.textsBeforeHover = flat(o.textsBeforeHover, (i) => i.text);
  r.attrsBeforeHover = flat(o.attrsBeforeHover, (i) => `${i.attr} = ${i.value}`);
  r.textsIn3D = flat(o.textsIn3D, (i) => i.text);
  r.attrsIn3D = flat(o.attrsIn3D, (i) => `${i.attr} = ${i.value}`);
  r.textsSampleWithPath = (o.textsBeforeHover ?? [])
    .slice(0, 60)
    .map((i) => `${i.text}  @  ${i.where}`);
  r.attrsSampleWithPath = (o.attrsBeforeHover ?? [])
    .slice(0, 60)
    .map((i) => `${i.attr} = ${i.value}  @  ${i.where}`);
  return r;
}
