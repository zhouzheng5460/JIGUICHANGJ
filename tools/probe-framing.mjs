/**
 * 一次性诊断：取景相关内部量到底是 NaN 还是 null，源头在哪。
 * 用法：node tools/e2e.mjs tools/probe-framing.mjs
 */
import { chromium } from "playwright-core";
import * as YAMLNS from "yaml";
import { existsSync, readFileSync } from "node:fs";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const URL = process.env.RACK3D_URL ?? "http://localhost:5173/";
const LAYOUT_ID = "probe-layout-0000-4000-8000-000000000001";
const YAML = YAMLNS.default ?? YAMLNS;
const parseYaml = YAML.parse ?? YAMLNS.parse;
const template = parseYaml(
  readFileSync("static/templates/home-lab.rackula.yaml", "utf8"),
);
const UNITS_PER_U = 6;
const placed = (id, slug, name, uPos, face = "front") => ({
  id,
  device_type: slug,
  name,
  position: uPos * UNITS_PER_U,
  face,
});
const layout = {
  version: "26.9.0",
  name: "probe",
  racks: [
    {
      id: "rack-1",
      name: "R1",
      height: 12,
      width: 19,
      desc_units: false,
      show_rear: true,
      form_factor: "4-post-cabinet",
      starting_unit: 1,
      position: 0,
      view: "front",
      devices: [
        placed("dev-firewall", "1u-router-firewall", "边界防火墙", 12),
        placed("dev-switch", "24-port-switch", "核心交换机", 11),
        placed("dev-server-1", "1u-server", "应用服务器", 9),
        placed("dev-nas", "4u-storage", "NAS 存储", 4),
        placed("dev-ups", "2u-ups", "UPS 电源", 2),
      ],
    },
    {
      id: "rack-2",
      name: "R2",
      height: 12,
      width: 19,
      desc_units: false,
      show_rear: true,
      form_factor: "4-post-cabinet",
      starting_unit: 1,
      position: 1,
      view: "front",
      devices: [
        placed("dev2-firewall", "1u-router-firewall", "旁路防火墙", 12),
        placed("dev2-switch", "24-port-switch", "接入交换机", 11),
        placed("dev2-server", "1u-server", "计算节点", 9),
        placed("dev2-storage", "4u-storage", "归档存储", 5),
      ],
    },
  ],
  device_types: template.device_types,
  settings: template.settings,
  metadata: { id: LAYOUT_ID, name: "probe", schema_version: "1.1" },
};

const executablePath = EDGE_PATHS.find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });

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
              name: "probe",
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
      localStorage.setItem(
        "rack3d_telemetry_bindings",
        JSON.stringify([
          {
            id: "bind-1",
            asset_kind: "device",
            asset_id: "dev2-storage",
            label: "归档存储",
            adapter: "mock",
            endpoint: "mock://local",
            metrics: ["power_w", "temp_c", "status", "on_off"],
            point_map: {},
            thresholds: {},
            poll_ms: 1500,
          },
        ]),
      );
    },
    { layoutId: LAYOUT_ID, layout },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.locator(".rack3d-launcher").first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);

  const dump = await page.evaluate(() => {
    const c = window.__rack3d;
    const n = (v) =>
      typeof v === "number" ? (Number.isNaN(v) ? "NaN" : +v.toFixed(6)) : `${typeof v}:${v}`;
    const probe = () => ({
      orthoHalfHeight: n(c?.orthoHalfHeight),
      sceneWidth: n(c?.sceneWidth),
      sceneHeight: n(c?.sceneHeight),
      orthoTopRaw: String(c?.orthoCamera?.top),
    });
    const before = probe();
    c?.resetView();
    const afterReset = probe();
    c?.focusRack("rack-2");
    const afterFocusRack = probe();
    c?.focusDevice("dev2-storage");
    const afterFocusDevice = probe();
    return {
      hasController: !!c,
      before,
      afterReset,
      afterFocusRack,
      afterFocusDevice,
      viewAspect: n(c?.viewAspect),
      viewWidth: n(c?.viewWidth),
      viewHeight: n(c?.viewHeight),
      orthoZoom: n(c?.orthoCamera?.zoom),
      camTop: n(c?.camera?.top),
      camType: c?.camera?.type,
      camPos: c?.camera?.position?.toArray?.().map((x) => +x.toFixed(4)),
      camMode: c?.cameraMode,
      viewPreset: c?.viewPreset,
      theme: c?.theme,
      rackDepth: n(
        (() => {
          try {
            return c.rackDepth();
          } catch (e) {
            return `throw:${e.message}`;
          }
        })(),
      ),
      sceneBoxSize: (() => {
        try {
          const b = c.sceneBox();
          const s = b.getSize(new (c.controls.target.constructor)());
          return { x: n(s.x), y: n(s.y), z: n(s.z) };
        } catch (e) {
          return `throw:${e.message}`;
        }
      })(),
      deviceMeshFound: !!c?.deviceMeshes?.get("dev2-storage"),
      rackFound: !!c?.racks?.find((r) => r.id === "rack-2"),
    };
  });
  console.log("=== PROBE ===\n" + JSON.stringify(dump, null, 2));
} catch (e) {
  console.log("FATAL " + e.message);
} finally {
  await browser.close();
}
