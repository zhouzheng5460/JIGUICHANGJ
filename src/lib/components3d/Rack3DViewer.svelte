<!--
  Rack3DViewer Component  ——  Rack3D 扩展（非 Rackula 上游代码）

  2D 画布右侧的实时 3D 机柜视图。系统始终满足的约束（EARS 风格）：
  - When 布局发生变更, the viewer shall 在下一帧重建 3D 场景，无需用户手动刷新。
  - When 遥测数据到达, the viewer shall 更新对应设备的指示灯与机身染色，
    不重建整个场景。
  - If 某设备的数据链路中断, then the viewer shall 将其指示灯置为「离线/异常」色，
    而不是保留旧值造成误读。
  - While 面板处于收起状态, the viewer shall 停止渲染循环以释放 GPU 占用。
  - When 用户在 2D 画布选中机柜或设备, the viewer shall 自动将相机聚焦到该对象
    （可由「自动聚焦」开关关闭）。
  - Where 用户点击 3D 场景中的设备, the viewer shall 在该设备的屏幕投影位置
    弹出二维数据卡片，并随相机移动实时跟随。
  - Where 用户需要穿透查看柜内设备, the viewer shall 提供「实体 / 线框 / 透视」
    三种渲染模式。
  - Where 用户切换投影方式或视角预设, the viewer shall 保持当前取景范围不跳变。
  - Where 用户开启摆放模式, the viewer shall 允许在地平面上增删场景元素，
    但**不得**改变机柜与其内部设备的位置。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { getLayoutStore } from "$lib/stores/layout.svelte";
  import { getSelectionStore } from "$lib/stores/selection.svelte";
  import { getToastStore } from "$lib/stores/toast.svelte";
  import { getTelemetryStore } from "$lib/telemetry/store.svelte";
  import {
    ADAPTER_LABELS,
    ALL_METRICS,
    LINK_STATE_LABELS,
    METRIC_LABELS,
    METRIC_UNITS,
    NUMERIC_METRICS,
    QUALITY_LABELS,
    type MetricKey,
  } from "$lib/telemetry/types";
  import {
    PROP_KIND_LABELS,
    PROP_PALETTE,
    RackSceneController,
    SCENE_THEME_LABELS,
    STATUS_COLOURS,
    VIEW_PRESET_LABELS,
    type CameraMode,
    type DeviceStatus,
    type PropKind,
    type RackSceneDevice,
    type RackSceneRack,
    type RenderMode,
    type SceneTheme,
    type ViewPreset,
  } from "$lib/three/rack-scene";
  import { get3DViewStore } from "$lib/three/view.svelte";
  import { organizeRackRow } from "$lib/utils/rack-row";
  import type { Rack } from "$lib/types";

  interface Props {
    open: boolean;
    onclose?: () => void;
  }

  let { open, onclose }: Props = $props();

  const layoutStore = getLayoutStore();
  const selection = getSelectionStore();
  const telemetry = getTelemetryStore();
  const toastStore = getToastStore();
  const view3D = get3DViewStore();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let controller: RackSceneController | null = null;
  /** 控制器就绪计数器：让依赖"场景已创建"的 $effect 能正确重跑 */
  let sceneToken = $state(0);
  let sceneError = $state<string | null>(null);
  let deviceCount = $state(0);

  /** 当前选中的设备（3D 内二维弹窗的主角） */
  let picked = $state<{ rackId: string; deviceId: string } | null>(null);
  /** 弹窗在画布内的像素坐标；由渲染循环每帧更新（flip=锚点上方装不下，改挂下方） */
  let anchor = $state<{ x: number; y: number; flip: boolean } | null>(null);

  /** 当前选中的机柜（机柜整体也是可交互对象） */
  let pickedRack = $state<string | null>(null);
  /** 机柜弹窗的屏幕坐标 */
  let rackAnchor = $state<{ x: number; y: number; flip: boolean } | null>(null);

  /** 当前选中的场景元素 */
  let selectedPropId = $state<string | null>(null);
  /** 场景元素浮动条的屏幕坐标 */
  let propAnchor = $state<{ x: number; y: number; flip: boolean } | null>(null);
  /** 是否正在拖动场景元素（拖动时浮动条不拦截指针，保证能正常松手落位） */
  let propDragging = $state(false);

  /**
   * 弹窗 DOM 引用（非响应式即可）：渲染循环里直接读 `offsetWidth/offsetHeight`。
   * 卡片实际高度由指标行数决定，用常量估算会把卡片顶出视口压到标题栏 / 底部按钮上。
   */
  let devicePopupEl = $state<HTMLDivElement | null>(null);
  let rackPopupEl = $state<HTMLDivElement | null>(null);

  const STATUS_LEGEND: { status: DeviceStatus; label: string }[] = [
    { status: "online", label: "正常" },
    { status: "warn", label: "告警" },
    { status: "crit", label: "严重" },
    { status: "offline", label: "离线" },
    { status: "unknown", label: "未接入" },
  ];

  const STATUS_LABEL: Record<DeviceStatus, string> = {
    online: "正常",
    warn: "告警",
    crit: "严重",
    offline: "离线",
    unknown: "未接入",
  };

  /** 机柜形态中文读法 */
  const FORM_FACTOR_TEXT: Record<string, string> = {
    "4-post-cabinet": "四柱机柜",
    "4-post": "四柱机柜",
    cabinet: "机柜",
    "open-frame": "开放式机架",
    "2-post-rack": "双柱机架",
    "wall-mount": "壁挂机柜",
  };

  const RENDER_MODES: { mode: RenderMode; label: string; hint: string }[] = [
    { mode: "solid", label: "实体", hint: "默认实体渲染" },
    { mode: "wireframe", label: "线框", hint: "蓝色线框 + 实体材质" },
    { mode: "xray", label: "透视", hint: "蓝色线框 + 半透明机柜" },
  ];

  const CAMERA_MODES: { mode: CameraMode; label: string; hint: string }[] = [
    { mode: "ortho", label: "正交", hint: "正交投影：无透视收缩，适合读尺寸" },
    { mode: "perspective", label: "透视", hint: "透视投影：近大远小，更接近肉眼" },
  ];

  const VIEW_PRESETS: ViewPreset[] = ["iso", "front", "side", "top"];

  /** 三维场景主题（黑 / 白）：仅改配色与打光，不动几何 */
  const SCENE_THEMES: SceneTheme[] = ["dark", "light"];

  const PROP_KINDS: PropKind[] = ["cube", "sphere", "table", "chair"];

  /** 采集平台 status 字段的中文读法 */
  const STATUS_TEXT: Record<string, string> = {
    online: "在线",
    offline: "离线",
    up: "正常",
    down: "故障",
    ok: "正常",
    warn: "告警",
    warning: "告警",
    error: "异常",
    fault: "故障",
    running: "运行中",
    stopped: "已停止",
  };

  const FACE_TEXT: Record<string, string> = {
    front: "正面",
    rear: "背面",
    both: "前后贯通",
  };

  /** 进度条基准上限：优先用绑定阈值 crit，否则用经验满量程 */
  const METRIC_FULL_SCALE: Record<MetricKey, number> = {
    power_w: 3000,
    current_a: 16,
    voltage_v: 250,
    temp_c: 60,
    humidity: 100,
    rpm: 6000,
    status: 0,
    on_off: 0,
  };

  // ---------------------------------------------------------------- 映射
  function toSceneDevices(rack: Rack): RackSceneDevice[] {
    return rack.devices
      .filter((placed) => !placed.container_id)
      .map((placed) => {
        const deviceType = layoutStore.device_types.find(
          (d) => d.slug === placed.device_type,
        );
        return {
          id: placed.id,
          label:
            placed.name ??
            placed.label ??
            deviceType?.model ??
            deviceType?.name ??
            placed.device_type,
          uHeight: deviceType?.u_height ?? 1,
          slotWidth: deviceType?.slot_width ?? 2,
          position: placed.position,
          face: placed.face,
          colour: placed.colour_override ?? deviceType?.colour ?? "#4a7a8a",
          isFullDepth: deviceType?.is_full_depth ?? true,
        } satisfies RackSceneDevice;
      });
  }

  /**
   * 3D 场景里的机柜排列顺序 = 2D 画布的行顺序。
   * 真相源是 `rack-row.ts:organizeRackRow()`（按 `Rack.position` 排，且组内成员连续），
   * 不能直接用 `layoutStore.racks` 的数组顺序——那个顺序与画布不一致，
   * 会导致用户在画布上调完左右顺序后 3D 里没反应。
   */
  function orderedRacks(): Rack[] {
    return organizeRackRow(layoutStore.racks, layoutStore.rack_groups).flatMap(
      (item) => (item.kind === "rack" ? [item.rack] : item.racks),
    );
  }

  function toSceneRacks(): RackSceneRack[] {
    return orderedRacks().map((rack) => ({
      id: rack.id,
      name: rack.name,
      heightU: rack.height,
      widthIn: rack.width,
      depthMm: rack.depth_mm ?? 1000,
      formFactor: rack.form_factor,
      devices: toSceneDevices(rack),
    }));
  }

  // ---------------------------------------------------------------- 遥测 → 状态
  /**
   * 由遥测帧推导设备状态。优先级：
   *   链路异常 > 开关关闭/离线 > 阈值超标 > 正常
   * 没有绑定的设备保持"未接入"，绝不用假数据填充。
   */
  function deriveStatus(assetId: string): DeviceStatus | null {
    const binding = telemetry.bindings.find((b) => b.asset_id === assetId);
    if (!binding) return null;

    const frame = telemetry.getFrame(assetId);
    if (!frame) return "unknown";
    if (frame.quality === "bad") return "offline";
    if (frame.quality === "stale") return "warn";

    const { metrics } = frame;
    const onOff = metrics.on_off;
    if (onOff === false) return "offline";

    const statusText =
      typeof metrics.status === "string" ? metrics.status.toLowerCase() : null;
    if (
      statusText &&
      ["offline", "down", "fail", "fault", "error"].includes(statusText)
    ) {
      return "offline";
    }

    let worst: DeviceStatus = "online";
    for (const [metric, threshold] of Object.entries(binding.thresholds ?? {})) {
      const raw = metrics[metric as keyof typeof metrics];
      if (typeof raw !== "number" || !threshold) continue;
      if (raw >= threshold.crit) return "crit";
      if (raw >= threshold.warn) worst = "warn";
    }
    return worst;
  }

  function buildStatusMap(): Record<string, DeviceStatus> {
    const map: Record<string, DeviceStatus> = {};
    for (const rack of layoutStore.racks) {
      // 设备级绑定优先；没有设备级绑定时继承机柜级状态
      const rackStatus = deriveStatus(rack.id);
      for (const placed of rack.devices) {
        const status = deriveStatus(placed.id) ?? rackStatus;
        if (status) map[placed.id] = status;
      }
    }
    return map;
  }

  // ---------------------------------------------------------------- 弹窗数据
  const popup = $derived.by(() => {
    const deviceId = picked?.deviceId;
    if (!deviceId) return null;

    let placed = null;
    let owningRack = null;
    for (const rack of layoutStore.racks) {
      const found = rack.devices.find((d) => d.id === deviceId);
      if (found) {
        placed = found;
        owningRack = rack;
        break;
      }
    }
    if (!placed || !owningRack) return null;

    const deviceType = layoutStore.device_types.find(
      (d) => d.slug === placed.device_type,
    );
    const binding = telemetry.bindings.find((b) => b.asset_id === deviceId);
    const frame = binding ? telemetry.getFrame(deviceId) : null;
    const runtime = binding ? telemetry.runtimes[binding.id] : undefined;
    const status = deriveStatus(deviceId) ?? "unknown";

    const name =
      placed.name ?? placed.label ?? deviceType?.model ?? placed.device_type;

    // 进度条：取第一个有数值的绑定指标
    const numericMetrics = (binding?.metrics ?? []).filter((m) =>
      NUMERIC_METRICS.includes(m),
    );
    const barMetric =
      numericMetrics.find((m) => typeof frame?.metrics[m] === "number") ?? null;
    const barValue =
      barMetric && typeof frame?.metrics[barMetric] === "number"
        ? (frame.metrics[barMetric] as number)
        : null;
    const bar = barMetric && barValue !== null
      ? {
          metric: barMetric,
          value: barValue,
          full:
            binding?.thresholds?.[barMetric]?.crit ??
            METRIC_FULL_SCALE[barMetric] ??
            1,
        }
      : null;

    // 折线图：取第一个攒够采样点的指标
    const chartMetric =
      numericMetrics.find((m) => telemetry.getHistory(deviceId, m).length >= 2) ??
      null;
    const chartValues = chartMetric
      ? telemetry.getHistory(deviceId, chartMetric)
      : [];
    const chart =
      chartMetric && chartValues.length >= 2
        ? {
            metric: chartMetric,
            values: chartValues,
            last: chartValues[chartValues.length - 1] as number,
          }
        : null;

    return {
      name,
      model: deviceType?.model ?? placed.device_type,
      rackName: owningRack.name,
      uHeight: deviceType?.u_height ?? 1,
      face: FACE_TEXT[placed.face] ?? placed.face,
      binding,
      frame,
      runtime,
      status,
      bar,
      chart,
      // 全部绑定指标都成行展示（功率 / 电流 / 电压 / 温度 / 湿度 / 状态 / 开关 / 转速）；
      // 数值型在下方另有进度条与趋势图，行里给的是精确读数。
      metricRows: orderedMetrics(binding?.metrics),
    };
  });

  // ---------------------------------------------------------------- 机柜弹窗数据
  /**
   * 机柜整体作为一个交互对象时，弹窗展示的是"柜级"信息：
   * 规格 + 柜内设备状态分布 + 柜级采集绑定。设备逐个的属性留给设备弹窗。
   */
  const rackPopup = $derived.by(() => {
    const rackId = pickedRack;
    if (!rackId) return null;
    const rack = layoutStore.racks.find((r) => r.id === rackId);
    if (!rack) return null;

    const counts: Record<DeviceStatus, number> = {
      online: 0,
      warn: 0,
      crit: 0,
      offline: 0,
      unknown: 0,
    };
    for (const placed of rack.devices) {
      const status =
        deriveStatus(placed.id) ?? deriveStatus(rack.id) ?? "unknown";
      counts[status] += 1;
    }
    const total = rack.devices.length;

    // 柜级总体状态取"最坏的那个"，与指示灯语义一致
    let worst: DeviceStatus = "online";
    if (counts.crit > 0) worst = "crit";
    else if (counts.warn > 0) worst = "warn";
    else if (counts.offline > 0) worst = "offline";
    else if (total === 0 || counts.online === 0) worst = "unknown";

    const summary =
      total === 0
        ? "暂无设备"
        : (["online", "warn", "crit", "offline", "unknown"] as DeviceStatus[])
            .filter((status) => counts[status] > 0)
            .map((status) => `${STATUS_LABEL[status]} ${counts[status]}`)
            .join(" · ");

    const binding = telemetry.bindings.find((b) => b.asset_id === rackId);
    const frame = binding ? telemetry.getFrame(rackId) : null;

    // 柜级进度条：取第一个有数值的绑定指标，与设备弹窗同一套口径
    const numericMetrics = (binding?.metrics ?? []).filter((m) =>
      NUMERIC_METRICS.includes(m),
    );
    const barMetric =
      numericMetrics.find((m) => typeof frame?.metrics[m] === "number") ?? null;
    const barValue =
      barMetric && typeof frame?.metrics[barMetric] === "number"
        ? (frame.metrics[barMetric] as number)
        : null;
    const bar =
      barMetric && barValue !== null
        ? {
            metric: barMetric,
            value: barValue,
            full:
              binding?.thresholds?.[barMetric]?.crit ??
              METRIC_FULL_SCALE[barMetric] ??
              1,
          }
        : null;

    return {
      name: rack.name,
      heightU: rack.height,
      widthIn: rack.width,
      depthMm: rack.depth_mm ?? 1000,
      formFactor: FORM_FACTOR_TEXT[rack.form_factor] ?? rack.form_factor,
      deviceCount: total,
      statusColour: STATUS_COLOURS[worst],
      statusText: STATUS_LABEL[worst],
      summary,
      binding,
      frame,
      runtime: binding ? telemetry.runtimes[binding.id] : undefined,
      bar,
      // 全部绑定指标都成行展示
      metricRows: orderedMetrics(binding?.metrics),
    };
  });

  const propSelection = $derived(
    selectedPropId
      ? (view3D.props.find((p) => p.id === selectedPropId) ?? null)
      : null,
  );

  /**
   * 弹窗要展示的指标行 = 绑定的**全部**指标，按 `ALL_METRICS` 的规范顺序排列。
   * 之前只渲染"非数值指标"（状态 / 开关），功率、电流、电压、温度、湿度、转速
   * 这些只有在恰好被选中画进度条时才露出一个值，与 2D「已绑定资产」面板对不上。
   * 数值指标在下方还有进度条 / 趋势图，行里重复列出是刻意的：行给"精确读数"。
   */
  function orderedMetrics(metrics: MetricKey[] | undefined): MetricKey[] {
    if (!metrics?.length) return [];
    const rank = new Map(ALL_METRICS.map((m, i) => [m, i]));
    return [...metrics].sort(
      (a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99),
    );
  }

  function formatMetric(key: MetricKey, value: unknown): string {
    if (value === undefined || value === null) return "—";
    if (typeof value === "boolean") return value ? "开" : "关";
    if (key === "status" && typeof value === "string") {
      return STATUS_TEXT[value.toLowerCase()] ?? value;
    }
    if (typeof value === "number") {
      return `${value}${METRIC_UNITS[key] ?? ""}`;
    }
    return String(value);
  }

  function formatNumber(value: number, key: MetricKey): string {
    const unit = METRIC_UNITS[key] ?? "";
    const rounded = Number.isInteger(value) ? value : value.toFixed(1);
    return `${rounded}${unit}`;
  }

  /** 把采样序列折算成 SVG 折线路径（自动适配 min/max，留 3px 内边距） */
  function sparkPath(values: number[], width: number, height: number): string {
    if (values.length < 2) return "";
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 1e-6) {
      min -= 1;
      max += 1;
    }
    const pad = 3;
    const innerHeight = height - pad * 2;
    const stepX = width / (values.length - 1);
    return values
      .map((value, index) => {
        const x = index * stepX;
        const y = pad + innerHeight * (1 - (value - min) / (max - min));
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  function closePopup(): void {
    picked = null;
    anchor = null;
  }

  /** 关闭机柜弹窗：同时解除机柜选中（他柜恢复不透明） */
  function closeRackPopup(): void {
    pickedRack = null;
    rackAnchor = null;
    if (!picked) controller?.setSelectedRack(null);
  }

  function setRenderMode(mode: RenderMode): void {
    view3D.setRenderMode(mode);
  }

  function setViewPreset(value: string): void {
    view3D.setViewPreset(value as ViewPreset);
  }

  // ---------------------------------------------------------------- 生命周期
  // 注意：本组件始终挂载，但 <canvas> 只在 open 为真时才渲染。
  // 因此不能用 onMount（那一刻 canvasEl 还是 null），必须用 $effect 跟踪 canvasEl：
  // 面板打开时创建控制器，关闭时销毁，避免重复创建与 GPU 泄漏。
  $effect(() => {
    const canvas = canvasEl;
    if (!canvas) return;

    let instance: RackSceneController | null = null;
    untrack(() => {
      try {
        instance = new RackSceneController(canvas);
        instance.onSelectRack = (rackId) => {
          pickedRack = rackId;
          rackAnchor = null;
          // 点空白处（rackId === null）必须把「活动机柜」一起清掉：
          // 否则自动聚焦的 $effect 会退回读 layoutStore.activeRackId，
          // 把刚刚复位成「全场景取景」的相机又推回上一个机柜上，
          // 表现为"点了空白，取景却没复位"。
          layoutStore.setActiveRack(rackId);
          // 3D 内点选机柜时同步 2D 选中态，实现双向联动（2D→3D 见下方 sync 效果）
          if (rackId) {
            selection.selectRack(rackId);
          } else if (!picked) {
            selection.clearSelection();
          }
        };
        instance.onSelectDevice = (payload) => {
          picked = payload;
          // 选中新设备时先清掉锚点，避免弹窗在新位置"闪"一下旧坐标
          anchor = null;
          if (payload) {
            // 设备弹窗优先，机柜弹窗让位
            pickedRack = null;
            rackAnchor = null;
            // 3D 内选设备时同步 2D 选中态，实现双向联动
            selection.selectDevice(payload.rackId, payload.deviceId);
          } else if (!pickedRack) {
            // 点在空白处：清空选中，并把相机复位到「全部设备都可见」
            rackAnchor = null;
            // 2D 侧的选中也要一起清掉，否则它会把 3D 选中态"顶回来"
            selection.clearSelection();
            if (view3D.autoFocus) instance?.resetView();
          }
        };
        instance.onSelectProp = (propId) => {
          selectedPropId = propId;
        };
        instance.onPlaceProp = (x, z) => {
          const kind = view3D.armedProp;
          if (!kind) return;
          const id = view3D.addProp(kind, x, z, PROP_PALETTE[0] ?? "#8be9fd");
          selectedPropId = id;
        };
        instance.onPropMoveEnd = (id, x, z) => {
          view3D.moveProp(id, x, z);
          view3D.commitProps();
          propDragging = false;
        };
        instance.onPropMoved = () => {
          propDragging = true;
        };
        instance.onFrame = () => {
          const deviceId = picked?.deviceId ?? null;
          const next = deviceId
            ? (instance?.getDeviceAnchor(
                deviceId,
                devicePopupEl?.offsetWidth,
                devicePopupEl?.offsetHeight,
              ) ?? null)
            : null;
          // 阈值过滤：避免每帧都触发 Svelte 更新
          if (!next) {
            if (anchor) anchor = null;
          } else if (
            !anchor ||
            anchor.flip !== next.flip ||
            Math.abs(anchor.x - next.x) > 0.5 ||
            Math.abs(anchor.y - next.y) > 0.5
          ) {
            anchor = next;
          }

          const propId = selectedPropId;
          const nextProp = propId
            ? (instance?.getPropAnchor(propId) ?? null)
            : null;
          if (!nextProp) {
            if (propAnchor) propAnchor = null;
          } else if (
            !propAnchor ||
            Math.abs(propAnchor.x - nextProp.x) > 0.5 ||
            Math.abs(propAnchor.y - nextProp.y) > 0.5
          ) {
            propAnchor = nextProp;
          }

          const rackId = picked ? null : pickedRack;
          const nextRack = rackId
            ? (instance?.getRackAnchor(
                rackId,
                rackPopupEl?.offsetWidth,
                rackPopupEl?.offsetHeight,
              ) ?? null)
            : null;
          if (!nextRack) {
            if (rackAnchor) rackAnchor = null;
          } else if (
            !rackAnchor ||
            rackAnchor.flip !== nextRack.flip ||
            Math.abs(rackAnchor.x - nextRack.x) > 0.5 ||
            Math.abs(rackAnchor.y - nextRack.y) > 0.5
          ) {
            rackAnchor = nextRack;
          }
        };
        controller = instance;
        sceneError = null;
        // 开发期把控制器挂到 window，供端到端探针读取引擎内部状态
        if (import.meta.env.DEV) {
          (window as unknown as Record<string, unknown>).__rack3d = instance;
        }
        rebuild();
        applyStatuses();
        instance.setProps(view3D.props);
        instance.setRenderMode(view3D.renderMode);
        instance.setSceneTheme(view3D.sceneTheme);
        instance.setPlacementMode(view3D.placementMode);
        // 先复位取景（确定方位与范围），再套用持久化的相机/视角设置
        instance.resetView();
        instance.setCameraMode(view3D.cameraMode);
        instance.setViewPreset(view3D.viewPreset);
        sceneToken += 1;
      } catch (error) {
        sceneError =
          error instanceof Error ? error.message : "3D 渲染器初始化失败";
        instance = null;
        controller = null;
      }
    });

    return () => {
      instance?.dispose();
      if (controller === instance) controller = null;
      if (import.meta.env.DEV) {
        delete (window as unknown as Record<string, unknown>).__rack3d;
      }
      picked = null;
      anchor = null;
      pickedRack = null;
      rackAnchor = null;
      propAnchor = null;
      sceneToken += 1;
    };
  });

  // ---------------------------------------------------------------- 同步
  function rebuild(): void {
    if (!controller) return;
    const racks = toSceneRacks();
    controller.setRacks(racks, {
      activeRackId: layoutStore.activeRackId,
      showSidePanels: view3D.showSidePanels,
    });
    deviceCount = racks.reduce((sum, rack) => sum + rack.devices.length, 0);
  }

  function applyStatuses(): void {
    if (!controller) return;
    controller.setDeviceStatuses(
      view3D.driveByTelemetry ? buildStatusMap() : {},
    );
  }

  // 布局结构签名：只有几何相关的字段变化才需要重建场景。
  // ⚠️ 必须带上 `rack.position` 且按行顺序遍历：改排列顺序只动 position，
  //    不进签名的话 3D 永远不会重建（画布上拖完顺序没反应）。
  const layoutSignature = $derived(
    orderedRacks()
      .map(
        (rack) =>
          `${rack.id}@${rack.position}:${rack.height}:${rack.width}:${rack.depth_mm ?? 1000}:${rack.form_factor}:` +
          rack.devices
            .map(
              (d) =>
                `${d.id}@${d.position}@${d.face}@${d.device_type}@${d.colour_override ?? ""}@${d.name ?? ""}`,
            )
            .join(","),
      )
      .join("|"),
  );

  // 场景元素签名：位置/颜色/数量任一变化都需要重建
  const propSignature = $derived(
    view3D.props
      .map((p) => `${p.id}:${p.kind}:${p.x.toFixed(3)}:${p.z.toFixed(3)}:${p.colour}`)
      .join("|"),
  );

  // 几何重建：只依赖布局签名与侧板开关。
  // rebuild() 内部会读取 activeRackId，这些都包在 untrack() 里，
  // 避免遥测每 2 秒触发一次全场景重建。
  $effect(() => {
    void layoutSignature;
    void view3D.showSidePanels;
    void sceneToken;
    untrack(() => {
      rebuild();
      applyStatuses();
    });
  });

  // 机柜改名即时同步到 3D 顶部文字标签：走轻量 setRackName（只重绘标签纹理，
  // 不重建几何），避免改名要等到切换视图/重建场景才生效。
  // 仅依赖布局里的机柜名（layoutSignature 不含 name，故改名不触发上面的全场景重建）。
  const rackNameMap = $derived(
    new Map(orderedRacks().map((r) => [r.id, r.name ?? r.id] as const)),
  );
  $effect(() => {
    void sceneToken; // 控制器就绪后再同步，避免重建时被覆盖
    if (!controller) return;
    for (const [id, name] of rackNameMap) controller.setRackName(id, name);
  });

  // 切换布局页签：加载该布局专属的摆放元素（R15-2）+ 复位取景（R15-1）。
  // 布局 id 变化才触发，避免侧板开关 / 控制器重建等无关变化误触复位。
  let lastLayoutId = "";
  $effect(() => {
    const layoutId = layoutStore.layout?.metadata?.id ?? "";
    void sceneToken;
    if (!layoutId || !sceneToken) return;
    if (layoutId === lastLayoutId) return;
    lastLayoutId = layoutId;
    untrack(() => {
      view3D.loadPropsFor(layoutId);
      controller?.resetView();
    });
  });

  // 遥测外观刷新：只改材质颜色，不重建几何（企划 AC：实时驱动不重排）。
  $effect(() => {
    void telemetry.frames;
    void telemetry.bindings;
    void view3D.driveByTelemetry;
    untrack(() => applyStatuses());
  });

  // 渲染模式切换：只改材质与线框显隐。
  $effect(() => {
    const mode = view3D.renderMode;
    untrack(() => controller?.setRenderMode(mode));
  });

  // 场景主题切换（黑 / 白）：只改配色与打光，不重建几何。
  $effect(() => {
    const theme = view3D.sceneTheme;
    void sceneToken;
    untrack(() => controller?.setSceneTheme(theme));
  });

  // 场景元素重建
  $effect(() => {
    void propSignature;
    void sceneToken;
    untrack(() => controller?.setProps(view3D.props));
  });

  // 元素选中态
  $effect(() => {
    const id = selectedPropId;
    untrack(() => controller?.setSelectedProp(id));
  });

  // 选中态同步（2D 画布 ↔ 3D 视窗 双向）。
  // 以 selection store 为唯一真相：
  //   画布选中机柜 → 3D 整柜选中 + 轮廓 + 打开机柜弹窗 + 他柜半透明
  //   画布选中设备 → 3D 设备选中 + 轮廓 + 打开设备弹窗
  //   画布无选中   → 3D 复位到未选中，关闭所有弹窗与选中效果
  // （3D 内点选会在 onSelectRack / onSelectDevice 里写回同一个 store）
  $effect(() => {
    const type = selection.selectedType;
    const deviceId = selection.selectedDeviceId ?? null;
    const storeRackId = selection.selectedRackId ?? null;
    void sceneToken;
    untrack(() => {
      if (!controller) return;

      if (type === "device" && deviceId) {
        picked = { rackId: storeRackId ?? "", deviceId };
        anchor = null;
        pickedRack = null;
        rackAnchor = null;
        controller.setSelectedDevice(deviceId);
        // 设备所在机柜一并进入选中态（保留"聚焦当前机柜"的观感）
        if (storeRackId) controller.setSelectedRack(storeRackId);
        return;
      }

      if ((type === "rack" || type === "group") && storeRackId) {
        picked = null;
        anchor = null;
        pickedRack = storeRackId;
        rackAnchor = null;
        controller.setSelectedDevice(null);
        controller.setSelectedRack(storeRackId);
        return;
      }

      // 无选中：复位到未选中状态
      const had = picked !== null || pickedRack !== null;
      picked = null;
      anchor = null;
      pickedRack = null;
      rackAnchor = null;
      controller.clearSelection();
      if (had && view3D.autoFocus) controller.resetView();
    });
  });

  // 摆放模式
  $effect(() => {
    const enabled = view3D.placementMode;
    untrack(() => controller?.setPlacementMode(enabled));
  });

  // 相机投影方式
  $effect(() => {
    const mode = view3D.cameraMode;
    untrack(() => controller?.setCameraMode(mode));
  });

  // 视角预设
  $effect(() => {
    const preset = view3D.viewPreset;
    untrack(() => controller?.setViewPreset(preset));
  });

  // 活动机柜变化 → 高亮
  $effect(() => {
    const activeRackId = layoutStore.activeRackId;
    controller?.setActiveRack(activeRackId);
  });

  // 机柜顶部名称标签：选中某柜且弹出其弹窗时隐藏该柜标签（避免与弹窗标题重复）；
  // 弹窗关闭后自动恢复全部标签可见。重建场景后标签默认重新可见，此处会重新套用。
  $effect(() => {
    const hiddenId = rackPopup && pickedRack ? pickedRack : null;
    void sceneToken;
    untrack(() => {
      if (!controller) return;
      controller.setRackLabelHidden(hiddenId, hiddenId !== null);
    });
  });

  // 自动聚焦：2D 画布选中机柜/设备、或 3D 内点选时把相机推过去。
  // 首次运行只记录基线，避免一打开面板就怼到某个机柜上。
  //
  // ⚠️ 判断依据**只能取 selection store**（选中态的唯一真相源）：
  //   `layoutStore.activeRackId` 是「侧栏活动机柜」语义，2D 画布点空白时
  //   `selection.clearSelection()` 会清掉选中态，但**不会**清 activeRackId；
  //   `pickedRack` 也可能残留。若把它们算进 key，"点空白复位"后 key 仍解析出机柜
  //   → 相机复位完立刻又 tween 回该机柜（现象：复位后跳回去聚焦）。
  //   selection 被清空时 selectedDeviceId / selectedRackId 必为 null，天然不会误触发。
  let lastFocusKey = "";
  $effect(() => {
    const deviceId = selection.selectedDeviceId ?? null;
    const rackId = selection.selectedRackId ?? null;
    const key = `${deviceId ?? ""}|${rackId ?? ""}`;
    const token = sceneToken;
    if (!token) return;
    if (!view3D.autoFocus || key === lastFocusKey) {
      lastFocusKey = key;
      return;
    }
    lastFocusKey = key;
    // 无选中 → 聚焦交给"复位"逻辑处理（sync 效果 / 点空白分支），这里不推相机
    if (!deviceId && !rackId) return;
    untrack(() => {
      if (deviceId) controller?.focusDevice(deviceId);
      else if (rackId) controller?.focusRack(rackId);
    });
  });

  function handleReset(): void {
    controller?.resetView();
  }

  function handleScreenshot(): void {
    const dataUrl = controller?.screenshot();
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "机柜3D视图.png";
    link.click();
    toastStore.showToast("3D 视图已导出为 PNG", "success");
  }

  function deleteProp(): void {
    if (!selectedPropId) return;
    view3D.removeProp(selectedPropId);
    selectedPropId = null;
  }
</script>

{#if open}
  <aside class="rack3d-panel" aria-label="3D 机柜视图">
    <header class="rack3d-head">
      <h2 class="rack3d-title">3D 机柜视图</h2>
      <button
        type="button"
        class="rack3d-close"
        aria-label="关闭 3D 机柜视图"
        title="关闭"
        onclick={() => onclose?.()}>✕</button
      >
    </header>

    <!-- 相机与视角工具条 -->
    <div class="rack3d-tools">
      <div class="tool-seg" role="group" aria-label="相机投影">
        {#each CAMERA_MODES as item (item.mode)}
          <button
            type="button"
            class="seg-btn"
            class:active={view3D.cameraMode === item.mode}
            aria-pressed={view3D.cameraMode === item.mode}
            title={item.hint}
            onclick={() => view3D.setCameraMode(item.mode)}>{item.label}</button
          >
        {/each}
      </div>

      <div class="tool-seg" role="group" aria-label="场景主题">
        {#each SCENE_THEMES as theme (theme)}
          <button
            type="button"
            class="seg-btn"
            class:active={view3D.sceneTheme === theme}
            aria-pressed={view3D.sceneTheme === theme}
            title={theme === "dark"
              ? "暗色场景：近黑底色、冷调打光"
              : "亮色场景：浅灰底色、柔和打光"}
            onclick={() => view3D.setSceneTheme(theme)}
            >{SCENE_THEME_LABELS[theme]}</button
          >
        {/each}
      </div>

      <select
        class="view-select"
        aria-label="视角切换"
        title="视角切换"
        value={view3D.viewPreset}
        onchange={(event) =>
          setViewPreset((event.currentTarget as HTMLSelectElement).value)}
      >
        {#each VIEW_PRESETS as preset (preset)}
          <option value={preset}>{VIEW_PRESET_LABELS[preset]}</option>
        {/each}
      </select>

      <button
        type="button"
        class="tool-btn"
        class:active={view3D.autoFocus}
        aria-pressed={view3D.autoFocus}
        title="选中 2D 画布中的机柜或设备时，3D 相机自动聚焦过去"
        onclick={() => view3D.setAutoFocus(!view3D.autoFocus)}>自动聚焦</button
      >

      <button
        type="button"
        class="tool-btn"
        class:active={view3D.placementMode}
        aria-pressed={view3D.placementMode}
        title="开启后可在地平面上摆放场景元素（机柜与柜内设备不可移动）"
        onclick={() => view3D.setPlacementMode(!view3D.placementMode)}
        >摆放</button
      >
    </div>

    <div class="rack3d-viewport" class:scene-light={view3D.sceneTheme === "light"}>
      <canvas bind:this={canvasEl}></canvas>

      {#if sceneError}
        <div class="rack3d-error">
          <p>3D 视图初始化失败：{sceneError}</p>
        </div>
      {/if}

      {#if deviceCount === 0 && !sceneError}
        <div class="rack3d-hint">
          <p>当前布局还没有设备。</p>
          <p>从左侧设备库拖入设备后，这里会实时生成 3D 机箱。</p>
        </div>
      {/if}

      <!-- 三维场景内的二维数据卡片：定位到被点设备的屏幕投影处 -->
      {#if popup && anchor}
        <div
          class="device-popup"
          class:below={anchor.flip}
          style="left:{anchor.x}px; top:{anchor.y}px"
          role="dialog"
          aria-label="设备实时数据"
          bind:this={devicePopupEl}
        >
          <header class="popup-head">
            <span
              class="popup-status"
              style="background:{STATUS_COLOURS[popup.status]}"
              aria-hidden="true"
            ></span>
            <span class="popup-name">{popup.name}</span>
            <button
              type="button"
              class="popup-close"
              aria-label="关闭设备数据"
              title="关闭"
              onclick={closePopup}>✕</button
            >
          </header>

          <!-- 静态模块：设备描述卡片（名称已在标题栏），网格布局节约高度 -->
          <div class="static-grid" role="list" aria-label="设备描述">
            <div class="static-card" role="listitem">
              <span class="s-value">{popup.model}</span>
              <span class="s-name">机型</span>
            </div>
            <div class="static-card" role="listitem" title={popup.rackName}>
              <span class="s-value">{popup.uHeight}U · {popup.face}</span>
              <span class="s-name">位置</span>
            </div>
          </div>

          <!-- 动态模块：全部指标网格卡片，突出数值与名称，压缩弹窗面积 -->
          <div class="metric-grid" role="list" aria-label="设备实时指标">
            {#each popup.metricRows as metric (metric)}
              <div class="metric-card" role="listitem">
                <span class="m-value"
                  >{formatMetric(metric, popup.frame?.metrics[metric])}</span
                >
                <span class="m-name">{METRIC_LABELS[metric]}</span>
              </div>
            {/each}
          </div>

          {#if popup.bar}
            {@const percent = Math.min(
              100,
              Math.max(0, (popup.bar.value / (popup.bar.full || 1)) * 100),
            )}
            <div class="popup-block">
              <div class="block-head">
                <span class="block-label">{METRIC_LABELS[popup.bar.metric]}</span>
                <span class="block-value"
                  >{formatNumber(popup.bar.value, popup.bar.metric)}</span
                >
              </div>
              <div class="bar-track" role="presentation">
                <i class="bar-fill" style="width:{percent}%"></i>
              </div>
            </div>
          {/if}

          {#if popup.chart}
            <div class="popup-block">
              <div class="block-head">
                <span class="block-label"
                  >{METRIC_LABELS[popup.chart.metric]}趋势</span
                >
                <span class="block-value"
                  >{formatNumber(popup.chart.last, popup.chart.metric)}</span
                >
              </div>
              <svg
                class="spark"
                viewBox="0 0 200 44"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d={sparkPath(popup.chart.values, 200, 44)}
                  fill="none"
                  stroke="var(--spark-colour, #3ddc84)"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
              <div class="chart-axis">
                <span>最近 {popup.chart.values.length} 次采样</span>
                <span>现在</span>
              </div>
            </div>
          {/if}

          {#if popup.binding}
            {@const state = popup.runtime?.state ?? "idle"}
            {@const quality = popup.frame?.quality ?? "bad"}
            <div class="popup-link">
              <span class="link-key">数据源</span>
              <span class="link-val">{ADAPTER_LABELS[popup.binding.adapter]}</span>
            </div>
            <div class="popup-link">
              <span
                class="link-badge"
                class:live={state === "live"}
                class:degraded={state === "degraded" || state === "connecting"}
                class:error={state === "error"}
                class:idle={state === "idle"}>{LINK_STATE_LABELS[state]}</span
              >
              <span
                class="quality-badge"
                class:good={quality === "good"}
                class:stale={quality === "stale"}
                class:bad={quality === "bad"}>{QUALITY_LABELS[quality]}</span
              >
            </div>
            {#if !popup.frame}
              <p class="popup-note">尚未收到数据帧，等待采集…</p>
            {/if}
          {:else}
            <p class="popup-note">
              该设备未绑定采集源。切换到右侧「遥测」页签新增数据绑定后，
              这里会显示实时指标。
            </p>
          {/if}
        </div>
      {/if}

      <!-- 机柜弹窗：机柜整体也是一个交互对象 -->
      {#if rackPopup && rackAnchor}
        <div
          class="device-popup wide"
          class:below={rackAnchor.flip}
          style="left:{rackAnchor.x}px; top:{rackAnchor.y}px"
          role="dialog"
          aria-label="机柜数据"
          bind:this={rackPopupEl}
        >
          <header class="popup-head">
            <span
              class="popup-status"
              style="background:{rackPopup.statusColour}"
              aria-hidden="true"
            ></span>
            <span class="popup-name">{rackPopup.name}</span>
            <button
              type="button"
              class="popup-close"
              aria-label="关闭机柜数据"
              title="关闭"
              onclick={closeRackPopup}>✕</button
            >
          </header>

          <!-- 静态模块：机柜描述类数据，拆成网格卡片节约高度（名称已在标题栏） -->
          <div class="static-grid" role="list" aria-label="机柜描述">
            <div
              class="static-card"
              role="listitem"
              title="{rackPopup.heightU}U · {rackPopup.widthIn}″ · {rackPopup.depthMm}mm"
            >
              <span class="s-value">{rackPopup.heightU}U · {rackPopup.widthIn}″</span>
              <span class="s-name">规格</span>
            </div>
            <div class="static-card" role="listitem">
              <span class="s-value">{rackPopup.formFactor}</span>
              <span class="s-name">形态</span>
            </div>
            <div class="static-card" role="listitem">
              <span class="s-value">{rackPopup.deviceCount} 台</span>
              <span class="s-name">设备数</span>
            </div>
            <div class="static-card" role="listitem">
              <span class="s-value">{rackPopup.statusText}</span>
              <span class="s-name">总体状态</span>
            </div>
          </div>

          <!-- 动态模块：全部指标 4×2 网格卡片，突出数值与名称，节约高度空间 -->
          <div class="metric-grid" role="list" aria-label="机柜实时指标">
            {#each rackPopup.metricRows as metric (metric)}
              <div class="metric-card" role="listitem">
                <span class="m-value"
                  >{formatMetric(metric, rackPopup.frame?.metrics[metric])}</span
                >
                <span class="m-name">{METRIC_LABELS[metric]}</span>
              </div>
            {/each}
          </div>

          <div class="popup-link">
            <span class="link-key">柜内设备状态</span>
            <span class="link-val">{rackPopup.summary}</span>
          </div>

          {#if rackPopup.binding}
            {@const rackState = rackPopup.runtime?.state ?? "idle"}
            {@const rackQuality = rackPopup.frame?.quality ?? "bad"}
            <div class="popup-link">
              <span class="link-key">数据源</span>
              <span class="link-val">{ADAPTER_LABELS[rackPopup.binding.adapter]}</span>
            </div>
            <div class="popup-link">
              <span
                class="link-badge"
                class:live={rackState === "live"}
                class:degraded={rackState === "degraded" || rackState === "connecting"}
                class:error={rackState === "error"}
                class:idle={rackState === "idle"}>{LINK_STATE_LABELS[rackState]}</span
              >
              <span
                class="quality-badge"
                class:good={rackQuality === "good"}
                class:stale={rackQuality === "stale"}
                class:bad={rackQuality === "bad"}>{QUALITY_LABELS[rackQuality]}</span
              >
            </div>
          {:else}
            <p class="popup-note">
              该机柜未绑定采集源。切换到右侧「数据」页签按机柜新增绑定后，
              这里会显示柜级实时指标。
            </p>
          {/if}
        </div>
      {/if}

      <!-- 场景元素浮动条：改色 / 删除 -->
      {#if propSelection && propAnchor && view3D.placementMode}
        <div
          class="prop-bar"
          class:below={propAnchor.flip}
          class:dragging={propDragging}
          style="left:{propAnchor.x}px; top:{propAnchor.y}px"
          role="toolbar"
          aria-label="场景元素"
        >
          <span class="prop-name">{PROP_KIND_LABELS[propSelection.kind]}</span>
          <div class="swatches">
            {#each PROP_PALETTE as colour (colour)}
              <button
                type="button"
                class="swatch"
                class:active={propSelection.colour === colour}
                style="background:{colour}"
                aria-label="颜色 {colour}"
                title="修改颜色"
                onclick={() => view3D.setPropColour(propSelection.id, colour)}
              ></button>
            {/each}
          </div>
          <button
            type="button"
            class="prop-delete"
            aria-label="删除元素"
            title="删除"
            onclick={deleteProp}>✕</button
          >
        </div>
      {/if}

      <!-- 摆放模式下的元素面板 -->
      {#if view3D.placementMode}
        <div class="prop-palette" role="toolbar" aria-label="添加场景元素">
          {#each PROP_KINDS as kind (kind)}
            <button
              type="button"
              class="palette-btn"
              class:active={view3D.armedProp === kind}
              aria-pressed={view3D.armedProp === kind}
              title="选中后点击地面即可放置"
              onclick={() =>
                view3D.armProp(view3D.armedProp === kind ? null : kind)}
              >{PROP_KIND_LABELS[kind]}</button
            >
          {/each}
          {#if view3D.props.length > 0}
            <button
              type="button"
              class="palette-btn ghost"
              title="清空全部场景元素"
              onclick={() => {
                view3D.clearProps();
                selectedPropId = null;
              }}>清空</button
            >
          {/if}
        </div>
        <p class="prop-tip">
          {view3D.armedProp
            ? "点击地面放置 · 拖动元素可平移"
            : "先选一个元素类型，再点击地面放置"}
        </p>
      {/if}

      <div class="rack3d-legend">
        {#each STATUS_LEGEND as item (item.status)}
          <span class="legend-item">
            <i
              class="legend-dot"
              style="background:{STATUS_COLOURS[item.status]}"
            ></i>
            {item.label}
          </span>
        {/each}
      </div>
    </div>

    <div class="rack3d-modes" role="group" aria-label="渲染模式">
      {#each RENDER_MODES as item (item.mode)}
        <button
          type="button"
          class="mode-btn"
          class:active={view3D.renderMode === item.mode}
          aria-pressed={view3D.renderMode === item.mode}
          title={item.hint}
          onclick={() => setRenderMode(item.mode)}>{item.label}</button
        >
      {/each}
    </div>

    <footer class="rack3d-foot">
      <button type="button" class="foot-btn" onclick={handleReset}
        >重置视角</button
      >
      <button
        type="button"
        class="foot-btn"
        class:active={view3D.showSidePanels}
        onclick={() => view3D.setShowSidePanels(!view3D.showSidePanels)}
        >侧板</button
      >
      <button
        type="button"
        class="foot-btn"
        class:active={view3D.driveByTelemetry}
        onclick={() =>
          view3D.setDriveByTelemetry(!view3D.driveByTelemetry)}>遥测着色</button
      >
      <button type="button" class="foot-btn" onclick={handleScreenshot}
        >导出图片</button
      >
    </footer>
  </aside>
{/if}

<style>
  /* 悬浮在 2D 画布右侧，与左侧画布并存（企划 M1：2D 配置体验不降级） */
  .rack3d-panel {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    bottom: var(--space-3);
    width: clamp(320px, 38%, 620px);
    display: flex;
    flex-direction: column;
    /* 边框与按钮统一走设计系统色，不再使用告警红 */
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-md);
    background: var(--drawer-bg, #14161c);
    box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.45));
    overflow: hidden;
    z-index: calc(var(--z-toolbar, 10) + 2);
  }

  .rack3d-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--colour-border);
    flex-shrink: 0;
  }

  .rack3d-title {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
    letter-spacing: 0.02em;
  }

  .rack3d-close {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--colour-text-muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .rack3d-close:hover {
    background: var(--colour-surface-hover);
    color: var(--colour-text);
  }

  .rack3d-close:focus-visible {
    outline: 2px solid var(--colour-selection);
    outline-offset: 2px;
  }

  /* ---------------- 相机 / 视角工具条 ---------------- */
  .rack3d-tools {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-2) 0;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .tool-seg {
    display: flex;
    flex-shrink: 0;
  }

  .seg-btn {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--colour-border);
    background: var(--button-bg);
    color: var(--colour-text-muted);
    font-size: var(--font-size-sm);
    line-height: 1.4;
    cursor: pointer;
    margin-left: -1px;
  }

  .seg-btn:first-child {
    margin-left: 0;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }

  .seg-btn:last-child {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .seg-btn:hover:not(.active) {
    background: var(--button-bg-hover);
    color: var(--colour-text);
  }

  .seg-btn.active {
    background: color-mix(in srgb, var(--colour-selection) 22%, transparent);
    border-color: var(--colour-selection);
    color: var(--colour-text);
    z-index: 1;
  }

  .view-select {
    flex: 1 1 96px;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-sm);
    background: var(--button-bg);
    color: var(--colour-text);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .tool-btn {
    flex-shrink: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-sm);
    background: var(--button-bg);
    color: var(--colour-text-muted);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .tool-btn:hover {
    background: var(--button-bg-hover);
    color: var(--colour-text);
  }

  .tool-btn.active {
    border-color: var(--colour-selection);
    color: var(--colour-text);
    background: color-mix(in srgb, var(--colour-selection) 22%, transparent);
  }

  .rack3d-viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    margin-top: var(--space-2);
    background: #191a21;
    /* 兜底：任何浮层都不许溢出到面板标题栏 / 渲染模式 / 底部按钮上 */
    overflow: hidden;
  }

  /* 亮色场景：视口底色与浮层同步提亮，否则白底上压深色浮层会脏且糊 */
  .rack3d-viewport.scene-light {
    background: #e9e9e9;
  }

  .rack3d-viewport.scene-light .prop-palette {
    background: rgba(255, 255, 255, 0.88);
    border-color: rgba(0, 0, 0, 0.14);
  }

  .rack3d-viewport.scene-light .prop-tip {
    background: rgba(255, 255, 255, 0.86);
    color: #3a4250;
  }

  .rack3d-viewport.scene-light .rack3d-legend {
    background: rgba(255, 255, 255, 0.8);
    border-color: rgba(0, 0, 0, 0.12);
  }

  .rack3d-viewport.scene-light .legend-item {
    color: #3a4250;
  }

  .rack3d-viewport canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .rack3d-hint,
  .rack3d-error {
    position: absolute;
    inset: auto 0 40%;
    text-align: center;
    padding: 0 var(--space-4);
    color: var(--colour-text-muted);
    font-size: var(--font-size-sm);
    line-height: 1.6;
    pointer-events: none;
  }

  .rack3d-error {
    color: var(--colour-error, #e05252);
  }

  /* ---------------- 三维内的二维设备数据卡片 ---------------- */
  .device-popup {
    position: absolute;
    /* 锚点是设备顶部前缘，卡片浮在其上方 */
    transform: translate(-50%, calc(-100% - 14px));
    width: 248px;
    max-width: calc(100% - 16px);
    /* 指标行数随绑定变化，卡片可能比视口还高 → 限高并内部滚动，
       配合引擎侧的实测尺寸夹取，双重保证不溢出 */
    max-height: calc(100% - 16px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-2) var(--space-3) var(--space-3);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-md);
    /* 背景板 80% 透明 + 背景模糊：浮在 3D 场景上不挡视线，靠 blur 保证可读性 */
    background: color-mix(in srgb, var(--drawer-bg, #21222c) 80%, transparent);
    box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.5));
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    z-index: 3;
    pointer-events: auto;
  }

  /* 机柜弹窗：4×2 指标卡片需要更宽的水平空间 */
  .device-popup.wide {
    width: 320px;
  }

  /* 静态描述网格：2×2 卡片，代替逐行罗列以节约高度 */
  .static-grid {
    margin-top: var(--space-2);
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
  }

  .static-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    min-width: 0;
    padding: 5px 6px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--colour-text, #fff) 6%, transparent);
  }

  .static-card .s-value {
    font-size: 12px;
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .static-card .s-name {
    font-size: 10px;
    color: var(--colour-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 动态指标网格：突出数值 + 名称，代替逐行罗列以节约高度 */
  .metric-grid {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--colour-border);
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }

  .metric-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    min-width: 0;
    padding: 5px 4px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--colour-text, #fff) 6%, transparent);
  }

  .metric-card .m-value {
    font-size: 12px;
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metric-card .m-name {
    font-size: 10px;
    color: var(--colour-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 顶部空间不足时由锚点翻转：卡片改挂在设备下方 */
  .device-popup.below {
    transform: translate(-50%, 14px);
  }

  .popup-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .popup-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .popup-name {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .popup-close {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--colour-text-muted);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }

  .popup-close:hover {
    background: var(--colour-surface-hover);
    color: var(--colour-text);
  }

  .popup-block {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--colour-border);
  }

  .block-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: 12px;
    margin-bottom: 5px;
  }

  .block-label {
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
  }

  .block-value {
    color: var(--colour-text);
    font-variant-numeric: tabular-nums;
  }

  .bar-track {
    height: 8px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--colour-border) 70%, transparent);
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--spark-colour, #3ddc84);
    transition: width 320ms var(--ease-out, ease-out);
  }

  .spark {
    display: block;
    width: 100%;
    height: 44px;
  }

  .chart-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-size: 10px;
    color: var(--colour-text-muted);
  }

  .popup-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: var(--space-2);
    font-size: 11px;
  }

  .link-key {
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
  }

  .link-val {
    color: var(--colour-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-badge,
  .quality-badge {
    padding: 1px 6px;
    border-radius: var(--radius-full);
    font-size: 10px;
    border: 1px solid var(--colour-border);
    color: var(--colour-text-muted);
    background: transparent;
  }

  .link-badge.live {
    color: #3ddc84;
    border-color: color-mix(in srgb, #3ddc84 45%, transparent);
  }

  .link-badge.degraded {
    color: #e0b341;
    border-color: color-mix(in srgb, #e0b341 45%, transparent);
  }

  .link-badge.error {
    color: #e05252;
    border-color: color-mix(in srgb, #e05252 45%, transparent);
  }

  .quality-badge.good {
    color: #3ddc84;
  }

  .quality-badge.stale {
    color: #e0b341;
  }

  .quality-badge.bad {
    color: #e05252;
  }

  .popup-note {
    margin: var(--space-2) 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--colour-text-muted);
  }

  /* ---------------- 场景元素浮动条 ---------------- */
  .prop-bar {
    position: absolute;
    /* 与模型保持更大间距，避免俯视/浅角下浮动条压住光标导致无法落位 */
    transform: translate(-50%, calc(-100% - 18px));
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--drawer-bg, #21222c) 92%, #000 8%);
    box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.5));
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 4;
    pointer-events: auto;
  }

  .prop-bar.below {
    transform: translate(-50%, 18px);
  }

  /* 拖动元素时浮动条不拦截指针事件：保证 pointerup 落到画布，
     从而正常结束拖动（松手落位），不会被浮动条"吃掉"鼠标事件 */
  .prop-bar.dragging {
    pointer-events: none;
  }

  .prop-name {
    font-size: 11px;
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
    white-space: nowrap;
  }

  .swatches {
    display: flex;
    gap: 4px;
  }

  .swatch {
    width: 14px;
    height: 14px;
    padding: 0;
    border: 1px solid var(--colour-border);
    border-radius: 50%;
    cursor: pointer;
  }

  .swatch.active {
    outline: 2px solid var(--colour-text);
    outline-offset: 1px;
  }

  .prop-delete {
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--colour-text-muted);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
  }

  .prop-delete:hover {
    background: var(--colour-surface-hover);
    color: var(--colour-text);
  }

  /* ---------------- 元素面板 ---------------- */
  /* 底部同时有「图例（左下）」与「元素面板（居中）」两层，
     必须错开高度，否则窄面板下会横向撞在一起。提示语改挂到顶部。 */
  .prop-palette {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 34px;
    display: flex;
    gap: var(--space-1);
    padding: 4px;
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-full);
    background: rgba(20, 22, 28, 0.86);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 3;
  }

  .palette-btn {
    padding: 3px var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--colour-text-muted);
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }

  .palette-btn:hover {
    color: var(--colour-text);
    background: var(--colour-surface-hover);
  }

  .palette-btn.active {
    border-color: var(--colour-selection);
    color: var(--colour-text);
    background: color-mix(in srgb, var(--colour-selection) 22%, transparent);
  }

  .palette-btn.ghost {
    color: #e05252;
  }

  .prop-tip {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: var(--space-2);
    margin: 0;
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    background: rgba(20, 22, 28, 0.8);
    font-size: 10px;
    color: var(--colour-text-muted);
    pointer-events: none;
    white-space: nowrap;
    z-index: 2;
  }

  /* ---------------- 图例与工具条 ---------------- */
  .rack3d-legend {
    position: absolute;
    left: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 4px var(--space-2);
    border-radius: var(--radius-full);
    background: rgba(20, 22, 28, 0.72);
    border: 1px solid var(--colour-border);
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--colour-text-muted);
  }

  .legend-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .rack3d-modes {
    display: flex;
    gap: 0;
    padding: var(--space-2) var(--space-2) 0;
    flex-shrink: 0;
  }

  .mode-btn {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--colour-border);
    background: var(--button-bg);
    color: var(--colour-text-muted);
    font-size: var(--font-size-sm);
    cursor: pointer;
    /* 相邻边框合并，读成一个连接式分段控件 */
    margin-left: -1px;
  }

  .mode-btn:first-child {
    margin-left: 0;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }

  .mode-btn:last-child {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .mode-btn:hover:not(.active) {
    background: var(--button-bg-hover);
    color: var(--colour-text);
  }

  .mode-btn.active {
    background: color-mix(in srgb, var(--colour-selection) 22%, transparent);
    border-color: var(--colour-selection);
    color: var(--colour-text);
    z-index: 1;
  }

  .mode-btn:focus-visible {
    outline: 2px solid var(--colour-selection);
    outline-offset: 2px;
    z-index: 2;
  }

  .rack3d-foot {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2);
    border-top: 1px solid var(--colour-border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .foot-btn {
    flex: 1;
    min-width: 64px;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-sm);
    background: var(--button-bg);
    color: var(--colour-text);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .foot-btn:hover {
    background: var(--button-bg-hover);
  }

  .foot-btn.active {
    border-color: var(--colour-selection);
    color: var(--colour-text);
    background: color-mix(in srgb, var(--colour-selection) 22%, transparent);
  }

  @media (max-width: 1023px) {
    .rack3d-panel {
      width: min(92%, 460px);
    }
  }
</style>
