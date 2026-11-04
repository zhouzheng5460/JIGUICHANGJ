<!--
  TelemetryPanel Component  ——  Rack3D 扩展（非 Rackula 上游代码）

  右侧属性面板的第三个页签「实时数据映射」。系统始终满足的约束（EARS 风格）：
  - The panel shall 展示每条绑定的链路状态、最后更新时间和当前指标值。
  - When 用户新增一条绑定, the panel shall 立即按该绑定的轮询间隔开始采集。
  - If 采集连续失败, then the panel shall 保留最后一帧并标记为「数据陈旧/链路异常」，
    绝不静默显示假数据。
  - While 采集处于运行状态, the panel shall 每帧刷新指标值而不重排布局。
  - Where 绑定尚未配置数据源, the panel shall 显示明确空态而不是空白表格。
-->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getLayoutStore } from "$lib/stores/layout.svelte";
  import { getSelectionStore } from "$lib/stores/selection.svelte";
  import { getTelemetryStore } from "$lib/telemetry/store.svelte";
  import {
    ADAPTER_LABELS,
    ALL_METRICS,
    DEFAULT_POLL_MS,
    LINK_STATE_LABELS,
    METRIC_LABELS,
    METRIC_UNITS,
    QUALITY_LABELS,
    type AdapterType,
    type MetricKey,
    type TelemetryBinding,
  } from "$lib/telemetry/types";

  const layoutStore = getLayoutStore();
  const telemetry = getTelemetryStore();
  const selection = getSelectionStore();

  interface AssetOption {
    key: string;
    id: string;
    kind: "rack" | "device";
    label: string;
    hint: string;
  }

  // --- 采集源配置（全局，作用于后续新增的绑定） ---
  let adapter = $state<AdapterType>("mock");
  let endpoint = $state("http://localhost:8787/api/devices");
  let pollMs = $state(DEFAULT_POLL_MS);

  // --- 新增绑定表单 ---
  let selectedAssetKey = $state("");
  let assetIdOverride = $state("");
  let draftMetrics = $state<MetricKey[]>(["power_w", "temp_c", "status", "on_off"]);
  let formError = $state<string | null>(null);

  const assetOptions = $derived.by((): AssetOption[] => {
    const options: AssetOption[] = [];
    for (const rack of layoutStore.racks) {
      options.push({
        key: `rack:${rack.id}`,
        id: rack.id,
        kind: "rack",
        label: rack.name,
        hint: `${rack.height}U · ${rack.devices.length} 台设备`,
      });
      for (const placed of rack.devices) {
        const deviceType = layoutStore.device_types.find(
          (d) => d.slug === placed.device_type,
        );
        const name =
          placed.name ??
          placed.label ??
          deviceType?.model ??
          deviceType?.name ??
          placed.device_type;
        options.push({
          key: `device:${placed.id}`,
          id: placed.id,
          kind: "device",
          label: name,
          hint: `位于 ${rack.name}`,
        });
      }
    }
    return options;
  });

  const selectedAsset = $derived(
    assetOptions.find((option) => option.key === selectedAssetKey) ?? null,
  );

  // 与画布选中设备联动：在 3D / 2D 画布中点选机柜或设备时，自动把它设为
  // 新增绑定的目标资产。设备优先于机柜（选中设备时 selectedRackId 也会带上）。
  $effect(() => {
    const key = selection.selectedDeviceId
      ? `device:${selection.selectedDeviceId}`
      : selection.selectedRackId
        ? `rack:${selection.selectedRackId}`
        : null;
    if (key && assetOptions.some((o) => o.key === key)) {
      selectedAssetKey = key;
    }
  });

  const linkedFromCanvas = $derived(
    !!selectedAssetKey &&
      ((!!selection.selectedDeviceId &&
        selectedAssetKey === `device:${selection.selectedDeviceId}`) ||
        (!!selection.selectedRackId &&
          selectedAssetKey === `rack:${selection.selectedRackId}`)),
  );

  // ---------------------------------------------------------------- 已绑定资产分组
  /** 设备 id → 所属机柜 id（用于在机柜下二级归类） */
  const deviceRackMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const rack of layoutStore.racks) {
      for (const d of rack.devices) map.set(d.id, rack.id);
    }
    return map;
  });

  /** 机柜 id → 机柜名 */
  const rackNameMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const rack of layoutStore.racks) map.set(rack.id, rack.name);
    return map;
  });

  /** 当前布局包含的资产 id 集合（机柜 + 设备），用于把数据页限定在当前布局 */
  const currentLayoutAssetIds = $derived.by(() => {
    const s = new Set<string>();
    for (const rack of layoutStore.racks) {
      s.add(rack.id);
      for (const d of rack.devices) s.add(d.id);
    }
    return s;
  });

  /** 仅属于当前布局的绑定（已绑定数据列表 / 计数 / 重复校验都基于此） */
  const currentLayoutBindings = $derived.by(() => {
    if (currentLayoutAssetIds.size === 0) return [] as TelemetryBinding[];
    return telemetry.bindings.filter((b) => currentLayoutAssetIds.has(b.asset_id));
  });

  /** 已绑定资产按机柜一级归类、机柜内设备二级归类 */
  const bindingGroups = $derived.by(() => {
    const groups = new Map<
      string,
      { rackId: string; rackName: string; bindings: TelemetryBinding[] }
    >();
    const ensure = (rackId: string, rackName: string) => {
      let g = groups.get(rackId);
      if (!g) {
        g = { rackId, rackName, bindings: [] };
        groups.set(rackId, g);
      }
      return g;
    };
    for (const b of currentLayoutBindings) {
      if (b.asset_kind === "rack") {
        ensure(b.asset_id, rackNameMap.get(b.asset_id) ?? b.label);
        groups.get(b.asset_id)!.bindings.push(b);
      } else {
        const rackId = deviceRackMap.get(b.asset_id) ?? "__ungrouped__";
        const rackName =
          rackId === "__ungrouped__"
            ? "未归类设备"
            : (rackNameMap.get(rackId) ?? "未知机柜");
        ensure(rackId, rackName).bindings.push(b);
      }
    }
    return [...groups.values()].sort((a, b) =>
      a.rackName.localeCompare(b.rackName, "zh-Hans-CN"),
    );
  });

  /** 选中设备/机柜时，交互式过滤已绑定资产；「显示全部」可临时关闭过滤 */
  let showAllBindings = $state(false);
  $effect(() => {
    void selection.selectedDeviceId;
    void selection.selectedRackId;
    showAllBindings = false;
  });

  const selectedDeviceLabel = $derived.by(() => {
    if (!selection.selectedDeviceId) return "";
    const b = currentLayoutBindings.find(
      (x) => x.asset_kind === "device" && x.asset_id === selection.selectedDeviceId,
    );
    if (b) return b.label;
    for (const rack of layoutStore.racks) {
      const d = rack.devices.find((dev) => dev.id === selection.selectedDeviceId);
      if (d) return d.name ?? d.id;
    }
    return selection.selectedDeviceId;
  });

  const visibleGroups = $derived.by(() => {
    if (showAllBindings) return bindingGroups;
    if (selection.selectedDeviceId) {
      return bindingGroups
        .filter((g) =>
          g.bindings.some(
            (b) => b.asset_kind === "device" && b.asset_id === selection.selectedDeviceId,
          ),
        )
        .map((g) => ({
          ...g,
          bindings: g.bindings.filter(
            (b) => b.asset_kind === "device" && b.asset_id === selection.selectedDeviceId,
          ),
        }));
    }
    if (selection.selectedRackId) {
      const g = bindingGroups.find((x) => x.rackId === selection.selectedRackId);
      return g ? [g] : [];
    }
    return bindingGroups;
  });

  // 采集运行状态
  onMount(() => {
    telemetry.startAll();
  });

  onDestroy(() => {
    telemetry.stopAll();
  });

  function toggleMetric(metric: MetricKey): void {
    draftMetrics = draftMetrics.includes(metric)
      ? draftMetrics.filter((m) => m !== metric)
      : [...draftMetrics, metric];
  }

  function resetForm(): void {
    selectedAssetKey = "";
    assetIdOverride = "";
    formError = null;
  }

  function handleAddBinding(): void {
    if (!selectedAsset) {
      formError = "请先选择要绑定的机柜或设备。";
      return;
    }
    const assetId = assetIdOverride.trim() || selectedAsset.id;
    if (currentLayoutBindings.some((b) => b.asset_id === assetId)) {
      formError = "该资产的采集点位已存在。";
      return;
    }
    if (draftMetrics.length === 0) {
      formError = "至少选择一个要展示的指标。";
      return;
    }
    if (adapter === "rest" && !endpoint.trim()) {
      formError = "REST 适配器需要填写采集端点地址。";
      return;
    }

    const binding: TelemetryBinding = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `tb-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      asset_kind: selectedAsset.kind,
      asset_id: assetId,
      label: selectedAsset.label,
      adapter,
      endpoint: adapter === "mock" ? "本地模拟器" : endpoint.trim(),
      metrics: [...draftMetrics],
      point_map: {},
      poll_ms: pollMs,
    };

    telemetry.addBinding(binding);
    resetForm();
  }

  function formatTimestamp(ts: number | null): string {
    if (!ts) return "—";
    const delta = Date.now() - ts;
    if (delta < 1500) return "刚刚";
    if (delta < 60_000) return `${Math.round(delta / 1000)} 秒前`;
    if (delta < 3_600_000) return `${Math.round(delta / 60_000)} 分钟前`;
    return new Date(ts).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatMetric(metric: MetricKey, value: unknown): string {
    if (value === undefined || value === null || value === "") return "—";
    if (metric === "on_off") return value ? "开" : "关";
    if (metric === "status") {
      const text = String(value).toLowerCase();
      if (["online", "up", "ok", "normal"].includes(text)) return "在线";
      if (["offline", "down", "fail", "fault"].includes(text)) return "离线";
      return String(value);
    }
    if (typeof value === "number") {
      const unit = METRIC_UNITS[metric];
      return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`;
    }
    return String(value);
  }

  function runtimeFor(bindingId: string) {
    return telemetry.runtimes[bindingId] ?? null;
  }

  function frameFor(assetId: string) {
    return telemetry.getFrame(assetId);
  }
