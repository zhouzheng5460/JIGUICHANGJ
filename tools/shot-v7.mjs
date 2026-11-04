/**
 * 快速截图：暗色 / 亮色主题下各截一张 3D 视口，用于人工确认地面与背景同色。
 * 用法：node tools/e2e.mjs tools/shot-v7.mjs
 */
import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";
const OUT = process.env.RACK3D_OUT ?? process.cwd();
const UNITS_PER_U = 6;
const LAYOUT_ID = "rack3d-demo-0000-4000-8000-000000000004";
const YAML = YAMLNS.default ?? YAMLNS;
const template = (YAML.parse ?? YAMLNS.parse)(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);

const dev = (id, slug, name, u) => ({
  id,
  device_type: slug,
  name,
  position: u * UNITS_PER_U,
  face: "front",
});

const layout = {
  version: "26.9.0",
  name: "Rack3D 主题截图",
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
        dev("d1", "1u-router-firewall", "边界防火墙", 12),
        dev("d2", "24-port-switch", "核心交换机", 11),
        dev("d3", "1u-server", "应用服务器", 9),
        dev("d4", "4u-storage", "NAS 存储", 4),
        dev("d5", "2u-ups", "UPS 电源", 2),
      ],
    },
    {
      id: "rack-2",
      name: "机柜 B",
      height: 12,
      width: 19,
      desc_units: false,
      show_rear: true,
      form_factor: "4-post-cabinet",
      starting_unit: 1,
      position: 1,
      view: "front",
      devices: [dev("d6", "1u-server", "计算节点", 10), dev("d7", "2u-ups", "UPS", 3)],
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "Rack3D 主题截图", schema_version: "1.1" },
};

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });

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
    localStorage.removeItem("rack3d_scene_props");
    localStorage.removeItem("rack3d_scene_theme");
  },
  { layoutId: LAYOUT_ID, layout },
);

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(7000);
await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
await page.waitForTimeout(5000);

await page.evaluate(() => {
  document.querySelectorAll(".foot-btn").forEach((b) => {
    if (b.textContent?.trim() === "重置视角") b.click();
  });
});
await page.waitForTimeout(1800);
await page.screenshot({ path: join(OUT, "v7-ground-dark.png") });

await page.evaluate(() => {
  document.querySelectorAll(".rack3d-tools .seg-btn").forEach((b) => {
    if (b.textContent?.trim() === "亮色") b.click();
  });
});
await page.waitForTimeout(1600);
await page.screenshot({ path: join(OUT, "v7-ground-light.png") });

const state = await page.evaluate(() => {
  const c = window.__rack3d;
  const col = new c.racks[0].frameMaterials[0].color.constructor();
  c.renderer.getClearColor(col);
  return {
    background: col.getHexString(),
    floor: c.floor?.material?.color?.getHexString() ?? null,
  };
});
console.log(JSON.stringify(state));
await browser.close();
