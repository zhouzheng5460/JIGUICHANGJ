/**
 * Rack3D 机柜三维场景引擎
 * ============================================================================
 * 与框架无关的 Three.js 封装：输入"机柜 + 设备 + 场景元素"的归一化描述，
 * 输出可交互的 3D 场景。Svelte 侧只需要把布局 store 映射成本文件的
 * RackSceneRack[] / SceneProp[]。
 *
 * 建模规则（对齐企划 M2 表 2.1，全部为规则化程序建模，不依赖任何外部模型）：
 *   u_height          → 设备高度 = U 数 × 44.45mm（EIA-310 标准 1U）
 *   is_full_depth     → 全深机箱 / 半深机箱
 *   category / colour → 材质基色
 *   face              → 安装面（front / rear / both）
 *   position          → 以 1/6U 为最小单位的机架内位置
 *   bayed 分组        → 多柜沿 X 轴排列，柜间距 100mm
 *   运行状态（遥测）   → 面板指示灯颜色 + 机身材质整体染色
 *
 * 交互分层：
 *   - 机柜与柜内设备：**只读**，仅支持选中/聚焦，位置由布局数据决定；
 *   - 场景元素（Prop）：可在地平面上摆放、拖动、改色，机柜视为整体不可拆。
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// 状态图标（用户提供的 iconfont SVG，单色字形；以 ?raw 引入后解析 path 数据）
import normalIcon from "./status-icons/正常.svg?raw";
import warnIcon from "./status-icons/告警.svg?raw";
import critIcon from "./status-icons/严重.svg?raw";
import offlineIcon from "./status-icons/离线.svg?raw";

/** EIA-310：1U = 44.45mm */
export const U_HEIGHT_M = 0.04445;
/** Rackula 内部定位单位：每 U 分 6 格 */
export const UNITS_PER_U = 6;
/** 并柜间距 100mm */
const BAY_GAP_M = 0.1;
const INCH_M = 0.0254;

/** 透视相机的基准视场角（正交相机按同一视场角折算等效取景范围） */
const PERSPECTIVE_FOV = 45;

/** 设备运行状态（由遥测层推导） */
export type DeviceStatus = "unknown" | "online" | "warn" | "crit" | "offline";

export const STATUS_COLOURS: Record<DeviceStatus, string> = {
  unknown: "#5a6478",
  online: "#3ddc84",
  warn: "#e0b341",
  crit: "#e05252",
  offline: "#6b7280",
};

/**
 * 机身整体染色强度：状态越异常，机身越向状态色靠拢。
 * 正常态只做轻微偏色，避免"一片绿"失去设备本色。
 */
const STATUS_TINTS: Record<DeviceStatus, number> = {
  unknown: 0,
  online: 0.35,
  warn: 0.62,
  crit: 0.72,
  offline: 0.65,
};

/**
 * 渲染模式（企划 M2 展示层）
 * - `solid`     默认实体渲染
 * - `wireframe` 蓝色线框 + 实体材质（看得清轮廓与结构）
 * - `xray`      蓝色线框 + 机柜半透明（能看穿机柜看到内部设备）
 */
export type RenderMode = "solid" | "wireframe" | "xray";

/**
 * 相机投影方式。
 * Rack3D 默认使用**正交相机**：机柜是规则几何体，正交投影没有透视收缩，
 * 更适合工程标注与尺寸判读。
 */
export type CameraMode = "ortho" | "perspective";

/** 视角预设 */
export type ViewPreset = "iso" | "front" | "side" | "top";

export const VIEW_PRESET_LABELS: Record<ViewPreset, string> = {
  iso: "默认视图（斜视）",
  front: "正视图",
  side: "侧视图",
  top: "顶视图",
};

/** 视角预设对应的相机方位向量（目标点 → 相机） */
const VIEW_DIRECTIONS: Record<ViewPreset, THREE.Vector3> = {
  iso: new THREE.Vector3(0.55, 0.4, 0.73).normalize(),
  front: new THREE.Vector3(0, 0.08, 1).normalize(),
  side: new THREE.Vector3(1, 0.08, 0).normalize(),
  // 顶视图留一点 Z 分量，避免与 +Y 轴完全共线导致方位角退化
  top: new THREE.Vector3(0, 1, 0.02).normalize(),
};

/** 可摆放的基础场景元素 */
export type PropKind = "cube" | "sphere" | "table" | "chair";

export const PROP_KIND_LABELS: Record<PropKind, string> = {
  cube: "立方体",
  sphere: "球体",
  table: "桌子",
  chair: "椅子",
};

/** 场景元素：只记录地平面坐标，高度由模型自身决定（地面优先交互） */
export interface SceneProp {
  id: string;
  kind: PropKind;
  /** 地平面 X（米） */
  x: number;
  /** 地平面 Z（米） */
  z: number;
  /** 绕 Y 轴旋转（弧度） */
  rotation: number;
  /** 主色 */
  colour: string;
}

/** 场景元素可选配色（Dracula 主题色板） */
export const PROP_PALETTE: readonly string[] = [
  "#8be9fd",
  "#50fa7b",
  "#f1fa8c",
  "#ffb86c",
  "#ff79c6",
  "#bd93f9",
  "#f8f8f2",
  "#6272a4",
];

/** 线框颜色：取主题主色 cyan，与「活动机柜高亮」的蓝紫 `#7aa2ff` 区分开 */
const WIRE_COLOUR = 0x8be9fd;
/** 活动机柜高亮色 */
const HIGHLIGHT_COLOUR = 0x7aa2ff;
/** 选中描边色：取主题选中色（粉），与青色线框区分 */
const SELECT_COLOUR = 0xff79c6;

/**
 * 三维场景主题（黑 / 白）。
 *
 * 两套主题都刻意**压低彩度**：机身做灰度化，只保留状态色（绿 / 琥珀 / 红）
 * 承担语义。配色与打光风格对齐参考图「Future Smart Campus」——
 * 近黑的视口底色、浅灰地面、柔和而不刺眼的多光源。
 */
export type SceneTheme = "dark" | "light";

export const SCENE_THEME_LABELS: Record<SceneTheme, string> = {
  dark: "暗色",
  light: "亮色",
};

interface ThemePalette {
  /** 视口清屏色（本场景不使用雾，仅作为背景） */
  background: number;
  /** 地面网格：主线 / 次线 */
  gridMajor: number;
  gridMinor: number;
  /**
   * 地面网格线不透明度。网格只是"地面在哪"的参考，太实会喧宾夺主
   * （尤其亮色主题下深色线在浅底上非常扎眼），统一压到 30%。
   */
  gridOpacity: number;
  /** 地面底板。**与背景同色**：地面只靠网格线示意，不再做成一块可辨的"板" */
  floor: number;
  /** 机柜框架 / 侧板 / U 位刻度线 */
  frame: number;
  side: number;
  tick: number;
  /** 线框叠加层颜色（亮色主题下青色不可见，换深青） */
  wire: number;
  /** 机身灰度化强度：0 = 保留原色，1 = 完全灰度 */
  mono: number;
  /** 设备前面板凹槽 / 指示灯底壳：暗主题下近黑，亮主题下必须是中灰 */
  bezel: number;
  ledBase: number;
  /** 机身明度基准：把各种基色收敛到同一档明度，避免深浅差异过大 */
  deviceLightness: number;
  /**
   * 材质金属度 / 粗糙度。
   * 关键坑位：three.js 的 MeshStandardMaterial 在**没有环境贴图**时，
   * 金属度越高漫反射越少、镜面又无处可反射 → 直接渲染成近黑。
   * 暗色主题下"近黑金属"是想要的效果，亮色主题下就是灾难（浅底黑块），
   * 所以必须由主题决定，而不是写死在材质里。
   */
  frameMetalness: number;
  frameRoughness: number;
  deviceMetalness: number;
  deviceRoughness: number;
  sideMetalness: number;
  /** 环境光 / 半球光 / 主光 / 补光 */
  ambient: number;
  ambientIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyIntensity: number;
  fillColour: number;
  fillIntensity: number;
  /** 实体模式下侧板的不透明度 */
  sideOpacity: number;
}

const THEMES: Record<SceneTheme, ThemePalette> = {
  dark: {
    // #191a21：与 2D 画布背景一致（用户指定）；配合合并通道的 sRGB 输出编码，
    // 所见即所得（此前合并通道缺这步编码，任何背景色都会显示得远比设定值黑）
    background: 0x191a21,
    gridMajor: 0x4a5364,
    gridMinor: 0x2f3644,
    gridOpacity: 0.3,
    // 地面与背景同色（0x191a21）：地面不再是一块可辨的"板"，
    // 只靠 30% 的网格线示意"地面在哪"，机柜因此显得干净、不压背景。
    floor: 0x191a21,
    frame: 0x828c99,
    side: 0x39404c,
    tick: 0x4b5361,
    wire: 0x8be9fd,
    mono: 0.85,
    bezel: 0x1b1f27,
    ledBase: 0x2a2f3a,
    deviceLightness: 0.72,
    // 金属度从 0.65 降到 0.35：无环境贴图时金属度会让漫反射变暗，
    // 暗色主题保留一点金属感即可，整体亮度靠降低金属度 + 提高半球光拿到。
    frameMetalness: 0.35,
    frameRoughness: 0.6,
    deviceMetalness: 0.12,
    deviceRoughness: 0.6,
    sideMetalness: 0.15,
    ambient: 0xffffff,
    ambientIntensity: 0.72,
    hemiSky: 0xe6edfa,
    // 半球光的地面色决定"朝下 / 背光面"的补光强度。
    // 原值 0x2b313c 太暗，等于把模型的暗部又压了一遍，这里提到中灰。
    hemiGround: 0x59626f,
    hemiIntensity: 2.8,
    keyIntensity: 2.2,
    fillColour: 0xa8c4ff,
    fillIntensity: 1.45,
    sideOpacity: 0.32,
  },
  light: {
    background: 0xe9e9e9,
    gridMajor: 0xa4acb7,
    gridMinor: 0xc5cbd3,
    gridOpacity: 0.3,
    // 同暗色：地面与背景同色（0xe9e9e9）。旧值 0xe8ebef 比背景还亮，
    // 整块地面白得发飘，把机柜压成了剪影。
    floor: 0xe9e9e9,
    frame: 0xb2bac4,
    side: 0xd6dbe2,
    tick: 0xc0c7d0,
    wire: 0x0e7490,
    mono: 0.88,
    bezel: 0x7c848e,
    ledBase: 0x9aa2ac,
    deviceLightness: 0.88,
    // 亮色主题刻意做成"哑光"：低金属度 + 高粗糙度，避免浅底上的黑块
    frameMetalness: 0.06,
    frameRoughness: 0.82,
    deviceMetalness: 0.04,
    deviceRoughness: 0.62,
    sideMetalness: 0.05,
    ambient: 0xffffff,
    ambientIntensity: 1.0,
    hemiSky: 0xffffff,
    hemiGround: 0xced3da,
    hemiIntensity: 2.3,
    keyIntensity: 1.9,
    fillColour: 0xdce6ff,
    fillIntensity: 1.0,
    sideOpacity: 0.55,
  },
};

/** 把数据里的基色折算成当前主题下的机身色（灰度化 + 明度收敛） */
function themeDeviceColour(
  dataColour: THREE.Color,
  palette: ThemePalette,
): THREE.Color {
  const out = dataColour.clone();
  const lum = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
  out.lerp(new THREE.Color(lum, lum, lum), palette.mono);
  const target = palette.deviceLightness;
  out.lerp(new THREE.Color(target, target, target), 0.3);
  return out;
}

/** 二维数据卡片估算尺寸（CSS 像素）：仅用于把弹窗夹取在视口内 */
const POPUP_WIDTH = 248;
const POPUP_HEIGHT = 250;
/** 卡片与锚点的间距 */
const POPUP_GAP = 14;
/** 卡片与视口边缘的安全边距 */
const POPUP_MARGIN = 8;

/** 场景元素浮动条的估算尺寸 */
const BAR_WIDTH = 208;
const BAR_HEIGHT = 44;

/** 点击 / 拖拽判定阈值（CSS 像素） */
const CLICK_SLOP = 5;

/**
 * 取景填充比：目标在视窗「较吃紧的那一维」上占的比例。
 * 距离 = 需要的半高 / 填充比，所以 0.8 = 目标约占视窗 80%。
 * 竖长视口下机柜/设备都是「横向更吃紧」，因此实际表现就是「宽度占 80%/85%」。
 */
const FRAME_FILL_RACK = 0.8;
const FRAME_FILL_DEVICE = 0.7;
/** 全场景取景（视角预设 / 重置视角 / 清空选中）：整排机柜宽度占视窗 80% */
const FRAME_FILL_SCENE = 0.8;

/** 选中轮廓：ID/深度遮罩层（该层对象只在遮罩通道渲染） */
const MASK_LAYER = 1;
/** 轮廓粗细（像素，按膨胀半径折算） */
const OUTLINE_THICKNESS = 1.6;
/** 未被遮挡的轮廓强度 */
const OUTLINE_ALPHA = 0.92;
/**
 * **被遮挡**的轮廓强度。
 * 被柜体/设备挡住的那一段轮廓不整个抹掉，而是以较低强度显示 ——
 * 既保留"选中物体在这个方位"的空间感，又明显弱于露出来的那一段。
 *
 * 取值权衡：低于 ~0.4 时，叠在深色柜体/背景上会退化成几乎不可见的暗红，
 * 失去"提示方位"的意义；0.45 能稳定看出是选中色，又只有满强度的一半。
 */