</script>

<div class="telemetry-panel">
  <!-- 链路总览（折叠，降低版面占用） -->
  <details class="block collapsible">
    <summary class="collapsible-summary">
      <span class="collapsible-title">链路状态</span>
      <span class="collapsible-right">
        <span
          class="state-badge"
          class:state-live={telemetry.overallState === "live"}
          class:state-degraded={telemetry.overallState === "degraded"}
          class:state-connecting={telemetry.overallState === "connecting"}
          class:state-error={telemetry.overallState === "error"}
          class:state-idle={telemetry.overallState === "idle"}
        >
          {LINK_STATE_LABELS[telemetry.overallState]}
        </span>
        <span class="caret"></span>
      </span>
    </summary>
    <div class="collapsible-body">
      <div class="row-actions">
        <button
          type="button"
          class="btn-secondary"
          onclick={() => telemetry.startAll()}
          disabled={telemetry.started}>启动采集</button
        >
        <button
          type="button"
          class="btn-secondary"
          onclick={() => telemetry.stopAll()}
          disabled={!telemetry.started}>停止采集</button
        >
        <span class="meta-text">{currentLayoutBindings.length} 条绑定</span>
      </div>
    </div>
  </details>

  <!-- 采集源（折叠） -->
  <details class="block collapsible">
    <summary class="collapsible-summary">
      <span class="collapsible-title">采集源</span>
      <span class="caret"></span>
    </summary>
    <div class="collapsible-body">
      <div class="field">
        <label for="telem-adapter">适配器类型</label>
        <select id="telem-adapter" class="input-field" bind:value={adapter}>
          {#each Object.entries(ADAPTER_LABELS) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label for="telem-endpoint">采集端点</label>
        <input
          id="telem-endpoint"
          type="text"
          class="input-field"
          bind:value={endpoint}
          disabled={adapter === "mock"}
          placeholder="http://host:port/api/devices"
        />
        <p class="helper-text">
          {adapter === "mock"
            ? "本地模拟器无需端点，直接生成演示数据。"
            : "期望返回 JSON：{ id, name, status, power, on/off } 或其数组。"}
        </p>
      </div>

      <div class="field">
        <label for="telem-poll">轮询间隔（毫秒）</label>
        <input
          id="telem-poll"
          type="number"
          class="input-field"
          bind:value={pollMs}
          min="500"
          step="500"
        />
      </div>
    </div>
  </details>

  <!-- 新增绑定 -->
  <section class="block">
    <h3 class="block-title">新增数据绑定</h3>

    <div class="field">
      <label for="telem-asset">目标资产</label>
      <select id="telem-asset" class="input-field" bind:value={selectedAssetKey}>
        <option value="">请选择机柜或设备…</option>
        {#each assetOptions as option (option.key)}
          <option value={option.key}>
            {option.kind === "rack" ? "机柜" : "设备"} · {option.label}（{option.hint}）
          </option>
        {/each}
      </select>
      {#if linkedFromCanvas}
        <p class="helper-text linked-hint">
          已与画布中选中的{selection.selectedDeviceId ? "设备" : "机柜"}联动，可直接新增绑定。
        </p>
      {/if}
    </div>

    <div class="field">
      <label for="telem-asset-id">采集平台资产 ID</label>
      <input
        id="telem-asset-id"
        type="text"
        class="input-field"
        bind:value={assetIdOverride}
        placeholder={selectedAsset ? selectedAsset.id : "默认使用本地资产 ID"}
      />
      <p class="helper-text">
        留空则直接使用本地 ID；填写后按采集平台侧的 ID 匹配遥测帧。
      </p>
    </div>

    <div class="field">
      <span class="field-label">展示指标</span>
      <div class="metric-grid">
        {#each ALL_METRICS as metric (metric)}
          <label class="metric-chip" class:active={draftMetrics.includes(metric)}>
            <input
              type="checkbox"
              checked={draftMetrics.includes(metric)}
              onchange={() => toggleMetric(metric)}
            />
            {METRIC_LABELS[metric]}
          </label>
        {/each}
      </div>
    </div>

    {#if formError}
      <p class="helper-text error">{formError}</p>
    {/if}

    <button type="button" class="btn-primary" onclick={handleAddBinding}>
      新增绑定
    </button>
  </section>

  <!-- 绑定列表 -->
  <section class="block">
    <h3 class="block-title">已绑定资产</h3>

    {#if currentLayoutBindings.length === 0}
      <p class="empty-state">
        还没有任何数据绑定。选择一台设备或一个机柜，为它绑定采集点位后，3D
        机柜视图会用实时数据驱动指示灯与状态颜色。
      </p>
    {:else}
      {#if (selection.selectedDeviceId || selection.selectedRackId) && !showAllBindings}
        <p class="helper-text linked-hint">
          已按画布选中的{selection.selectedDeviceId
            ? `设备「${selectedDeviceLabel}」`
            : "机柜"}过滤已绑定资产。
          <button
            type="button"
            class="link-btn"
            onclick={() => (showAllBindings = true)}>显示全部</button
          >
        </p>
      {/if}

      {#each visibleGroups as group (group.rackId)}
        <details class="rack-group collapsible" open>
          <summary class="rack-group-summary">
            <span class="rack-group-name">{group.rackName}</span>
            <span class="collapsible-right">
              <span class="rack-group-count">{group.bindings.length}</span>
              <span class="caret"></span>
            </span>
          </summary>

          <div class="rack-group-body">
            {#each group.bindings as binding (binding.id)}
              {@const runtime = runtimeFor(binding.id)}
              {@const frame = frameFor(binding.asset_id)}
              <details class="binding-card collapsible-binding">
                <summary class="binding-summary">
                  <span class="binding-kind">
                    {binding.asset_kind === "rack" ? "机柜" : "设备"}
                  </span>
                  <span class="binding-name">{binding.label}</span>
                  {#if frame}
                    {@const quickMetric = binding.metrics[0]}
                    {#if quickMetric !== undefined}
                      <span class="binding-quick"
                        >{formatMetric(quickMetric, frame.metrics[quickMetric])}</span
                      >
                    {/if}
                  {/if}
                  <span
                    class="state-dot"
                    class:state-live={runtime?.state === "live"}
                    class:state-degraded={runtime?.state === "degraded"}
                    class:state-connecting={runtime?.state === "connecting"}
                    class:state-error={runtime?.state === "error"}
                    title={LINK_STATE_LABELS[runtime?.state ?? "idle"]}
                  ></span>
                </summary>

                <div class="binding-body">
                  <div class="binding-meta">
                    <span>{ADAPTER_LABELS[binding.adapter]}</span>
                    <span class="dot-sep">·</span>
                    <span class="truncate" title={binding.endpoint}
                      >{binding.endpoint}</span
                    >
                  </div>

                  <div class="binding-meta">
                    <span>ID：{binding.asset_id}</span>
                    <span class="dot-sep">·</span>
                    <span>更新：{formatTimestamp(runtime?.lastFrameTs ?? null)}</span>
                    {#if frame}
                      <span class="dot-sep">·</span>
                      <span
                        class="quality"
                        class:quality-good={frame.quality === "good"}
                        class:quality-stale={frame.quality === "stale"}
                        class:quality-bad={frame.quality === "bad"}
                        >{QUALITY_LABELS[frame.quality]}</span
                      >
                    {/if}
                  </div>

                  {#if runtime?.error}
                    <p class="helper-text error">链路提示：{runtime.error}</p>
                  {/if}

                  {#if frame}
                    <div class="metric-table">
                      {#each binding.metrics as metric (metric)}
                        <div class="metric-cell">
                          <span class="metric-label">{METRIC_LABELS[metric]}</span>
                          <span class="metric-value">
                            {formatMetric(metric, frame.metrics[metric])}
                          </span>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <p class="helper-text">等待第一帧数据…</p>
                  {/if}

                  <div class="binding-actions">
                    <button
                      type="button"
                      class="btn-danger-text"
                      onclick={() => telemetry.removeBinding(binding.id)}
                      >删除绑定</button
                    >
                  </div>
                </div>
              </details>
            {/each}
          </div>
        </details>
      {/each}
    {/if}
  </section>
</div>

<style>
  .telemetry-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-md);
    background: var(--colour-surface-secondary, transparent);
  }

  .block-title {
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .field label,
  .field-label {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    color: var(--colour-text);
  }

  .input-field {
    padding: var(--space-2) var(--space-3);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-sm);
    color: var(--colour-text);
    font-size: var(--font-size-base);
    width: 100%;
    box-sizing: border-box;
  }

  .input-field:focus {
    outline: none;
    border-color: var(--colour-selection);
  }

  .helper-text {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--colour-text-muted);
    line-height: 1.5;
  }

  .helper-text.error {
    color: var(--colour-error);
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .meta-text {
    font-size: var(--font-size-sm);
    color: var(--colour-text-muted);
  }

  .btn-secondary,
  .btn-primary {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    cursor: pointer;
    border: 1px solid var(--colour-border);
    background: var(--button-bg);
    color: var(--colour-text);
  }

  .btn-secondary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--colour-selection);
    border-color: var(--colour-selection);
    color: var(--colour-text-inverse);
    font-weight: var(--font-weight-medium);
  }

  .btn-danger-text {
    padding: 0;
    background: none;
    border: none;
    color: var(--colour-error);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .state-badge {
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--font-size-xs, 11px);
    border: 1px solid var(--colour-border);
    color: var(--colour-text);
  }

  .state-live {
    color: #3ddc84;
    border-color: #3ddc84;
  }

  .state-degraded,
  .state-connecting {
    color: #e0b341;
    border-color: #e0b341;
  }

  .state-error {
    color: var(--colour-error);
    border-color: var(--colour-error);
  }

  .state-idle {
    color: var(--colour-text-muted);
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
  }

  .metric-chip {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs, 11px);
    color: var(--colour-text-muted);
    cursor: pointer;
  }

  .metric-chip.active {
    border-color: var(--colour-selection);
    color: var(--colour-text);
    background: color-mix(in srgb, var(--colour-selection) 16%, transparent);
  }

  .metric-chip input {
    margin: 0;
  }

  /* ---- 折叠区块（采集源 / 链路状态 / 已绑定资产行） ---- */
  .collapsible {
    cursor: default;
  }

  .collapsible-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    cursor: pointer;
    list-style: none;
  }

  .collapsible-summary::-webkit-details-marker {
    display: none;
  }

  .collapsible-title {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
  }

  .collapsible-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .caret {
    width: 7px;
    height: 7px;
    border-right: 2px solid var(--colour-text-muted);
    border-bottom: 2px solid var(--colour-text-muted);
    transform: rotate(45deg);
    transition: transform 150ms ease;
    flex-shrink: 0;
  }

  .collapsible[open] > .collapsible-summary .caret {
    transform: rotate(-135deg);
  }

  .collapsible-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .linked-hint {
    color: var(--colour-selection);
  }

  /* 已绑定资产：按机柜一级分组（L1=机柜，L2=机柜内设备） */
  .rack-group {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-md);
    background: var(--colour-surface-secondary, transparent);
    overflow: hidden;
  }

  .rack-group-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    list-style: none;
    background: color-mix(in srgb, var(--colour-text) 6%, transparent);
  }

  .rack-group-summary::-webkit-details-marker {
    display: none;
  }

  .rack-group-name {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text);
  }

  .rack-group-count {
    font-size: 11px;
    font-weight: var(--font-weight-semibold);
    color: var(--colour-text-muted);
    background: color-mix(in srgb, var(--colour-text) 10%, transparent);
    border-radius: var(--radius-full);
    padding: 1px 8px;
    flex-shrink: 0;
  }

  .rack-group[open] > .rack-group-summary .caret {
    transform: rotate(-135deg);
  }

  .rack-group-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--colour-selection);
    font-size: inherit;
    cursor: pointer;
    padding: 0 0 0 4px;
    text-decoration: underline;
  }

  .binding-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-md);
    background: var(--input-bg);
  }

  /* 已绑定资产：折叠行，收起时只占一行，展开才显示明细 */
  .collapsible-binding {
    padding: 0;
  }

  .binding-summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    cursor: pointer;
    list-style: none;
  }

  .binding-summary::-webkit-details-marker {
    display: none;
  }

  .binding-quick {
    margin-left: auto;
    font-size: var(--font-size-xs, 11px);
    font-weight: var(--font-weight-medium);
    color: var(--colour-text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .binding-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-3);
  }

  .binding-kind {
    font-size: var(--font-size-xs, 11px);
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid var(--colour-border);
    color: var(--colour-text-muted);
    flex-shrink: 0;
  }

  .binding-name {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    color: var(--colour-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .state-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--colour-text-muted);
  }

  .state-dot.state-live {
    background: #3ddc84;
  }

  .state-dot.state-degraded,
  .state-dot.state-connecting {
    background: #e0b341;
  }

  .state-dot.state-error {
    background: var(--colour-error);
  }

  .binding-meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-xs, 11px);
    color: var(--colour-text-muted);
    flex-wrap: wrap;
  }

  .dot-sep {
    opacity: 0.5;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14ch;
  }

  .quality-good {
    color: #3ddc84;
  }

  .quality-stale {
    color: #e0b341;
  }

  .quality-bad {
    color: var(--colour-error);
  }

  .metric-table {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
  }

  .metric-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--colour-surface-secondary, transparent) 60%, transparent);
    border: 1px solid var(--colour-border);
  }

  .metric-label {
    font-size: var(--font-size-xs, 11px);
    color: var(--colour-text-muted);
  }

  .metric-value {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
    color: var(--colour-text);
    font-variant-numeric: tabular-nums;
  }

  .binding-actions {
    display: flex;
    justify-content: flex-end;
  }

  .empty-state {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: var(--colour-text-muted);
  }
</style>
