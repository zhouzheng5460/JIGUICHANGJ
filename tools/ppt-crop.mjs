import sharp from "sharp";

const D = "C:/Users/Administrator/WorkBuddy/2026-09-17-10-13-16/机柜3D配置工具产品介绍/assets";
const SRC = `${D}/telemetry.png`;
const meta = await sharp(SRC).metadata();
console.log("source", meta.width, meta.height);

// 上半：链路状态 + 采集源 + 新增数据绑定
await sharp(SRC)
  .extract({ left: 0, top: 60, width: meta.width, height: 1140 })
  .toFile(`${D}/telemetry_source.png`);

// 下半：已绑定资产（偏横向，适合单页铺底）
await sharp(SRC)
  .extract({ left: 0, top: 1140, width: meta.width, height: 664 })
  .toFile(`${D}/telemetry_bound.png`);

console.log("done");