const OUTLINE_OCCLUDED_ALPHA = 0.45;
/**
 * 深度比较容差（归一化深度）。
 * 必须远小于"遮挡物与选中物之间的深度差"，否则会把遮挡误判成可见。
 * 正交相机的裁剪面收得很紧（0.05~60m），24 位深度下 1e-6 约合 2 个深度步进。
 */
const OUTLINE_DEPTH_BIAS = 0.000001;

export interface RackSceneDevice {
  id: string;
  label: string;
  /** 高度（U） */
  uHeight: number;
  /** 1 = 半宽，2 = 全宽 */
  slotWidth: 1 | 2;
  /** 位置（内部单位，从机柜底部起算） */
  position: number;
  face: "front" | "rear" | "both";
  /** 设备基色 */
  colour: string;
  isFullDepth: boolean;
  /** 已绑定的指标摘要（用于悬浮提示） */
  metrics?: Record<string, string>;
}

export interface RackSceneRack {
  id: string;
  name: string;
  heightU: number;
  /** 机柜宽度（英寸） */
  widthIn: number;
  depthMm: number;
  formFactor: string;
  devices: RackSceneDevice[];
}

export interface RackSceneOptions {
  /** 高亮的机柜 */
  activeRackId?: string | null;
  /** 高亮的设备 */
  selectedDeviceId?: string | null;
  /** 是否渲染半透明侧板（柜式机柜） */
  showSidePanels?: boolean;
}

interface RackRuntime {
  id: string;
  group: THREE.Group;
  /** 设备 id → 其材质列表（用于状态着色） */
  deviceMaterials: Map<string, THREE.MeshStandardMaterial[]>;
  /** 设备 id → 指示灯材质 */
  deviceLeds: Map<string, THREE.MeshStandardMaterial>;
  /** 机柜框架（立柱 / 顶底板 / 侧板）材质，用于 xray 模式切换透明度 */
  frameMaterials: THREE.MeshStandardMaterial[];
  /** 侧板材质（xray 下要更透明） */
  sideMaterials: THREE.MeshStandardMaterial[];
  /** 蓝色线框叠加层（solid 模式下隐藏） */
  wireGroup: THREE.Group;
  /** 线框材质（主题切换要改色；亮色主题下青色不可见，需换深青） */
  wireMaterials: THREE.LineBasicMaterial[];
  /** 机柜顶部常驻名称标签（Sprite + 画布纹理；选中且该柜弹窗打开时隐藏） */
  labelSprite: THREE.Sprite | null;
  /** 机柜实体宽度（世界单位），用于约束标签最大宽度 ≤ 机柜宽 */
  rackWidthM: number;
  /** 标签显示的名称（机柜名），状态汇总重绘时复用 */
  labelName: string;
  /** 状态汇总签名：内容未变时跳过重绘，避免逐帧重建纹理（性能） */
  labelSig: string;
  /** 设备面板凹槽 / 指示灯底壳：颜色也随主题走 */
  bezelMaterials: THREE.MeshStandardMaterial[];
  ledMaterials: THREE.MeshStandardMaterial[];
}

/** 相机取景动画（聚焦机柜 / 设备 / 复位）：球坐标最短弧插值，避免跨视角转圈 */
interface FramingTween {
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromRadius: number;
  toRadius: number;
  fromAzimuth: number;
  toAzimuth: number;
  fromPolar: number;
  toPolar: number;
  fromHalf: number;
  toHalf: number;
  startedAt: number;
  duration: number;
}

/** 把「相机位置 - 目标」分解为球坐标（方位角 / 极角 / 半径） */
function cameraSpherical(
  position: THREE.Vector3,
  target: THREE.Vector3,
): { radius: number; azimuth: number; polar: number } {
  const dir = position.clone().sub(target);
  const radius = Math.max(dir.length(), 1e-4);
  const azimuth = Math.atan2(dir.x, dir.z);
  const polar = Math.acos(clamp(dir.y / radius, -1, 1));
  return { radius, azimuth, polar };
}

/** 角度差取余到 (-π, π]，保证沿最短弧插值（不会转一大圈） */
function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** 由球坐标 + 目标点还原相机位置 */
function sphericalToPosition(
  radius: number,
  azimuth: number,
  polar: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const sinP = Math.sin(polar);
  return new THREE.Vector3(
    target.x + radius * sinP * Math.sin(azimuth),
    target.y + radius * Math.cos(polar),
    target.z + radius * sinP * Math.cos(azimuth),
  );
}

/** 兜底色：当设备未定义颜色时使用静音青（与 Rackula server 类目一致） */
const FALLBACK_COLOUR = "#4a7a8a";

/**
 * 「选中了某个机柜」时，其它机柜的降透明度档位。
 * 柜体框架 / 侧板 / 柜内设备一起降，否则会出现"柜壳淡了但里面设备还是实心"，
 * 视觉上依旧抢眼、起不到聚焦当前柜的作用。
 * 指示灯刻意留得比机身更实，保证状态色还能读出来。
 */
const DIM_FRAME_OPACITY = 0.15;
const DIM_SIDE_OPACITY = 0.1;
const DIM_DEVICE_OPACITY = 0.15;
const DIM_LED_OPACITY = 0.15;

/**
 * 机柜顶部常驻名称标签：用画布纹理画一张"深色药丸 + 白字"的 Sprite。
 * 深色药丸在暗色与亮色背景下都可读，因此不随主题重绘；depthTest 关掉 +
 * renderOrder 顶到最高，保证标签始终浮在机柜之上（即便机柜转到背面）。
 */
/** 机柜标签上的状态汇总小项：状态图标 + 计数文本 */
interface LabelChip {
  text: string;
  /** 状态类型，决定画哪一个图标（online/warn/crit/offline） */
  status: DeviceStatus;
  color: string;
}

/**
 * 机柜顶部常驻名称标签：用画布纹理画一张"深色药丸 + 白字"的 Sprite。
 * 深色药丸在暗色与亮色背景下都可读，因此不随主题重绘；depthTest 关掉 +
 * renderOrder 顶到最高，保证标签始终浮在机柜之上（即便机柜转到背面）。
 *
 * 标签可叠加一行状态汇总（彩色圆点 + 计数，如「3/4 ● 1 ● 1」）：
 * 仅展示非 0 的状态类型，按提示类型换行并居中，整体宽度不超过机柜宽度。
 */
function makeRackLabelSprite(
  name: string,
  chips: LabelChip[] = [],
  maxWidthPx = 240,
): THREE.Sprite {
  const { canvas, aspect } = renderLabelTexture(name, chips, maxWidthPx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  // 高度基准 0.18 世界单位，宽度按画布比例伸缩（文字越长标签越宽）。
  // 实际每帧尺寸由 updateLabelPixels() 换算成固定像素高，这里只是首帧前的初值。
  sprite.userData.labelAspect = aspect;
  sprite.scale.set(0.18 * aspect, 0.18, 1);
  sprite.renderOrder = 999;
  // 名称标签只是装饰性叠加层，绝不能参与射线拾取：
  // 否则点机柜顶部附近会误命中标签、或在 xray 下挡住柜内设备的穿透点击。
  sprite.raycast = () => {};
  return sprite;
}

/** 圆角矩形路径（兼容无 ctx.roundRect 的环境） */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 各状态对应的图标子路径（从用户提供的 SVG 中解析）。
 * 这些 SVG 是"单色图标字体"风格：主体是一个大圆盘、细节是 X / 感叹号 / 对勾 /
 * 斜杠。若整团填充同色会变成实心圆盘、辨识度差，因此**只取细节子路径**，
 * 画在状态色底盘上（白色字形），既保留状态色、又一眼可辨形状。
 * 索引取自各文件「以 M 开头的有效 path」顺序：
 *   正常  → [圆盘, 对勾]           取对勾
 *   告警  → [圆盘, 感叹号]         取感叹号
 *   严重  → [X 臂1, X 臂2, 圆盘]    取 X 两臂
 *   离线  → [月牙, 圆+斜杠]         取圆+斜杠（断连符）
 */
function svgIconPaths(raw: string): string[] {
  const out: string[] = [];
  const re = /d="(M[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

const STATUS_ICON_PATHS: Record<string, string[]> = {
  online: svgIconPaths(normalIcon).filter((_, i) => i === 1),
  warn: svgIconPaths(warnIcon).filter((_, i) => i === 1),
  crit: svgIconPaths(critIcon).filter((_, i) => i === 0 || i === 1),
  offline: svgIconPaths(offlineIcon).filter((_, i) => i === 1),
};

/** 在 (cx,cy) 处画一个"状态色底盘 + 白色字形"的状态图标（替代纯色圆点） */
function drawStatusIcon(
  ctx: CanvasRenderingContext2D,
  status: DeviceStatus,
  cx: number,
  cy: number,
  tokenR: number,
): void {
  const colour =
    STATUS_COLOURS[status as keyof typeof STATUS_COLOURS] ?? "#888888";
  ctx.beginPath();
  ctx.arc(cx, cy, tokenR, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  const ds = STATUS_ICON_PATHS[status];
  if (!ds || ds.length === 0) return;
  // viewBox 1024×1024 → 缩放到底盘内（直径约 tokenR*1.7），并以底盘中心对齐
  const s = (tokenR * 1.7) / 512;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-512, -512);
  ctx.fillStyle = "#f4f6fb";
  for (const d of ds) ctx.fill(new Path2D(d));
  ctx.restore();
}

/**
 * 渲染标签纹理（机柜名 + 可选状态汇总）。
 * - 机柜名 + 状态汇总作为**一个整体内容块**，垂直居中于深色药丸（上下对称留白）；
 * - 状态汇总按 maxWidthPx 折行（每个类型独立成 chip、居中），类型间留间距；
 * - 每个 chip 由「状态图标（底盘+字形）+ 计数」构成，替代原先的纯色圆点；
 * - 返回的 canvas 宽高比用于 Sprite 缩放，配合 maxWidthPx 约束标签不会比机柜宽太多。
 */
function renderLabelTexture(
  name: string,
  chips: LabelChip[],
  maxWidthPx: number,
): { canvas: HTMLCanvasElement; aspect: number } {
  const nameFont =
    "600 30px -apple-system, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif";
  const chipFont =
    "600 26px -apple-system, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif";
  const padX = 26;
  const padY = 12; // 上下对称留白 → 内容整体垂直居中
  const tokenR = 11;
  const tokenTextGap = 8;
  const chipGapX = 18;
  const nameH = 38;
  const chipLineH = 28;
  const lineGap = 8;

  type LaidChip = {
    text: string;
    status: DeviceStatus;
    color: string;
    w: number;
    textW: number;
  };

  const measure = document.createElement("canvas").getContext("2d");
  let nameW = 140;
  const laid: LaidChip[] = [];
  if (measure) {
    measure.font = nameFont;
    nameW = measure.measureText(name).width;
    measure.font = chipFont;
    for (const c of chips) {
      const textW = measure.measureText(c.text).width;
      laid.push({
        text: c.text,
        status: c.status,
        color: c.color,
        textW,
        w: tokenR * 2 + tokenTextGap + textW,
      });
    }
  }

  // 按 maxWidthPx 把 chip 贪心折行（每个类型一行起始，超出则换行，每行居中）
  const lines: LaidChip[][] = [];
  if (laid.length > 0) {
    let cur: LaidChip[] = [];
    let curW = 0;
    for (const c of laid) {
      const add = (cur.length === 0 ? 0 : chipGapX) + c.w;
      if (curW + add > maxWidthPx && cur.length > 0) {
        lines.push(cur);
        cur = [c];
        curW = c.w;
      } else {
        cur.push(c);
        curW += add;
      }
    }
    if (cur.length > 0) lines.push(cur);
  }

  const lineWidths = lines.map((l) =>
    l.reduce((s, c, i) => s + (i === 0 ? 0 : chipGapX) + c.w, 0),
  );
  const chipBlockW = lineWidths.length ? Math.max(...lineWidths) : 0;
  const contentW = Math.max(nameW, chipBlockW);
  const contentH =
    nameH + (lines.length > 0 ? lineGap + lines.length * chipLineH : 0);
  // 画布宽度按「文字内容的最大宽度」自适应（机柜名可能超过 chip 折行上限，
  // 之前的上限钳制会把长机柜名截断），不再做上限裁切；
  // maxWidthPx 仅用于状态 chips 的折行。
  const canvasW = Math.max(120, Math.ceil(contentW) + padX * 2);
  const canvasH = Math.max(48, Math.ceil(contentH) + padY * 2);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // 深色药丸底（铺满整张 canvas，内容块已垂直居中）
    ctx.fillStyle = "rgba(18,20,26,0.82)";
    roundRectPath(ctx, 4, 4, canvasW - 8, canvasH - 8, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(139,233,253,0.45)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, 4, 4, canvasW - 8, canvasH - 8, 14);
    ctx.stroke();

    const contentTop = (canvasH - contentH) / 2;

    // 机柜名（内容块顶部，垂直居中于 nameH 行）
    ctx.fillStyle = "#e8eaf0";
    ctx.font = nameFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, canvasW / 2, contentTop + nameH / 2);

    // 状态汇总行（按提示类型换行、居中）
    let y = contentTop + nameH + (lines.length > 0 ? lineGap : 0);
    for (const line of lines) {
      const lw = line.reduce(
        (s, c, i) => s + (i === 0 ? 0 : chipGapX) + c.w,
        0,
      );
      let x = (canvasW - lw) / 2;
      const cy = y + chipLineH / 2;
      for (const c of line) {
        drawStatusIcon(ctx, c.status, x + tokenR, cy, tokenR);
        x += tokenR * 2 + tokenTextGap;
        ctx.fillStyle = "#e8eaf0";
        ctx.font = chipFont;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(c.text, x, cy);
        x += c.textW + chipGapX;
      }
      y += chipLineH;
    }
  }

  return { canvas, aspect: canvas.width / canvas.height };
}

