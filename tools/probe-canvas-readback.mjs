/**
 * 诊断：canvas 读回（drawImage → getImageData）是否与"真实截图"一致。
 * 若两者不一致，说明 WebGL 画布的读回时机/内容不可信，像素统计结论也要作废。
 * 用法：node tools/e2e.mjs tools/probe-canvas-readback.mjs
 */
import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";
const OUT = process.env.RACK3D_OUT ?? process.cwd();
const LAYOUT_ID = "probe-readback-0000-4000-8000-000000000001";
const UNITS_PER_U = 6;

const YAML = YAMLNS.default ?? YAMLNS;
const parseYaml = YAML.parse ?? YAMLNS.parse;
const template = parseYaml(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);
const placed = (id, slug, name, uPos) => ({
  id,
  device_type: slug,
  name,
  position: uPos * UNITS_PER_U,
  face: "front",
});
const R1 = [
  placed("d-firewall", "1u-router-firewall", "边界防火墙", 12),
  placed("d-switch", "24-port-switch", "核心交换机", 11),
  placed("d-patch", "24-port-patch-panel", "配线架", 10),
  placed("d-server-1", "1u-server", "应用服务器", 9),
  placed("d-server-2", "1u-server", "备份服务器", 8),
  placed("d-nas", "4u-storage", "NAS 存储", 4),
  placed("d-ups", "2u-ups", "UPS 电源", 2),
];
const layout = {
  version: "26.9.0",
  name: "Probe",
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
      devices: R1,
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "Probe", schema_version: "1.1" },
};

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });

const out = {};
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
      localStorage.removeItem("rack3d_telemetry_bindings");
      localStorage.setItem("rack3d_scene_theme", "dark");
    },
    { layoutId: LAYOUT_ID, layout },
  );

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);
  await page.selectOption(".view-select", "front");
  await page.waitForTimeout(2000);

  out.canvases = await page.evaluate(() =>
    Array.from(document.querySelectorAll("canvas")).map((c) => ({
      cls: c.className,
      parent: c.parentElement?.className ?? "",
      attrW: c.width,
      attrH: c.height,
      cssW: +c.getBoundingClientRect().width.toFixed(1),
      cssH: +c.getBoundingClientRect().height.toFixed(1),
    })),
  );

  // 真实截图（浏览器合成器输出，可信）
  const vp = page.locator(".rack3d-viewport");
  const shotBuf = await vp.screenshot();
  writeFileSync(join(OUT, "probe-viewport.png"), shotBuf);

  // 画布读回（drawImage → getImageData）
  const readback = await page.evaluate(() => {
    const c = document.querySelector(".rack3d-viewport canvas");
    if (!c) return null;
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0);
    const url = tmp.toDataURL("image/png");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const hist = new Map();
    let greenish = 0;
    let nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (r || g || b) nonBlack += 1;
      if (g > r + 8 && g > b + 6 && g > 60) greenish += 1;
      // 量化到 16 级，统计主要颜色
      const kx = `${r >> 4},${g >> 4},${b >> 4}`;
      hist.set(kx, (hist.get(kx) ?? 0) + 1);
    }
    const top = [...hist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, n]) => ({ q: k, n }));
    return { url, size: `${c.width}x${c.height}`, nonBlack, greenish, top };
  });
  if (readback?.url) {
    writeFileSync(
      join(OUT, "probe-readback.png"),
      Buffer.from(readback.url.split(",")[1], "base64"),
    );
  }
  delete readback?.url;
  out.readback = readback;
} catch (e) {
  out.fatal = e.message;
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
