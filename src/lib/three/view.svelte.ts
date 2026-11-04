/**
 * Rack3D 视图状态（独立于 Rackula 的 ui store，避免污染上游文件）
 * ============================================================================
 * 分三类：
 *   1. 面板开关（显隐 / 侧板 / 遥测着色）
 *   2. 相机与展示（渲染模式 / 投影方式 / 视角预设 / 自动聚焦）
 *   3. 场景元素（摆放模式 + 元素列表，持久化到 localStorage）
 */

import {
  type CameraMode,
  type PropKind,
  type RenderMode,
  type SceneProp,
  type SceneTheme,
  type ViewPreset,
} from "./rack-scene";
import { getLayoutStore } from "$lib/stores/layout.svelte";

/**
 * 摆放元素按「布局」隔离存储：每个布局一套 key，互不共享。
 * 旧版用全局 `rack3d_scene_props`，所有布局共用同一份 —— 已废弃。
 */
const PROPS_KEY_PREFIX = "rack3d_scene_props:";
const THEME_KEY = "rack3d_scene_theme";

/** 当前布局 id（取不到时回退到 "default"） */
function currentLayoutId(): string | null {
  try {
    return getLayoutStore().layout?.metadata?.id ?? null;
  } catch {
    return null;
  }
}

/** 某布局专属的 localStorage key */
function propsKeyFor(layoutId: string | null | undefined): string {
  return PROPS_KEY_PREFIX + (layoutId || "default");
}

let open = $state(false);
let showSidePanels = $state(true);
let driveByTelemetry = $state(true);
let renderMode = $state<RenderMode>("solid");

/** 相机投影方式：默认正交（工程读图更准） */
let cameraMode = $state<CameraMode>("ortho");
/** 视角预设 */
let viewPreset = $state<ViewPreset>("iso");
/** 2D 画布选中机柜/设备时，3D 是否自动聚焦过去 */
let autoFocus = $state(true);

/** 三维场景主题：dark（暗色，默认）/ light（亮色） */
let sceneTheme = $state<SceneTheme>(loadTheme());

function loadTheme(): SceneTheme {
  if (typeof localStorage === "undefined") return "dark";
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

/** 摆放模式 */
let placementMode = $state(false);
/** 当前"手持"的元素类型：点击地面即落地 */
let armedProp = $state<PropKind | null>(null);
/** 已摆放的场景元素 */
let props = $state<SceneProp[]>(loadProps());

function readProps(key: string): SceneProp[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is SceneProp =>
        p &&
        typeof p.id === "string" &&
        typeof p.kind === "string" &&
        typeof p.x === "number" &&
        typeof p.z === "number",
    );
  } catch {
    return [];
  }
}

function loadProps(): SceneProp[] {
  return readProps(propsKeyFor(currentLayoutId()));
}

function persistProps(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(propsKeyFor(currentLayoutId()), JSON.stringify(props));
  } catch {
    // 持久化失败不影响当前会话
  }
}

export function get3DViewStore() {
  return {
    get open() {
      return open;
    },
    get showSidePanels() {
      return showSidePanels;
    },
    get driveByTelemetry() {
      return driveByTelemetry;
    },
    /** 当前渲染模式：solid（实体）/ wireframe（线框+材质）/ xray（线框+半透明柜体） */
    get renderMode() {
      return renderMode;
    },
    /** 相机投影方式：ortho（正交，默认）/ perspective（透视） */
    get cameraMode() {
      return cameraMode;
    },
    get viewPreset() {
      return viewPreset;
    },
    get autoFocus() {
      return autoFocus;
    },
    /** 场景主题：dark（暗色）/ light（亮色） */
    get sceneTheme() {
      return sceneTheme;
    },
    get placementMode() {
      return placementMode;
    },
    get armedProp() {
      return armedProp;
    },
    get props() {
      return props;
    },

    set(next: boolean) {
      open = next;
    },
    toggle() {
      open = !open;
    },
    setShowSidePanels(next: boolean) {
      showSidePanels = next;
    },
    setDriveByTelemetry(next: boolean) {
      driveByTelemetry = next;
    },
    setRenderMode(next: RenderMode) {
      renderMode = next;
    },
    setCameraMode(next: CameraMode) {
      cameraMode = next;
    },
    setViewPreset(next: ViewPreset) {
      viewPreset = next;
    },
    setAutoFocus(next: boolean) {
      autoFocus = next;
    },
    setSceneTheme(next: SceneTheme) {
      sceneTheme = next;
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // 持久化失败不影响当前会话
        }
      }
    },
    setPlacementMode(next: boolean) {
      placementMode = next;
      if (!next) armedProp = null;
    },
    armProp(kind: PropKind | null) {
      armedProp = kind;
      // 手持元素即意味着处于摆放模式
      if (kind) placementMode = true;
    },

    /** 在指定地面坐标落地一个元素，返回新元素 id */
    addProp(kind: PropKind, x: number, z: number, colour: string): string {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `prop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      props = [...props, { id, kind, x, z, rotation: 0, colour }];
      persistProps();
      return id;
    },

    moveProp(id: string, x: number, z: number) {
      props = props.map((p) => (p.id === id ? { ...p, x, z } : p));
    },

    /** 拖动结束时落库 */
    commitProps() {
      persistProps();
    },

    setPropColour(id: string, colour: string) {
      props = props.map((p) => (p.id === id ? { ...p, colour } : p));
      persistProps();
    },

    removeProp(id: string) {
      props = props.filter((p) => p.id !== id);
      persistProps();
    },

    clearProps() {
      props = [];
      persistProps();
    },

    /**
     * 切换到某布局时调用：加载该布局专属的摆放元素（不同布局互不共享）。
     * 调用方（Rack3DViewer 的布局切换 $effect）需保证切换前当前布局的
     * 改动已通过 addProp/moveProp/removeProp/clearProps 落库。
     */
    loadPropsFor(layoutId: string | null | undefined) {
      props = readProps(propsKeyFor(layoutId));
    },
  };
}