function safeColour(value: string | undefined): string {
  if (!value) return FALLBACK_COLOUR;
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)
    ? trimmed
    : FALLBACK_COLOUR;
}

/** 材质是否为半透明：射线拾取时用它决定"看穿"还是"挡住" */
function isTransparent(object: THREE.Object3D): boolean {
  const material = (object as THREE.Mesh).material as
    | THREE.Material
    | THREE.Material[]
    | undefined;
  if (!material) return false;
  if (Array.isArray(material)) return material.some((m) => m.transparent);
  return material.transparent === true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 缓出：起步快、收尾稳，适合"跳到目标"的镜头运动 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class RackSceneController {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private perspectiveCamera: THREE.PerspectiveCamera;
  private orthoCamera: THREE.OrthographicCamera;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();

  private root = new THREE.Group();
  private racks: RackRuntime[] = [];
  private propGroup = new THREE.Group();
  /** 供地平面拾取使用的数学平面（y = 0） */
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** 摆放模式下淡显的地面提示面 */
  private groundHint: THREE.Mesh;

  private frameHandle: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  /** 场景尺寸（米），用于自适应相机 */
  private sceneWidth = 1;
  private sceneHeight = 1;

  /** 画布 CSS 尺寸，用于把三维坐标投影成弹窗的屏幕坐标 */
  private viewWidth = 1;
  private viewHeight = 1;
  private viewAspect = 1;

  /** 当前渲染模式 */
  private renderMode: RenderMode = "solid";
  /** 当前场景主题（黑 / 白） */
  private sceneTheme: SceneTheme = "dark";
  /** 当前相机投影方式 */
  private cameraMode: CameraMode = "ortho";
  /** 当前视角预设 */
  private viewPreset: ViewPreset = "iso";
  /** 正交相机取景半高（米）；透视相机下同步记录等效值，便于两相机互切 */
  private orthoHalfHeight = 1;

  /** 环境光照对象（主题切换时改颜色与强度） */
  private ambientLight: THREE.AmbientLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private grid: THREE.GridHelper | null = null;
  private floor: THREE.Mesh | null = null;

  /** 最近一次下发的设备状态（主题切换后要重新上色） */
  private lastStatuses: Record<string, DeviceStatus> = {};

  /** 是否处于摆放模式（左键操作场景元素，否则操作相机/选中） */
  private placementMode = false;
  /** 当前选中的场景元素 */
  private selectedPropId: string | null = null;
  /** 当前选中的设备 */
  private selectedDeviceId: string | null = null;

  /** 设备 id → 机身 Mesh（选中描边需要） */
  private deviceMeshes = new Map<string, THREE.Mesh>();
  /** 设备 id → 弹窗锚点（设备顶部前缘） */
  private deviceAnchors = new Map<string, THREE.Object3D>();
  /** 场景元素 id → 浮动条锚点（元素顶部） */
  private propAnchors = new Map<string, THREE.Object3D>();
  /** 场景元素 id → 该元素的全部材质（改色需要） */
  private propMaterials = new Map<string, THREE.MeshStandardMaterial[]>();
  /** 机柜 id → 机柜弹窗锚点（柜顶中心） */
  private rackAnchors = new Map<string, THREE.Object3D>();

  /** 当前选中的机柜（与 2D 活动机柜是两件事：这里管轮廓 + 他柜半透明） */
  private selectedRackId: string | null = null;
  /** 2D 画布的活动机柜（只影响 U 位刻度线高亮），主题切换后需要复原高亮 */
  private activeRackId: string | null = null;

  // ---- Selection Outline 后处理管线（深度/ID 遮罩 + 合并通道） ----
  /** 主通道：颜色 + 深度纹理 */
  private sceneRT!: THREE.WebGLRenderTarget;
  /** 遮罩通道：选中对象被渲染成纯色，并单独输出深度 */
  private maskRT!: THREE.WebGLRenderTarget;
  /** 合并通道用的全屏四边形（屏幕空间，与主相机无关） */
  private compositeScene!: THREE.Scene;
  private compositeCamera!: THREE.OrthographicCamera;
  private compositeMaterial!: THREE.ShaderMaterial;
  /** 遮罩通道的覆盖材质：只写 alpha=1 的纯色 */
  private maskMaterial!: THREE.MeshBasicMaterial;
  /** 当前是否有遮罩可合成 */
  private maskActive = false;

  /** 取景动画 */
  private tween: FramingTween | null = null;

  /** 点击选中回调（传出机柜 id） */
  onSelectRack: ((rackId: string | null) => void) | null = null;

  /** 点击设备回调（传出 { rackId, deviceId }；点空白处传 null） */
  onSelectDevice:
    | ((payload: { rackId: string; deviceId: string } | null) => void)
    | null = null;

  /** 点击场景元素回调 */
  onSelectProp: ((propId: string | null) => void) | null = null;

  /** 在指定地面坐标新建元素（摆放模式下点击地面时触发） */
  onPlaceProp: ((x: number, z: number) => void) | null = null;

  /** 元素被拖动到新位置（拖拽过程中持续触发，用于实时同步） */
  onPropMoved: ((propId: string, x: number, z: number) => void) | null = null;

  /** 元素拖动结束（用于落库持久化） */
  onPropMoveEnd: ((propId: string, x: number, z: number) => void) | null = null;

  /** 每帧回调（用于让二维弹窗跟随三维锚点移动） */
  onFrame: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 地面阴影：开启阴影贴图。低分辨率 + 软阴影（PCFSoft）换取性能，
    // 阴影只投到独立的 ShadowMaterial 接影板，不渲染到地面本身。
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 与 THEMES.dark.background 保持一致（applyTheme 会按主题再刷一次）
    this.renderer.setClearColor(0x191a21, 1);

    // 关键：three.js 的 `raycaster.params.Line.threshold` 默认是 **1（世界单位）**，
    // 也就是 1 米。本场景整体只有 ~1 米见方，于是机柜的 U 位刻度线与线框叠加层
    // 会「全屏处处命中」，多机柜拾取永远锁定到第一个机柜（后排机柜点不中）。
    // 收紧到 4mm，让线框只在其真实位置附近才可能被命中。
    this.raycaster.params.Line = { threshold: 0.004 };
    this.raycaster.params.Points = { threshold: 0.01 };

    this.scene = new THREE.Scene();
    // 刻意**不使用雾**：本场景整体只有 ~1 米见方，任何有意义的 fog near/far 都会
    // 把机柜"洗"成背景色，导致模型发灰、暗部更暗（用户明确要求去掉雾效果）。
    // 需要纵深层次时靠地面网格 + 光照方向表达，而不是靠雾。

    this.perspectiveCamera = new THREE.PerspectiveCamera(
      PERSPECTIVE_FOV,
      1,
      0.01,
      200,
    );
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 60);
    this.camera = this.orthoCamera;

    // 注意：必须先注册自己的指针监听，再创建 OrbitControls。
    // 同一个元素上的同类监听按注册顺序触发，先注册才能在 OrbitControls 之前
    // 把 controls.enabled 关掉（拖动场景元素时不能让相机跟着转）。
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerUp);

    this.controls = this.createControls();

    this.scene.add(this.root);
    this.scene.add(this.propGroup);

    this.groundHint = this.buildGroundHint();
    this.scene.add(this.groundHint);

    this.buildEnvironment();
    this.buildPostPipeline();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.animate();
  }

  // ------------------------------------------------------------ Selection Outline
  /**
   * 构建「深度 / ID 遮罩 + 合并通道」的选中轮廓管线。
   *
   * 三段式：
   *   1. 主通道：整个场景渲染进 `sceneRT`（颜色 + 深度纹理）；
   *   2. 遮罩通道：只把**选中对象**渲染进 `maskRT`（纯色 + 独立深度纹理）；
   *   3. 合并通道：全屏四边形同时采样两张颜色与两张深度，
   *      对遮罩做邻域膨胀得到轮廓环，并用深度比较判断该处是否被其它几何体遮挡。
   *
   * 这样做的好处正是需求里说的两点：轮廓**屏幕空间等宽**（不受物体远近影响），
   * 且因为参与深度比较，会被前方几何体**正确遮挡**。
   */
  private buildPostPipeline(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());

    const sceneDepth = new THREE.DepthTexture(size.x, size.y);
    sceneDepth.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      depthTexture: sceneDepth,
      depthBuffer: true,
      // WebGL2 下用多重采样渲染目标，补偿「渲染到 RT 会丢掉 canvas 的 MSAA」。
      // 前提是深度附件仍可被采样——若驱动/版本组合下深度解析不生效，
      // 合并通道的遮挡判定会整体失效（顶视图轮廓会浮在柜体外面），
      // 此时必须把 samples 降回 0（见 tools/rack3d-verify-v3.mjs 的 E 断言）。
      samples: 4,
    });

    const maskDepth = new THREE.DepthTexture(size.x, size.y);
    maskDepth.type = THREE.UnsignedIntType;
    this.maskRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      depthTexture: maskDepth,
      depthBuffer: true,
      samples: 4,
    });

    this.maskMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      // 遮罩必须是"实心一块"，不受原材质透明度影响
      transparent: false,
      depthWrite: true,
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tMask: { value: this.maskRT.texture },
        tSceneDepth: { value: sceneDepth },
        tMaskDepth: { value: maskDepth },
        uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
        uColour: { value: new THREE.Color(SELECT_COLOUR) },
        uThickness: { value: OUTLINE_THICKNESS },
        uHasMask: { value: 0 },
        uDepthBias: { value: OUTLINE_DEPTH_BIAS },
        uAlpha: { value: OUTLINE_ALPHA },
        uOccludedAlpha: { value: OUTLINE_OCCLUDED_ALPHA },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tMask;
        uniform sampler2D tSceneDepth;
        uniform sampler2D tMaskDepth;
        uniform vec2 uTexel;
        uniform vec3 uColour;
        uniform float uThickness;
        uniform float uHasMask;
        uniform float uDepthBias;
        uniform float uAlpha;
        uniform float uOccludedAlpha;
        varying vec2 vUv;

        /**
         * 采样"选中物体"在该像素上的两个事实，返回 vec2(是否覆盖, 是否可见)。
         *
         * 主通道里被选中的物体**本身也参与了渲染**，所以深度比较是自洽的：
         *   可见   ⟺ 场景深度 ≈ 遮罩深度（自己就是最靠前的那个面）
         *   被遮挡 ⟺ 场景深度 < 遮罩深度 - 容差（前面还有别的几何体）
         * 半透明件不写深度，因此不会把轮廓挡掉，与"透视模式能看穿柜体"
         * 的既有观感一致。
         */
        vec2 sampleMask(vec2 uv) {
          float m = texture2D(tMask, uv).r;
          float sD = texture2D(tSceneDepth, uv).x;
          float mD = texture2D(tMaskDepth, uv).x;
          float front = step(mD - uDepthBias, sD);
          return vec2(m, m * front);
        }

        void main() {
          vec4 scene = texture2D(tScene, vUv);
          vec3 colour = scene.rgb;

          if (uHasMask > 0.5) {
            // 本像素的两个事实：
            //   occupied = 选中物覆盖了它（决定"这里该不该画环"）
            //   hidden   = 有选中物覆盖，但前边被别的几何体挡住了（由 sampleMask 判定）
            vec2 own = sampleMask(vUv);
            float occupied = step(0.5, own.x);
            float visible = step(0.5, own.y);

            // 两次邻域膨胀，分别统计"露出来的选中面"与"被挡住的选中面"：
            //   visDil > 0.5 → 附近有露出来的选中面
            //   occDil > 0.5 → 附近有选中面（无论露没露出来）
            float visDil = visible;
            float occDil = occupied;
            for (int i = -2; i <= 2; i++) {
              for (int j = -2; j <= 2; j++) {
                vec2 at = vUv + vec2(float(i), float(j)) * uTexel * uThickness;
                vec2 s = sampleMask(at);
                visDil = max(visDil, step(0.5, s.y));
                occDil = max(occDil, step(0.5, s.x));
              }
            }

            // 轮廓环 = 「邻域里存在选中面」且「本像素自身不被选中物覆盖」。
            // 先按覆盖膨胀、再扣掉本体，等价于"贴着选中物的投影轮廓描一圈"。
            float ringVisible = visDil * (1.0 - occupied);
            float ringOccluded = occDil * (1.0 - occupied);
            if (ringVisible >= 0.5 || ringOccluded >= 0.5) {
              // 露出来的那一段用满强度；被模型挡住的那一段仍画，但明显减弱 ——
              // 既保留"选中物在这个方位"的空间暗示，又不喧宾夺主。
              float strength = ringVisible >= 0.5 ? uAlpha : uOccludedAlpha;
              colour = mix(scene.rgb, uColour, strength);
            }
          }

          gl_FragColor = vec4(colour, 1.0);
          // ⚠️ 必须做 linear→sRGB 输出转换！主通道渲进 sceneRT（RT 纹理默认线性空间），
          // 这里的 gl_FragColor 直写 canvas 时浏览器会把线性值当 sRGB 显示，
          // 整个场景（含背景清屏色）会大幅偏暗：#21222c 实际显示 ≈ #080a0d，
          // 表现就是"地面/背景颜色怎么改都还是很黑"。#include <colorspace_fragment>
          // 会按 renderer.outputColorSpace（sRGB）在着色器里补上这步编码。
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.compositeScene = new THREE.Scene();
    this.compositeScene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial),
    );
  }

  /** 渲染目标尺寸跟随画布（包含设备像素比） */
  private resizeRenderTargets(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT.setSize(size.x, size.y);
    this.maskRT.setSize(size.x, size.y);
    this.compositeMaterial.uniforms.uTexel!.value.set(1 / size.x, 1 / size.y);
  }

  /** 一帧的完整渲染：主通道 → 遮罩通道 → 合并通道 */
  private renderFrame(): void {
    const renderer = this.renderer;

    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    if (this.maskActive) {
      const previousAutoClear = renderer.autoClear;
      const previousClearAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(this.maskRT);
      renderer.setClearAlpha(0);
      renderer.clear();
      // 覆盖材质把选中对象渲成纯白；相机只保留遮罩层 → 场景其它部分完全不参与
      const previousOverride = this.scene.overrideMaterial;
      const previousMask = this.camera.layers.mask;
      this.scene.overrideMaterial = this.maskMaterial;
      this.camera.layers.set(MASK_LAYER);
      renderer.autoClear = false;
      renderer.render(this.scene, this.camera);
      renderer.autoClear = previousAutoClear;
      this.camera.layers.mask = previousMask;
      this.scene.overrideMaterial = previousOverride;
      renderer.setClearAlpha(previousClearAlpha);
    }

    this.compositeMaterial.uniforms.uHasMask!.value = this.maskActive ? 1 : 0;
    renderer.setRenderTarget(null);
    renderer.render(this.compositeScene, this.compositeCamera);
  }

  /** 用当前相机新建一套轨道控制器（相机切换时必须重建） */
  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.2;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(0, 0.9, 0);
    controls.update();
    return controls;
  }

  // ------------------------------------------------------------ 环境
  /**
   * 光照按"棚拍"思路布置，目标是**模型通体明亮、暗部不糊**：
   *   1. 环境光抬底     —— 保证任何朝向的面都有基础亮度
   *   2. 半球光（主角） —— 天空色照顶面、地面色照底面/背光面，
   *                        专门用来"照亮暗部"（比纯方向光更柔、不留死黑）
   *   3. 主光给方向感   —— 高强度方向光，制造明暗对比与体积感
   *   4. 补光压死黑     —— 冷色补光从反侧铺过来，抵消主光的硬阴影
   * 关键：金属度会让漫反射变暗（无环境贴图时尤其明显），所以材质的金属度
   * 统一压到很低，亮度主要靠光照 + 低金属度拿到，而不是靠调高 emissive。
   * 场景**不使用雾**（雾会把远景洗成背景色，直接拉低整体亮度）。
   */
  private buildEnvironment(): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(this.ambientLight);

    // 半球光：sky 打亮朝上的面，ground 打亮朝下/背光的面（"照亮暗部"的主力）
    this.hemiLight = new THREE.HemisphereLight(0xe6edfa, 0x59626f, 2.8);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.keyLight.position.set(2.5, 4, 3);
    // 主光作为唯一阴影投射源：低分辨率贴图 + 较宽半径换性能，软边即可。
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 14;
    const sc = this.keyLight.shadow.camera as THREE.OrthographicCamera;
    sc.left = -2.5;
    sc.right = 2.5;
    sc.top = 2.5;
    sc.bottom = -2.5;
    sc.updateProjectionMatrix();
    this.keyLight.shadow.bias = -0.0006;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 5;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xa8c4ff, 1.45);
    this.fillLight.position.set(-3, 2, -2.5);
    this.scene.add(this.fillLight);

    // 地面底板：让机柜"落在台面上"，而不是浮在虚空里（参考图也是浅灰地面）。
    // 无光材质（MeshBasicMaterial）：不接受任何光照影响，颜色只由主题决定，
    // 切主题/切视角时地面亮度恒定，不会随打光变化而忽明忽暗。
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ color: 0x191a21 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.015;
    this.scene.add(this.floor);

    this.grid = new THREE.GridHelper(24, 48, 0x4a5364, 0x2f3644);
    // 网格只是"地面在哪"的参考，必须半透明（具体数值由 THEMES.gridOpacity 给，
    // 见 applyTheme）。GridHelper 可能是单材质也可能是数组，两种都兼容。
    const gridMaterials = (
      Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]
    ) as THREE.LineBasicMaterial[];
    for (const m of gridMaterials) m.transparent = true;
    this.grid.position.y = -0.012;
    this.scene.add(this.grid);

    // 阴影接影板：独立半透明平面（ShadowMaterial），只承接机柜的平面投影，
    // 以"透明度通道"呈现阴影——不作用到地面 MeshBasicMaterial 上，
    // 因此地面始终无光、不会随打光产生颜色变化。
    // 位置略高于地面（-0.015）、略低于网格（-0.012），避免与地面/网格 z-fighting。
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = -0.0135;
    shadowCatcher.receiveShadow = true;
    shadowCatcher.material.depthWrite = false;
    // 接影板不可拾取：点地面应落到真正的地面/机柜，而不是被这块透明板拦截。
    shadowCatcher.raycast = () => {};
    this.scene.add(shadowCatcher);

    this.applyTheme();
  }

  /** 切换场景主题（黑 / 白）：只改颜色与光照，不重建几何 */
  setSceneTheme(theme: SceneTheme): void {
    this.sceneTheme = theme;
    this.applyTheme();
  }

  get theme(): SceneTheme {
    return this.sceneTheme;
  }

  /** 把当前主题调色板铺到背景 / 地面 / 光照 / 机柜与机身材质上 */
  private applyTheme(): void {
    const p = THEMES[this.sceneTheme];

    this.renderer.setClearColor(p.background, 1);
    // 场景不使用雾（见构造函数说明）：这里不再同步雾色，切主题只改清屏色。

    if (this.ambientLight) {
      this.ambientLight.color.setHex(p.ambient);
      this.ambientLight.intensity = p.ambientIntensity;
    }
    if (this.hemiLight) {
      this.hemiLight.color.setHex(p.hemiSky);
      this.hemiLight.groundColor.setHex(p.hemiGround);
      this.hemiLight.intensity = p.hemiIntensity;
    }
    if (this.keyLight) this.keyLight.intensity = p.keyIntensity;
    if (this.fillLight) {
      this.fillLight.color.setHex(p.fillColour);
      this.fillLight.intensity = p.fillIntensity;
    }

    if (this.floor) {
      (this.floor.material as THREE.MeshBasicMaterial).color.setHex(p.floor);
    }
    if (this.grid) {
      const materials = (
        Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]
      ) as THREE.LineBasicMaterial[];
      // GridHelper 材质顺序：0 = 主线，1 = 次线
      materials.forEach((m, i) => {
        m.color.setHex(i === 0 ? p.gridMajor : p.gridMinor);
        m.transparent = true;
        m.opacity = p.gridOpacity;
      });
    }

    for (const runtime of this.racks) {
      for (const m of runtime.frameMaterials) {
        m.color.setHex(p.frame);
        m.metalness = p.frameMetalness;
        m.roughness = p.frameRoughness;
      }
      for (const m of runtime.sideMaterials) {
        m.color.setHex(p.side);
        m.metalness = p.sideMetalness;
      }
      for (const m of runtime.wireMaterials) m.color.setHex(p.wire);
      for (const m of runtime.bezelMaterials) m.color.setHex(p.bezel);
      for (const m of runtime.ledMaterials) m.color.setHex(p.ledBase);
      // 机身：从"数据原色"重新折算，再交给状态染色（每帧从 baseColour 出发）
      for (const materials of runtime.deviceMaterials.values()) {
        for (const m of materials) {
          const data = m.userData.dataColour as THREE.Color | undefined;
          if (data) m.userData.baseColour = themeDeviceColour(data, p);
          m.metalness = p.deviceMetalness;
          m.roughness = p.deviceRoughness;
        }
      }
    }
    const hintMaterial = this.groundHint.material as THREE.MeshBasicMaterial;
    hintMaterial.color.setHex(p.wire);
    // U 位刻度线的"非高亮"色也随主题走；先统一改掉，再复原活动机柜高亮
    for (const runtime of this.racks) {
      runtime.group.traverse((object) => {
        const line = object as THREE.Line;
        if (
          line.isLine &&
          object.userData.rackTick === true &&
          line.material instanceof THREE.LineBasicMaterial
        ) {
          line.material.color.setHex(p.tick);
        }
      });
    }
    this.setActiveRack(this.activeRackId);

    this.applyRackOpacity();
    this.setDeviceStatuses(this.lastStatuses);
  }

  /** 摆放模式下淡显的地面：提示"这里可以点/可以放" */
  private buildGroundHint(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshBasicMaterial({
        color: WIRE_COLOUR,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.001;
    mesh.visible = false;
    return mesh;
  }

  // ------------------------------------------------------------ 构建
  /** 用新的机柜数据重建场景（幂等，可反复调用） */
  setRacks(racks: RackSceneRack[], options: RackSceneOptions = {}): void {
    if (this.disposed) return;
    this.clearRacks();

    const showSide = options.showSidePanels ?? true;
    let cursorX = 0;

    // 记录活动机柜（供重建 / 切主题后复原高亮）
    if (options.activeRackId !== undefined) {
      this.activeRackId = options.activeRackId;
    }

    for (const rack of racks) {
      const runtime = this.buildRack(rack, showSide);
      // 沿 X 轴并排，柜间距 100mm
      const rackWidthM = rack.widthIn * INCH_M;
      runtime.group.position.x = cursorX + rackWidthM / 2;
      cursorX += rackWidthM + BAY_GAP_M;

      if (this.activeRackId === rack.id) {
        this.highlightRack(runtime, true);
      }
      this.racks.push(runtime);
      this.root.add(runtime.group);
    }

    this.sceneWidth = Math.max(cursorX - BAY_GAP_M, 0.5);
    this.sceneHeight = Math.max(
      ...racks.map((r) => r.heightU * U_HEIGHT_M),
      0.5,
    );

    // 把整排机柜居中到原点。否则相机对准的是 x=0（机柜排的最左端），
    // 造成「相机怼在机柜内部、只拍到局部」的取景问题。
    const shift = this.sceneWidth / 2;
    for (const runtime of this.racks) {
      runtime.group.position.x -= shift;
    }

    // 重建后让新场景继承当前主题 / 渲染模式 / 选中态 / 遥测状态
    // （遮罩层与所有材质都是新建的，必须全部重算一遍）
    this.applyTheme();
    this.setRenderMode(this.renderMode);
    this.refreshSelection();
  }

  private clearRacks(): void {
    for (const runtime of this.racks) {
      runtime.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      this.root.remove(runtime.group);
    }
    this.racks = [];
    this.deviceAnchors.clear();
    this.deviceMeshes.clear();
    this.rackAnchors.clear();
  }

  private buildRack(rack: RackSceneRack, showSide: boolean): RackRuntime {
    const group = new THREE.Group();
    const widthM = rack.widthIn * INCH_M;
    const depthM = rack.depthMm / 1000;
    const heightM = rack.heightU * U_HEIGHT_M;

    const deviceMaterials = new Map<string, THREE.MeshStandardMaterial[]>();
    const deviceLeds = new Map<string, THREE.MeshStandardMaterial>();
    const frameMaterials: THREE.MeshStandardMaterial[] = [];
    const sideMaterials: THREE.MeshStandardMaterial[] = [];
    const wireMaterials: THREE.LineBasicMaterial[] = [];
    const bezelMaterials: THREE.MeshStandardMaterial[] = [];
    const ledMaterials: THREE.MeshStandardMaterial[] = [];
    // 按当前主题取初值，保证首帧（尚未 applyTheme）就是对的颜色
    const palette = THEMES[this.sceneTheme];

    // 蓝色线框叠加层：与实体完全重合，靠显隐切换渲染模式。
    // 只对盒体建线框（球体 / 细刻度线建线框会又贵又看不清）。
    const wireGroup = new THREE.Group();
    wireGroup.visible = false;
    group.add(wireGroup);
    // 线框叠加层：透明度 50% + 叠加（Additive）混合模式，让蓝色线框在实体之上
    // "发光式"叠绘，而不是普通半透明压暗。depthWrite 关掉避免线框互相遮挡写深度。
    const wireMaterial = new THREE.LineBasicMaterial({
      color: palette.wire,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    wireMaterials.push(wireMaterial);
    const addWire = (mesh: THREE.Mesh): void => {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        wireMaterial,
      );
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      edges.scale.copy(mesh.scale);
      wireGroup.add(edges);
    };

    // ---- 机柜框架：4 根立柱 + 顶底板 ----
    const postSize = 0.035;
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: palette.frame,
      roughness: palette.frameRoughness,
      metalness: palette.frameMetalness,
    });
    frameMaterials.push(frameMaterial);

    const postPositions: [number, number][] = [
      [-widthM / 2 + postSize / 2, depthM / 2 - postSize / 2],
      [widthM / 2 - postSize / 2, depthM / 2 - postSize / 2],
      [-widthM / 2 + postSize / 2, -depthM / 2 + postSize / 2],
      [widthM / 2 - postSize / 2, -depthM / 2 + postSize / 2],
    ];
    for (const [x, z] of postPositions) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(postSize, heightM, postSize),
        frameMaterial,
      );
      post.position.set(x, heightM / 2, z);
      group.add(post);
      addWire(post);
    }

    // 顶底板贴在柜体**外表面**（而不是嵌进柜内）：
    // 柜内净高就是 heightM，最高 U 的设备顶面会贴到 heightM，
    // 若把板厚(12mm)嵌进来，最高那台设备必然与顶板互相穿插（穿模）。
    const plateGeometry = new THREE.BoxGeometry(widthM, 0.012, depthM);
    const basePlate = new THREE.Mesh(plateGeometry, frameMaterial);
    basePlate.position.set(0, -0.006, 0);
    group.add(basePlate);
    addWire(basePlate);
    const topPlate = new THREE.Mesh(plateGeometry, frameMaterial);
    topPlate.position.set(0, heightM + 0.006, 0);
    group.add(topPlate);
    addWire(topPlate);

    // ---- 柜式机柜的侧板（半透明，便于看到柜内） ----
    if (showSide && rack.formFactor === "4-post-cabinet") {
      const sideMaterial = new THREE.MeshStandardMaterial({
        color: palette.side,
        roughness: 0.7,
        metalness: palette.sideMetalness,
        transparent: true,
        opacity: palette.sideOpacity,
        side: THREE.DoubleSide,
      });
      for (const sign of [-1, 1]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(0.006, heightM, depthM),
          sideMaterial,
        );
        side.position.set((sign * widthM) / 2, heightM / 2, 0);
        group.add(side);
        addWire(side);
      }
      sideMaterials.push(sideMaterial);
    }

    // ---- U 位参考线（每 1U 一道细线，替代沉重刻度） ----
    const tickMaterial = new THREE.LineBasicMaterial({
      color: palette.tick,
      transparent: true,
      opacity: 0.55,
    });
    for (let u = 0; u <= rack.heightU; u++) {
      const y = u * U_HEIGHT_M;
      const points = [
        new THREE.Vector3(-widthM / 2 + postSize, y, depthM / 2 - postSize),
        new THREE.Vector3(widthM / 2 - postSize, y, depthM / 2 - postSize),
      ];
      const tick = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        tickMaterial,
      );
      tick.userData.rackTick = true;
      group.add(tick);
    }

    // ---- 设备机箱 ----
    const interiorWidth = widthM - postSize * 2 - 0.01;
    for (const device of rack.devices) {
      const deviceHeight = Math.max(device.uHeight, 0.5) * U_HEIGHT_M;
      const deviceWidth =
        device.slotWidth === 1 ? interiorWidth / 2 : interiorWidth;

      const fullDepth = device.isFullDepth ? depthM * 0.78 : depthM * 0.34;
      const deviceDepth = Math.max(0.12, fullDepth);

      const baseColour = new THREE.Color(safeColour(device.colour));
      const material = new THREE.MeshStandardMaterial({
        color: themeDeviceColour(baseColour, palette),
        roughness: palette.deviceRoughness,
        metalness: palette.deviceMetalness,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
      });
      // 两级颜色：
      //   dataColour = 数据里的原始基色（切换主题时从这里重新折算，永不丢失）
      //   baseColour = 当前主题下的机身色（状态染色总是从它出发，避免多帧叠加漂移）
      material.userData.dataColour = baseColour.clone();
      material.userData.baseColour = themeDeviceColour(baseColour, palette);

      // 机箱盒体比槽位略矮，留出设备之间的视觉缝隙
      const boxHeight = deviceHeight * 0.94;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(deviceWidth, boxHeight, deviceDepth),
        material,
      );

      // Rackula 内部约定：U1 对应 position = UNITS_PER_U（6），即内部单位以 1 起算，
      // 而机箱底板在 y = 0。故需减 1U，U1 设备才会贴底，UN 设备顶面才刚好齐平柜顶。
      // 若直接用 position / UNITS_PER_U，所有设备会整体上移 1U，顶柜设备溢出柜顶。
      const yBottom = (device.position / UNITS_PER_U - 1) * U_HEIGHT_M;
      // 位置以**盒体包围盒底部**为基准（而不是槽位中心）：否则盒体比槽位矮，
      // 按中心对齐会让设备整体上浮、上下各留一条缝，看起来"穿模"。
      const yCenter = yBottom + boxHeight / 2;

      // 安装面决定 Z 位置；both 表示贯穿前后
      let zCenter = 0;
      if (device.face === "front") {
        zCenter = depthM / 2 - deviceDepth / 2 - postSize * 0.3;
      } else if (device.face === "rear") {
        zCenter = -depthM / 2 + deviceDepth / 2 + postSize * 0.3;
      }

      // 半宽设备靠向左侧槽位
      const xCenter = device.slotWidth === 1 ? -interiorWidth / 4 : 0;

      body.position.set(xCenter, yCenter, zCenter);
      body.userData.rackId = rack.id;
      body.userData.deviceId = device.id;
      group.add(body);
      addWire(body);

      this.deviceMeshes.set(device.id, body);

      // 弹窗锚点：设备顶部前缘。弹窗浮在设备上方，不会被机身挡住。
      const anchor = new THREE.Object3D();
      anchor.position.set(
        xCenter,
        yCenter + boxHeight / 2,
        zCenter + deviceDepth / 2,
      );
      group.add(anchor);
      this.deviceAnchors.set(device.id, anchor);

      // 前面板细节：一条横向凹槽，增强"设备"的可读性
      const bezelMaterial = new THREE.MeshStandardMaterial({
        color: palette.bezel,
        roughness: 0.85,
        metalness: 0.1,
      });
      bezelMaterials.push(bezelMaterial);
      const bezel = new THREE.Mesh(
        new THREE.BoxGeometry(deviceWidth * 0.96, boxHeight * 0.1, 0.008),
        bezelMaterial,
      );
      bezel.position.set(
        xCenter,
        yCenter + boxHeight * 0.32,
        zCenter +
          (device.face === "rear"
            ? -deviceDepth / 2 - 0.004
            : deviceDepth / 2 + 0.004),
      );
      group.add(bezel);
      // 面板凹槽与指示灯也归属该设备，否则点击它们会打断拾取链
      bezel.userData.rackId = rack.id;
      bezel.userData.deviceId = device.id;

      // 状态指示灯（遥测驱动）
      const ledMaterial = new THREE.MeshStandardMaterial({
        color: palette.ledBase,
        emissive: new THREE.Color(STATUS_COLOURS.unknown),
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      ledMaterials.push(ledMaterial);
      const led = new THREE.Mesh(
        new THREE.SphereGeometry(Math.min(0.008, boxHeight * 0.16), 12, 12),
        ledMaterial,
      );
      led.position.set(
        xCenter + deviceWidth / 2 - 0.03,
        yCenter + boxHeight * 0.18,
        zCenter +
          (device.face === "rear"
            ? -deviceDepth / 2 - 0.006
            : deviceDepth / 2 + 0.006),
      );
      group.add(led);
      led.userData.rackId = rack.id;
      led.userData.deviceId = device.id;

      deviceMaterials.set(device.id, [material]);
      deviceLeds.set(device.id, ledMaterial);
    }

    // 机柜弹窗锚点：柜顶中心正上方
    const rackAnchor = new THREE.Object3D();
    rackAnchor.position.set(0, heightM + 0.05, 0);
    group.add(rackAnchor);
    this.rackAnchors.set(rack.id, rackAnchor);

    // 机柜顶部常驻名称标签：浮在柜顶正上方，默认可见；
    // 选中该柜且弹出弹窗时由 setRackLabelHidden() 隐藏，避免与弹窗重复。
    // 标签最大宽度按机柜实体宽度折算（不超过机柜宽），状态汇总超宽时换行
    const labelMaxW = clamp(Math.round((widthM / 0.18) * 64), 200, 380);
    const labelSprite = makeRackLabelSprite(rack.name ?? rack.id, [], labelMaxW);
    labelSprite.position.set(0, heightM + 0.14, 0);
    group.add(labelSprite);

    // 机柜内所有实体（框架 / 侧板 / 设备 / 凹槽 / 灯座 / 指示灯）参与投影，
    // 让阴影接影板能收到它们的平面投影。Sprite 与 Line 不参与。
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });

    return {
      id: rack.id,
      group,
      deviceMaterials,
      deviceLeds,
      frameMaterials,
      sideMaterials,
      wireMaterials,
      bezelMaterials,
      ledMaterials,
      wireGroup,
      labelSprite,
      rackWidthM: widthM,
      labelName: rack.name ?? rack.id,
      labelSig: "",
    };
  }

  private highlightRack(runtime: RackRuntime, highlight: boolean): void {
    runtime.group.traverse((object) => {
      const line = object as THREE.Line;
      // 只处理 U 位刻度线；线框叠加层有独立配色，不参与活动机柜高亮
      if (
        line.isLine &&
        object.userData.rackTick === true &&
        line.material instanceof THREE.LineBasicMaterial
      ) {
        line.material.color.set(
          highlight ? HIGHLIGHT_COLOUR : THEMES[this.sceneTheme].tick,
        );
      }
    });
  }

  /** 高亮当前选中的机柜（与 2D 画布联动） */
  setActiveRack(rackId: string | null): void {
    // 记住 id：切换主题时 applyTheme 会重设刻度线颜色，需要据此复原高亮
    this.activeRackId = rackId;
    for (const runtime of this.racks) {
      this.highlightRack(runtime, runtime.id === rackId);
    }
  }

  // ------------------------------------------------------------ 遥测驱动
  /**
   * 用运行时状态刷新设备外观。
   * 状态语义：unknown 未知 / online 正常 / warn 告警 / crit 严重 / offline 离线
   *
   * 两层表现：
   *   1. 指示灯颜色（精确状态）
   *   2. 机身整体向状态色靠拢（远距离也能一眼看出异常设备）
   */
  setDeviceStatuses(statuses: Record<string, DeviceStatus>): void {
    // 记住最新状态：切换主题会重算机身色，必须据此重新染色（否则状态会丢）
    this.lastStatuses = statuses;
    for (const runtime of this.racks) {
      for (const [deviceId, materials] of runtime.deviceMaterials) {
        const status = statuses[deviceId] ?? "unknown";
        const led = runtime.deviceLeds.get(deviceId);
        if (led) {
          led.emissive.set(STATUS_COLOURS[status]);
          led.emissiveIntensity = status === "unknown" ? 0.5 : 1.6;
        }
        for (const material of materials) {
          const base =
            (material.userData.baseColour as THREE.Color | undefined) ??
            new THREE.Color(FALLBACK_COLOUR);
          const tint = STATUS_TINTS[status];
          material.color.copy(base).lerp(new THREE.Color(STATUS_COLOURS[status]), tint);
          const emphasise = status === "crit" || status === "warn";
          material.emissive.set(emphasise ? STATUS_COLOURS[status] : 0x000000);
          material.emissiveIntensity = emphasise ? 0.22 : 0;
        }
      }
    }
    // 同步刷新机柜顶部的状态汇总标签（仅在汇总变化时重绘纹理，性能安全）
    this.updateRackStatusLabels();
  }

  /** 重绘某个机柜标签的纹理（状态汇总变化时调用） */
  private paintRackLabel(
    runtime: RackRuntime,
    name: string,
    chips: LabelChip[],
    maxWidthPx: number,
  ): void {
    const sprite = runtime.labelSprite;
    if (!sprite) return;
    const { canvas, aspect } = renderLabelTexture(name, chips, maxWidthPx);
    const old = sprite.material.map;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    sprite.material.map = tex;
    sprite.material.needsUpdate = true;
    if (old) old.dispose();
    sprite.userData.labelAspect = aspect;
  }

  /** 按当前设备状态算出某机柜的状态汇总 chips 与签名 */
  private computeStatusChips(
    runtime: RackRuntime,
  ): { chips: LabelChip[]; sig: string } {
    const deviceIds = [...runtime.deviceMaterials.keys()];
    const total = deviceIds.length;
    let online = 0;
    let warn = 0;
    let crit = 0;
    let offline = 0;
    for (const id of deviceIds) {
      const s = this.lastStatuses[id] ?? "unknown";
      if (s === "online") online++;
      else if (s === "warn") warn++;
      else if (s === "crit") crit++;
      else if (s === "offline") offline++;
    }
    const chips: LabelChip[] = [];
    if (online > 0)
      chips.push({
        text: `${online}/${total}`,
        status: "online",
        color: STATUS_COLOURS.online,
      });
    if (warn > 0)
      chips.push({ text: `${warn}`, status: "warn", color: STATUS_COLOURS.warn });
    if (crit > 0)
      chips.push({ text: `${crit}`, status: "crit", color: STATUS_COLOURS.crit });
    if (offline > 0)
      chips.push({
        text: `${offline}`,
        status: "offline",
        color: STATUS_COLOURS.offline,
      });
    const sig = chips.map((c) => `${c.text}:${c.color}`).join("|");
    return { chips, sig };
  }

  /**
   * 用当前设备状态为每个机柜重算状态汇总标签。
   * 仅当某机柜的汇总签名变化时才重绘纹理，避免逐帧重建（性能）。
   * 汇总类型：在线数/总数(绿) · 告警数(黄) · 严重数(红) · 离线数(灰)，
   * 仅展示非 0 的类型；未接入(unknown)不计入任何类型，但仍计入总数。
   */
  private updateRackStatusLabels(): void {
    for (const runtime of this.racks) {
      const { chips, sig } = this.computeStatusChips(runtime);
      if (sig === runtime.labelSig) continue;
      runtime.labelSig = sig;
      const maxW = clamp(
        Math.round(((runtime.rackWidthM || 0.5) / 0.18) * 64),
        200,
        380,
      );
      this.paintRackLabel(runtime, runtime.labelName || runtime.id, chips, maxW);
    }
  }

  /**
   * 机柜改名时只重绘顶部标签纹理（不重建几何），让 3D 文字标签即时跟随
   * 名称变化，无需等到切换视图/重建场景。内容宽度随新名称自适应。
   */
  setRackName(rackId: string, name: string): void {
    const runtime = this.racks.find((r) => r.id === rackId);
    if (!runtime) return;
    if (runtime.labelName === name) return;
    runtime.labelName = name;
    const { chips, sig } = this.computeStatusChips(runtime);
    runtime.labelSig = sig; // 名字变了必然重绘；同步 sig 以免丢失后续状态变化
    const maxW = clamp(
      Math.round(((runtime.rackWidthM || 0.5) / 0.18) * 64),
      200,
      380,
    );
    this.paintRackLabel(runtime, name, chips, maxW);
  }

  // ------------------------------------------------------------ 选中（轮廓 / 遮罩）
  /**
   * 选中设备。
   * 轮廓不再用「外扩的 EdgesGeometry 线框」，而是走 **深度/ID 遮罩 + 合并通道**
   * （见 `buildPostPipeline`）：轮廓在屏幕空间等宽，且会被前方几何体正确遮挡。
   */
  setSelectedDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId;
    this.refreshSelection();
  }

  /**
   * 选中机柜（视为一个整体）。
   * 柜体与其内部设备一起进入遮罩，形成整柜轮廓；同时其它机柜转为半透明。
   */
  setSelectedRack(rackId: string | null): void {
    this.selectedRackId = rackId;
    this.refreshSelection();
  }

  /**
   * 重算选中态：
   *   1. 把选中对象（或其整个机柜）标到 MASK_LAYER，供遮罩通道单独渲染；
   *   2. 选中机柜时其它机柜半透明；
   *   3. 决定合并通道是否开启。
   * 轮廓只画一个，优先级：场景元素 > 设备 > 机柜。
   */
  private refreshSelection(): void {
    for (const runtime of this.racks) {
      runtime.group.traverse((object) => object.layers.disable(MASK_LAYER));
    }
    for (const child of this.propGroup.children) {
      child.traverse((object) => object.layers.disable(MASK_LAYER));
    }

    let outlined: THREE.Object3D | null = null;

    if (this.selectedPropId) {
      outlined =
        this.propGroup.children.find(
          (child) => child.userData.propId === this.selectedPropId,
        ) ?? null;
    } else if (this.selectedDeviceId) {
      outlined = this.deviceMeshes.get(this.selectedDeviceId) ?? null;
    } else if (this.selectedRackId) {
      outlined =
        this.racks.find((runtime) => runtime.id === this.selectedRackId)?.group ??
        null;
    }

    if (outlined) {
      outlined.traverse((object) => object.layers.enable(MASK_LAYER));
    }
    this.maskActive = outlined !== null;

    this.applyRackOpacity();
  }

  /** 依据「渲染模式 + 选中态」统一刷新机柜框架 / 侧板透明度 */
  private applyRackOpacity(): void {
    const xray = this.renderMode === "xray";
    for (const runtime of this.racks) {
      // 选中了某个机柜时，其余机柜压暗为半透明，突出当前关注对象
      const dimmed =
        this.selectedRackId !== null && runtime.id !== this.selectedRackId;

      for (const material of runtime.frameMaterials) {
        material.transparent = xray || dimmed;
        material.opacity = dimmed ? DIM_FRAME_OPACITY : xray ? 0.2 : 1;
        material.depthWrite = !(xray || dimmed);
        material.needsUpdate = true;
      }

      for (const material of runtime.sideMaterials) {
        material.transparent = true;
        material.opacity = dimmed
          ? DIM_SIDE_OPACITY
          : xray
            ? 0.08
            : THEMES[this.sceneTheme].sideOpacity;
        material.depthWrite = !(xray || dimmed);
        material.needsUpdate = true;
      }

      // 柜内设备：机身 / 面板凹槽 / 灯座 / 指示灯一起降透明度。
      // 只淡柜壳会留下"悬空的实心设备块"，必须整柜（含内容）一起淡。
      for (const materials of runtime.deviceMaterials.values()) {
        for (const material of materials) {
          material.transparent = dimmed;
          material.opacity = dimmed ? DIM_DEVICE_OPACITY : 1;
          material.depthWrite = !dimmed;
          material.needsUpdate = true;
        }
      }
      for (const material of runtime.bezelMaterials) {
        material.transparent = dimmed;
        material.opacity = dimmed ? DIM_DEVICE_OPACITY : 1;
        material.depthWrite = !dimmed;
        material.needsUpdate = true;
      }
      for (const material of runtime.ledMaterials) {
        material.transparent = dimmed;
        material.opacity = dimmed ? DIM_LED_OPACITY : 1;
        material.depthWrite = !dimmed;
        material.needsUpdate = true;
      }
      for (const led of runtime.deviceLeds.values()) {
        led.transparent = dimmed;
        led.opacity = dimmed ? DIM_LED_OPACITY : 1;
        led.depthWrite = !dimmed;
        led.needsUpdate = true;
      }
    }
  }

  get selectedDevice(): string | null {
    return this.selectedDeviceId;
  }

  get selectedRack(): string | null {
    return this.selectedRackId;
  }

  /** 是否没有任何选中对象 */
  get hasSelection(): boolean {
    return (
      this.selectedDeviceId !== null ||
      this.selectedRackId !== null ||
      this.selectedPropId !== null
    );
  }

  /** 清空全部选中（点击空白处时调用） */
  clearSelection(): void {
    this.selectedDeviceId = null;
    this.selectedRackId = null;
    this.selectedPropId = null;
    this.refreshSelection();
  }

  /**
   * 控制机柜顶部常驻名称标签的显隐。
   * 语义：当 `rackId` 对应机柜被选中且弹出弹窗时，`hidden=true` 隐藏它的标签；
   * 传 `null`（或 `hidden=false`）则恢复全部标签可见。
   * 重建场景（setRacks）后标签默认重新可见，调用方负责在需要时重新隐藏。
   */
  setRackLabelHidden(rackId: string | null, hidden: boolean): void {
    for (const runtime of this.racks) {
      if (!runtime.labelSprite) continue;
      runtime.labelSprite.visible = !(hidden && runtime.id === rackId);
    }
  }

  // ------------------------------------------------------------ 渲染模式
  /**
   * 切换渲染模式。
   * - `solid`     隐藏线框，机柜不透明（默认）
   * - `wireframe` 叠加蓝色线框，材质保持实体
   * - `xray`      叠加蓝色线框，机柜框架与侧板转半透明，可看穿柜体
   */
  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
    const wireOn = mode !== "solid";
    for (const runtime of this.racks) {
      runtime.wireGroup.visible = wireOn;
    }
    // 透明度同时受「渲染模式」与「是否选中了别的机柜」影响，统一在这里算
    this.applyRackOpacity();
  }

  // ------------------------------------------------------------ 相机
  get cameraProjection(): CameraMode {
    return this.cameraMode;
  }

  get preset(): ViewPreset {
    return this.viewPreset;
  }

  /**
   * 切换正交 / 透视投影。
   * 会按当前实际取景范围换算，**切换前后画面构图保持一致**，不会跳变。
   */
  setCameraMode(mode: CameraMode): void {
    if (mode === this.cameraMode) return;
    this.tween = null;

    const target = this.controls.target.clone();
    const direction = this.camera.position.clone().sub(target);
    if (direction.lengthSq() < 1e-8) direction.copy(VIEW_DIRECTIONS.iso);
    direction.normalize();

    // 统一折算成"在目标处需要覆盖的半高"
    const halfHeight =
      this.cameraMode === "perspective"
        ? this.currentDistance(target) *
          Math.tan((PERSPECTIVE_FOV * Math.PI) / 360)
        : this.orthoHalfHeight;

    this.cameraMode = mode;
    this.camera = mode === "ortho" ? this.orthoCamera : this.perspectiveCamera;

    const distance = this.distanceForHalfHeight(halfHeight);
    this.applyFraming(target, direction, distance, halfHeight);

    // OrbitControls 与具体相机实例绑定，切相机必须重建
    this.controls.dispose();
    this.controls = this.createControls();
    this.controls.target.copy(target);
    this.applyFraming(target, direction, distance, halfHeight);
  }

  /** 切换到预设视角：换方位后按整个场景重新取景，保证各视角构图一致 */
  setViewPreset(preset: ViewPreset): void {
    this.viewPreset = preset;
    const box = this.sceneBox();
    if (!box.isEmpty()) {
      this.frameBox(box, FRAME_FILL_SCENE, true, VIEW_DIRECTIONS[preset].clone());
    }
  }

  /** 视角复位：相机平滑过渡到整个场景（保证全部设备都可见，约 0.5s 动画） */
  resetView(): void {
    const box = this.sceneBox();
    if (!box.isEmpty()) {
      this.frameBox(
        box,
        FRAME_FILL_SCENE,
        false,
        VIEW_DIRECTIONS[this.viewPreset].clone(),
      );
    }
  }

  /** 相机聚焦到指定机柜（宽度约占视窗 80%） */
  focusRack(rackId: string): void {
    const runtime = this.racks.find((r) => r.id === rackId);
    if (!runtime) return;
    this.frameBox(this.rackBodyBox(runtime), FRAME_FILL_RACK);
  }

  /**
   * 相机聚焦到指定设备（保留当前视角朝向，只推近并居中）。
   * 填充比 0.85——设备约占屏幕 85%。实际能推多近受限于视口宽高比：
   * 竖长视口下 1U 设备是"扁而宽"的，横向装下它必然带来较大的纵向留白，
   * 这是几何约束，不是取景算法的问题。
   */
  focusDevice(deviceId: string): void {
    const mesh = this.deviceMeshes.get(deviceId);
    if (!mesh) return;
    this.frameBox(
      new THREE.Box3().setFromObject(mesh),
      FRAME_FILL_DEVICE,
    );
  }

  /**
   * 默认 / 复位取景的包围盒 = **只算机柜排**，不含摆放模式的场景元素。
   * 以前会把 propGroup 一起并进去，用户在角落放一个小元素就会把整排机柜推小，
   * 与"复位 = 看全部机柜"的预期不符。
   */
  private sceneBox(): THREE.Box3 {
    const width = Math.max(this.sceneWidth, 0.3);
    const height = Math.max(this.sceneHeight, 0.3);
    const depth = Math.max(this.rackDepth(), 0.3);
    const box = new THREE.Box3(
      new THREE.Vector3(-width / 2, 0, -depth / 2),
      new THREE.Vector3(width / 2, height, depth / 2),
    );
    if (box.isEmpty()) {
      box.setFromCenterAndSize(
        new THREE.Vector3(0, 0.3, 0),
        new THREE.Vector3(1, 0.6, 1),
      );
    }
    return box;
  }

  /**
   * 机柜**本体**包围盒（显式排除顶部名称标签 Sprite）。
   * `setFromObject(runtime.group)` 会把标签一起算进去，而标签浮在柜顶、宽度比柜体还宽，
   * 一旦计入就会把取景包围盒撑大、把相机推远，让机柜本体显得更小。
   * 取景与纵深只关心机柜本体，名称标签是装饰叠加层，必须跳过。
   */
  private rackBodyBox(runtime: RackRuntime): THREE.Box3 {
    const box = new THREE.Box3();
    runtime.group.updateWorldMatrix(true, true);
    const tmp = new THREE.Box3();
    runtime.group.traverse((obj) => {
      if (obj === runtime.labelSprite) return;
      const mesh = obj as THREE.Mesh;
      const isTarget =
        (obj as THREE.Mesh).isMesh ||
        (obj as THREE.LineSegments).isLineSegments;
      if (isTarget && mesh.geometry) {
        tmp.setFromObject(mesh);
        if (!tmp.isEmpty()) box.union(tmp);
      }
    });
    return box;
  }

  /**
   * 把相机聚焦到给定包围盒。
   *
   * 用相机自身的右/上/前三个轴把包围盒投影到视平面上，得到**真正需要覆盖的
   * 宽高**。这比"取包围球半径"贴合得多：1U 设备是扁长条，它的包围球半径
   * （≈半对角线 0.46m）比设备实际高度（0.04m）大一个数量级，用球会导致
   * 点选设备后镜头几乎不推近、设备仍然看不清。
   *
   * @param fill 目标在视窗「较吃紧的那一维」上占的比例（0.8 = 占 80%）。
   *   竖长视口下机柜/设备都是横向更吃紧，所以实际表现就是"宽度占 80%/85%"。
   */
  private frameBox(
    box: THREE.Box3,
    fill: number,
    instant = false,
    direction?: THREE.Vector3,
  ): void {
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

    // 取景基准轴。
    // 指定 direction 时必须**由该方向现算**一套正交基：此时相机还没转过去，
    // 读 camera.matrixWorld 拿到的是上一帧的朝向，会导致切视角后构图偏大偏小。
    const axes = direction
      ? this.axesFor(direction)
      : this.cameraAxes(this.camera);

    // 包围盒在某一轴上的投影半宽 = Σ |half_i · axis_i|（盒体支撑函数，精确值）
    const extentOn = (axis: THREE.Vector3): number =>
      Math.abs(half.x * axis.x) +
      Math.abs(half.y * axis.y) +
      Math.abs(half.z * axis.z);
    const halfWidth = extentOn(axes.right);
    const halfHeight = extentOn(axes.up);
    const halfDepth = extentOn(axes.forward);

    const aspect = Math.max(this.viewAspect, 0.2);
    const vFov = (PERSPECTIVE_FOV * Math.PI) / 180;
    const safeFill = clamp(fill, 0.2, 1);
    // 竖长视口下横向更吃紧，取两者较大值，否则会被裁切；
    // 再除以填充比 → 放大到"目标刚好占视窗 safeFill"的距离。
    const requiredHalfHeight =
      Math.max(halfHeight, halfWidth / aspect) / safeFill;

    const distance = Math.max(
      requiredHalfHeight / Math.tan(vFov / 2) + halfDepth,
      0.3,
    );

    this.applyFraming(
      center,
      direction ?? this.currentDirection(),
      distance,
      requiredHalfHeight,
      instant,
    );
  }

  /** 相机当前的右 / 上 / 后方三个单位轴（与 three 的 lookAt 约定一致） */
  private cameraAxes(camera: THREE.Camera): {
    right: THREE.Vector3;
    up: THREE.Vector3;
    forward: THREE.Vector3;
  } {
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    return {
      right: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
      up: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
      forward: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2),
    };
  }

  /** 由「目标 → 相机」方向推出对应的右 / 上 / 后方轴 */
  private axesFor(direction: THREE.Vector3): {
    right: THREE.Vector3;
    up: THREE.Vector3;
    forward: THREE.Vector3;
  } {
    const forward = direction.clone().normalize(); // 相机后方轴
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, forward);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    return { right, up, forward };
  }

  /** 场景纵深（米）：取最深的那个机柜（不含顶部名称标签） */
  private rackDepth(): number {
    let deepest = 0.6;
    for (const rack of this.racks) {
      const box = this.rackBodyBox(rack);
      deepest = Math.max(deepest, box.max.z - box.min.z);
    }
    return deepest;
  }

  /** 正交相机下的等效距离（用于和其它相机切换时对齐构图） */
  private distanceForHalfHeight(halfHeight: number): number {
    return halfHeight / Math.tan((PERSPECTIVE_FOV * Math.PI) / 360);
  }

  private currentDistance(target: THREE.Vector3): number {
    const distance = this.camera.position.distanceTo(target);
    if (distance > 1e-4) return distance;
    return this.distanceForHalfHeight(this.orthoHalfHeight);
  }

  private currentDirection(): THREE.Vector3 {
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target);
    if (direction.lengthSq() < 1e-8) return VIEW_DIRECTIONS.iso.clone();
    return direction.normalize();
  }

  /**
   * 应用一次取景。
   * @param instant 立即生效；否则补间到目标（镜头平滑推进）
   */
  private applyFraming(
    center: THREE.Vector3,
    direction: THREE.Vector3,
    distance: number,
    halfHeight: number,
    instant = true,
  ): void {
    const safeDistance = Math.max(distance, 0.2);
    const position = center
      .clone()
      .addScaledVector(direction.clone().normalize(), safeDistance);

    if (!instant) {
      const fromS = cameraSpherical(this.camera.position, this.controls.target);
      const toS = cameraSpherical(position, center);
      this.tween = {
        fromTarget: this.controls.target.clone(),
        toTarget: center.clone(),
        fromRadius: fromS.radius,
        toRadius: toS.radius,
        fromAzimuth: fromS.azimuth,
        toAzimuth: toS.azimuth,
        fromPolar: fromS.polar,
        toPolar: toS.polar,
        fromHalf: this.orthoHalfHeight,
        toHalf: halfHeight,
        startedAt: performance.now(),
        duration: 500,
      };
      return;
    }

    this.tween = null;
    this.orthoHalfHeight = Math.max(halfHeight, 0.02);
    this.controls.target.copy(center);
    this.camera.position.copy(position);
    if (this.cameraMode === "ortho") {
      this.orthoCamera.zoom = 1;
      this.setOrthoExtent(this.orthoHalfHeight);
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** 只更新正交相机的取景范围，不动 zoom（滚轮缩放由 zoom 承担） */
  private setOrthoExtent(halfHeight: number): void {
    const h = Math.max(halfHeight, 0.02);
    this.orthoCamera.top = h;
    this.orthoCamera.bottom = -h;
    this.orthoCamera.left = -h * this.viewAspect;
    this.orthoCamera.right = h * this.viewAspect;
    this.orthoCamera.updateProjectionMatrix();
  }

  /** 驱动取景补间（球坐标最短弧插值，避免跨视角转圈） */
  private stepTween(): void {
    const tween = this.tween;
    if (!tween) return;

    const raw = (performance.now() - tween.startedAt) / tween.duration;
    const t = clamp(raw, 0, 1);
    const k = easeOutCubic(t);

    // 目标点线性插值
    const target = new THREE.Vector3().lerpVectors(
      tween.fromTarget,
      tween.toTarget,
      k,
    );
    // 方位角 / 极角沿最短弧插值（角度差取余到 ±π，避免大角度转圈）
    const azimuth =
      tween.fromAzimuth + wrapPi(tween.toAzimuth - tween.fromAzimuth) * k;
    const polar = tween.fromPolar + wrapPi(tween.toPolar - tween.fromPolar) * k;
    const radius = tween.fromRadius + (tween.toRadius - tween.fromRadius) * k;
    this.camera.position.copy(
      sphericalToPosition(radius, azimuth, polar, target),
    );
    this.controls.target.copy(target);

    const halfHeight =
      tween.fromHalf + (tween.toHalf - tween.fromHalf) * k;
    this.orthoHalfHeight = halfHeight;
    if (this.cameraMode === "ortho") {
      this.orthoCamera.zoom = 1;
      this.setOrthoExtent(halfHeight);
    }

    if (t >= 1) this.tween = null;
  }

  // ------------------------------------------------------------ 二维卡片定位
  /**
   * 把三维锚点投影为画布内的 CSS 像素坐标。
   * 坐标会被夹取到视口内（否则靠近边缘的对象会把卡片顶出面板被裁掉），
   * 并在锚点上方空间不足时置 `flip = true`，让调用方把卡片翻到下方。
   */
  private projectAnchor(
    object: THREE.Object3D,
    cardWidth: number,
    cardHeight: number,
  ): { x: number; y: number; flip: boolean } | null {
    const world = new THREE.Vector3();
    object.getWorldPosition(world);
    const projected = world.clone().project(this.camera);
    if (projected.z > 1) return null; // 相机背后

    const rawX = ((projected.x + 1) / 2) * this.viewWidth;
    const rawY = ((1 - projected.y) / 2) * this.viewHeight;

    // ⚠️ 卡片尺寸必须先收敛到"视口装得下的上限"。
    // 卡片实际高度由内容决定（指标行多的时候远超常量估算的 250px），
    // 用真实高度去算可用区间，才能保证卡片整体落在视口内。
    const w = clamp(cardWidth, 0, Math.max(0, this.viewWidth - POPUP_MARGIN * 2));
    const h = clamp(
      cardHeight,
      0,
      Math.max(0, this.viewHeight - POPUP_MARGIN * 2),
    );

    // 横向：卡片居中于锚点，需要留出半个卡宽，否则会被 overflow 裁切
    const halfW = w / 2;
    const xMin = halfW + POPUP_MARGIN;
    const xMax = Math.max(xMin, this.viewWidth - halfW - POPUP_MARGIN);
    const x = clamp(rawX, xMin, xMax);

    // 纵向：默认浮在锚点上方；上方装不下才翻到下方。
    // 两种形态都必须整体落在 [MARGIN, viewHeight - MARGIN] 内：
    //   不翻转 → 卡片占 [y - GAP - h, y - GAP]
    //   翻转   → 卡片占 [y + GAP,     y + GAP + h]
    const fitsAbove = rawY - POPUP_GAP - h >= POPUP_MARGIN;
    const fitsBelow = rawY + POPUP_GAP + h <= this.viewHeight - POPUP_MARGIN;
    const flip = !fitsAbove && fitsBelow;

    const yMin = flip
      ? POPUP_MARGIN - POPUP_GAP
      : POPUP_MARGIN + POPUP_GAP + h;
    const yMax = Math.max(
      yMin,
      flip
        ? this.viewHeight - POPUP_MARGIN - POPUP_GAP - h
        : this.viewHeight - POPUP_MARGIN + POPUP_GAP,
    );
    const y = clamp(rawY, yMin, yMax);

    return { x, y, flip };
  }

  /**
   * 设备数据卡片的屏幕锚点。
   * `cardWidth/cardHeight` 请传**实测**的卡片尺寸：指标行数量不同会让卡片高度
   * 差出上百像素，用常量估算会把卡片顶出视口（压到标题栏 / 底部按钮上）。
   * 不传则退回默认估算值。
   */
  getDeviceAnchor(
    deviceId: string,
    cardWidth?: number,
    cardHeight?: number,
  ): { x: number; y: number; flip: boolean } | null {
    const anchor = this.deviceAnchors.get(deviceId);
    return anchor
      ? this.projectAnchor(
          anchor,
          cardWidth ?? POPUP_WIDTH,
          cardHeight ?? POPUP_HEIGHT,
        )
      : null;
  }

  /** 机柜数据卡片的屏幕锚点（柜顶中心） */
  getRackAnchor(
    rackId: string,
    cardWidth?: number,
    cardHeight?: number,
  ): { x: number; y: number; flip: boolean } | null {
    const anchor = this.rackAnchors.get(rackId);
    return anchor
      ? this.projectAnchor(
          anchor,
          cardWidth ?? POPUP_WIDTH,
          cardHeight ?? POPUP_HEIGHT,
        )
      : null;
  }

  /** 场景元素浮动条的屏幕锚点 */
  getPropAnchor(
    propId: string,
  ): { x: number; y: number; flip: boolean } | null {
    const anchor = this.propAnchors.get(propId);
    return anchor ? this.projectAnchor(anchor, BAR_WIDTH, BAR_HEIGHT) : null;
  }

  // ------------------------------------------------------------ 场景元素
  /** 摆放模式开关：开启后左键用于选择/拖动元素、点击地面新建元素 */
  setPlacementMode(enabled: boolean): void {
    this.placementMode = enabled;
    this.groundHint.visible = enabled;
  }

  get placement(): boolean {
    return this.placementMode;
  }

  /** 重建全部场景元素（幂等） */
  setProps(props: SceneProp[]): void {
    this.clearProps();
    for (const prop of props) {
      const group = this.buildProp(prop);
      this.propGroup.add(group);
    }
    this.setSelectedProp(this.selectedPropId);
  }

  private clearProps(): void {
    for (const child of [...this.propGroup.children]) {
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      this.propGroup.remove(child);
    }
    this.propAnchors.clear();
    this.propMaterials.clear();
  }

  /** 程序化生成基础元素：全部以"地面为基准"摆放 */
  private buildProp(prop: SceneProp): THREE.Group {
    const group = new THREE.Group();
    group.position.set(prop.x, 0, prop.z);
    group.rotation.y = prop.rotation;
    group.userData.propId = prop.id;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(safeColour(prop.colour)),
      roughness: 0.62,
      metalness: 0.08,
    });
    material.userData.baseColour = new THREE.Color(safeColour(prop.colour));

    const addPart = (
      geometry: THREE.BufferGeometry,
      position: [number, number, number],
    ): void => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.userData.propId = prop.id;
      group.add(mesh);
    };

    let topY = 0.4;
    switch (prop.kind) {
      case "cube": {
        addPart(new THREE.BoxGeometry(0.4, 0.4, 0.4), [0, 0.2, 0]);
        topY = 0.4;
        break;
      }
      case "sphere": {
        addPart(new THREE.SphereGeometry(0.22, 24, 18), [0, 0.22, 0]);
        topY = 0.44;
        break;
      }
      case "table": {
        addPart(new THREE.BoxGeometry(1.1, 0.05, 0.68), [0, 0.72, 0]);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            addPart(new THREE.BoxGeometry(0.06, 0.7, 0.06), [
              sx * 0.5,
              0.35,
              sz * 0.28,
            ]);
          }
        }
        topY = 0.745;
        break;
      }
      case "chair": {
        addPart(new THREE.BoxGeometry(0.44, 0.05, 0.44), [0, 0.44, 0]);
        addPart(new THREE.BoxGeometry(0.44, 0.46, 0.05), [0, 0.68, -0.2]);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            addPart(new THREE.BoxGeometry(0.05, 0.42, 0.05), [
              sx * 0.18,
              0.21,
              sz * 0.18,
            ]);
          }
        }
        topY = 0.91;
        break;
      }
    }

    // 浮动条锚点：元素正上方，保证浮动条不会被模型挡住
    const anchor = new THREE.Object3D();
    anchor.position.set(0, topY + 0.06, 0);
    group.add(anchor);
    this.propAnchors.set(prop.id, anchor);
    this.propMaterials.set(prop.id, [material]);

    return group;
  }

  /** 选中场景元素：同样走遮罩轮廓（与设备/机柜视觉一致） */
  setSelectedProp(propId: string | null): void {
    this.selectedPropId = propId;
    this.refreshSelection();
  }

  /** 修改场景元素颜色（浮动条改色） */
  setPropColour(propId: string, colour: string): void {
    const materials = this.propMaterials.get(propId);
    if (!materials) return;
    for (const material of materials) {
      const base = new THREE.Color(safeColour(colour));
      material.userData.baseColour = base.clone();
      material.color.copy(base);
    }
  }

  get selectedProp(): string | null {
    return this.selectedPropId;
  }

  // ------------------------------------------------------------ 视图尺寸
  /** 仅重算画布尺寸 */
  resize(): void {
    if (this.disposed) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const height = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.viewWidth = width;
    this.viewHeight = height;
    this.viewAspect = width / height;
    this.perspectiveCamera.aspect = this.viewAspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this.setOrthoExtent(this.orthoHalfHeight);
    // 后处理渲染目标必须跟随画布尺寸（含 DPR），否则遮罩/主通道会错位
    this.resizeRenderTargets();
  }

  /** 导出当前帧为 PNG dataURL */
  screenshot(): string {
    return this.renderer.domElement.toDataURL("image/png");
  }

  // ------------------------------------------------------------ 交互
  /** pointerdown 起点，用于把「点击」与「拖拽」区分开 */
  private pointerDownAt: { x: number; y: number } | null = null;
  /** 正在拖动的场景元素 */
  private draggingProp: { id: string; offsetX: number; offsetZ: number } | null =
    null;

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
    this.tween = null;

    if (!this.placementMode) return;

    const hit = this.pickProp(event);
    if (!hit) return;

    const point = this.groundPoint(event);
    if (!point) return;

    // 命中元素 → 进入拖动。这里先于 OrbitControls 执行，禁用控制器避免相机跟着转。
    const group = hit.object.parent;
    const originX = group?.position.x ?? 0;
    const originZ = group?.position.z ?? 0;
    this.draggingProp = {
      id: hit.propId,
      offsetX: originX - point.x,
      offsetZ: originZ - point.z,
    };
    this.controls.enabled = false;
    this.setSelectedProp(hit.propId);
    this.onSelectProp?.(hit.propId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const dragging = this.draggingProp;
    if (!dragging) return;
    const point = this.groundPoint(event);
    if (!point) return;

    const x = point.x + dragging.offsetX;
    const z = point.z + dragging.offsetZ;
    const group = this.propGroup.children.find(
      (c) => c.userData.propId === dragging.id,
    );
    if (group) {
      group.position.x = x;
      group.position.z = z;
    }
    this.onPropMoved?.(dragging.id, x, z);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDownAt;
    this.pointerDownAt = null;

    if (this.draggingProp) {
      const { id } = this.draggingProp;
      this.draggingProp = null;
      this.controls.enabled = true;
      const group = this.propGroup.children.find(
        (c) => c.userData.propId === id,
      );
      if (group) this.onPropMoveEnd?.(id, group.position.x, group.position.z);
      return;
    }

    if (!start) return;
    // 位移超过阈值视为拖拽旋转，不触发选中/摆放
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) {
      return;
    }
    this.pick(event);
  };

  /** 射线与地面（y = 0）求交，得到地平面坐标 */
  private groundPoint(event: PointerEvent): THREE.Vector3 | null {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, point)
      ? point
      : null;
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** 命中场景元素 */
  private pickProp(
    event: PointerEvent,
  ): { propId: string; object: THREE.Object3D } | null {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.propGroup.children, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const propId = node.userData?.propId;
        if (typeof propId === "string") return { propId, object: hit.object };
        node = node.parent;
      }
    }
    return null;
  }

  private pick(event: PointerEvent): void {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 摆放模式优先处理场景元素与地面
    if (this.placementMode) {
      const prop = this.pickProp(event);
      if (prop) {
        this.setSelectedProp(prop.propId);
        this.onSelectProp?.(prop.propId);
        return;
      }
      // 点到元素以外 → 取消选中，并在有工具元素时落地
      this.setSelectedProp(null);
      this.onSelectProp?.(null);
      const point = this.groundPoint(event);
      if (!point) return;
      // 地面点若被机柜挡住则不落地：否则会"穿柜"把元素放到机柜背后，
      // 与用户在屏幕上看到的落点不一致。
      const blockers = this.raycaster
        .intersectObject(this.root, true)
        .filter((hit) => !(hit.object as THREE.Line).isLine);
      const nearest = blockers[0];
      const groundDistance = this.raycaster.ray.origin.distanceTo(point);
      if (nearest && nearest.distance < groundDistance) return;
      this.onPlaceProp?.(point.x, point.z);
      return;
    }

    const { rackId, device } = this.hitTestRacks();

    // 透视（xray）模式下**机柜外壳不参与选中**：
    // 柜体此时是半透明的，用户看到、想点的是柜内设备。若仍允许外壳选中，
    // 命中链上外壳必然排在设备前面，点哪儿都会先整柜选中，把设备级交互挡掉。
    // 因此 xray 下只有命中设备才算选中；点到外壳或空处一律按「点空白」处理。
    const shellPickOff = this.renderMode === "xray" && device === null;
    const effectiveRackId = shellPickOff ? null : rackId;

    // 机柜整体也是可交互对象：命中机柜即选中该柜（他柜转半透明 + 整柜轮廓）
    this.setSelectedRack(effectiveRackId);

    if (effectiveRackId) {
      this.setActiveRack(effectiveRackId);
      this.onSelectRack?.(effectiveRackId);
    } else {
      this.onSelectRack?.(null);
    }
    this.onSelectDevice?.(device);
  }

  /**
   * 机柜 / 设备射线拾取。
   * 返回命中的机柜 id 与设备（可为 null）。
   *
   * 关键点：必须**对每个机柜单独取最近命中**，再在所有机柜里比距离取全局最近；
   * 不能"先命中的机柜就 break"——否则前排机柜只要有任何几何体被射线擦到，
   * 后面所有机柜就永远选不中（多柜场景下的典型故障）。
   */
  private hitTestRacks(): {
    rackId: string | null;
    device: { rackId: string; deviceId: string } | null;
  } {
    let best: { rackId: string; distance: number } | null = null;
    let bestDevice: { rackId: string; deviceId: string; distance: number } | null =
      null;

    for (const runtime of this.racks) {
      // 线（U 位刻度线、线框叠加层）纯装饰，不参与拾取：
      // 它们没有归属信息，且射线与线的判定是"距离阈值"而非精确相交，很容易误命中。
      const hits = this.raycaster
        .intersectObject(runtime.group, true)
        .filter((hit) => !(hit.object as THREE.Line).isLine);
      if (hits.length === 0) continue;

      const nearest = hits[0];
      if (!nearest) continue;
      if (!best || nearest.distance < best.distance) {
        best = { rackId: runtime.id, distance: nearest.distance };
      }

      // 沿命中链找第一个归属明确的物体：
      //   - 命中设备（机身 / 面板 / 指示灯）→ 选中该设备
      //   - 命中不透明但不属于任何设备（机柜立柱、顶底板）→ 视为遮挡，停止
      //   - 命中半透明件（侧板、xray 下的柜体）→ 继续往后找，实现"看穿柜体点设备"
      for (const hit of hits) {
        const deviceId = hit.object.userData?.deviceId;
        if (typeof deviceId === "string") {
          if (!bestDevice || hit.distance < bestDevice.distance) {
            bestDevice = { rackId: runtime.id, deviceId, distance: hit.distance };
          }
          break;
        }
        if (!isTransparent(hit.object)) break;
      }
    }

    // 设备必须比机柜更近才算命中设备，否则只是点到了机柜外壳
    if (bestDevice && (!best || bestDevice.distance <= best.distance + 1e-4)) {
      return {
        rackId: bestDevice.rackId,
        device: { rackId: bestDevice.rackId, deviceId: bestDevice.deviceId },
      };
    }
    return { rackId: best?.rackId ?? null, device: null };
  }

  /**
   * 诊断接口（仅供端到端探针使用）：对画布坐标做一次射线测试并回传逐机柜详情。
   * 不参与业务逻辑，也不改变任何状态。
   */
  debugProbe(clientX: number, clientY: number): unknown {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pickResult = this.hitTestRacks();
    return {
      camera: this.cameraMode,
      renderMode: this.renderMode,
      lineThreshold: this.raycaster.params.Line?.threshold ?? null,
      cameraPos: this.camera.position.toArray().map((n) => +n.toFixed(3)),
      target: this.controls.target.toArray().map((n) => +n.toFixed(3)),
      selectedRack: this.selectedRackId,
      selectedDevice: this.selectedDeviceId,
      maskActive: this.maskActive,
      pick: pickResult,
      racks: this.racks.map((runtime) => {
        const hits = this.raycaster
          .intersectObject(runtime.group, true)
          .filter((hit) => !(hit.object as THREE.Line).isLine);
        return {
          id: runtime.id,
          groupX: +runtime.group.position.x.toFixed(3),
          hitCount: hits.length,
          first: hits.slice(0, 4).map((hit) => ({
            distance: +hit.distance.toFixed(3),
            type: hit.object.type,
            rackId: hit.object.userData?.rackId ?? null,
            deviceId: hit.object.userData?.deviceId ?? null,
          })),
        };
      }),
    };
  }

  // ------------------------------------------------------------ 渲染循环
  /** 机柜名标签的固定屏幕高度（CSS 像素）：不随相机距离近大远小 */
  private static readonly LABEL_HEIGHT_PX = 30;
  #labelScratch = new THREE.Vector3();

  /**
   * 每帧把机柜名标签的世界尺寸换算成固定像素高：
   * - 正交相机：可视高度 = (top-bottom)/zoom，与距离无关；
   * - 透视相机：可视高度 = 2·dist·tan(fov/2)，随距离变化 → 按距离反算。
   * 宽度按画布宽高比伸缩（标签纹理本身已按文字长度自适应）。
   */
  private updateLabelPixels(): void {
    const vh = this.canvas.clientHeight;
    if (!vh) return;
    const ortho = this.camera as THREE.OrthographicCamera;
    const isOrtho = ortho.isOrthographicCamera === true;
    const persp = this.camera as THREE.PerspectiveCamera;
    const tanHalf = Math.tan((persp.fov * Math.PI) / 360);
    for (const runtime of this.racks) {
      const sprite = runtime.labelSprite;
      if (!sprite || !sprite.visible) continue;
      let worldPerPx: number;
      if (isOrtho) {
        worldPerPx = (ortho.top - ortho.bottom) / (ortho.zoom || 1) / vh;
      } else {
        sprite.getWorldPosition(this.#labelScratch);
        const dist = Math.max(
          0.001,
          persp.position.distanceTo(this.#labelScratch),
        );
        worldPerPx = (2 * dist * tanHalf) / vh;
      }
      const h = worldPerPx * RackSceneController.LABEL_HEIGHT_PX;
      const aspect = (sprite.userData.labelAspect as number) || 4;
      sprite.scale.set(h * aspect, h, 1);
    }
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.animate);
    this.clock.getDelta();
    this.stepTween();
    this.controls.update();
    this.updateLabelPixels();
    this.renderFrame();
    // 通知外部刷新二维弹窗位置（相机每帧都可能移动）
    this.onFrame?.();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.controls.dispose();
    this.clearProps();
    this.clearRacks();
    this.groundHint.geometry.dispose();
    (this.groundHint.material as THREE.Material).dispose();
    // 释放后处理管线（渲染目标 + 深度纹理 + 合成材质）
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.maskRT.depthTexture?.dispose();
    this.maskRT.dispose();
    this.compositeMaterial.dispose();
    this.maskMaterial.dispose();
    for (const child of this.compositeScene.children) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
    }
    this.renderer.dispose();
  }
}
