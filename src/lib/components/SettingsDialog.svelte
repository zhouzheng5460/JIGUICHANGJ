<!--
  SettingsDialog Component
  Sectioned settings surface (Appearance, Behaviour, Data) on the unified
  Dialog primitive. Single canonical home for app preferences; reads and
  writes the UI store directly, so settings persist exactly as before.
-->
<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import Switch from "./Switch.svelte";
  import Button from "./ui/Button.svelte";
  import LogoLockup from "./LogoLockup.svelte";
  import { IconTrash, IconUndo } from "./icons";
  import { ICON_SIZE } from "$lib/constants/sizing";
  import { getUIStore } from "$lib/stores/ui.svelte";
  import type { AppTheme } from "$lib/stores/ui.svelte";
  import { getLayoutStore } from "$lib/stores/layout.svelte";

  interface Props {
    open: boolean;
    onclose?: () => void;
    /** Open the cleanup checklist dialog (handled by DialogOrchestrator). */
    onopencleanup?: () => void;
  }

  let { open, onclose, onopencleanup }: Props = $props();

  const uiStore = getUIStore();
  const layoutStore = getLayoutStore();

  let unusedCount = $derived(
    open ? layoutStore.getUnusedCustomDeviceTypes().length : 0,
  );
  let promptDismissed = $derived(!uiStore.promptCleanupOnSave);

  function handleCleanup() {
    onopencleanup?.();
  }

  function handleResetPrompts() {
    uiStore.setPromptCleanupOnSave(true);
  }

  // ---- Rack3D 扩展：界面配色方案（Settings > Appearance） ----
  // swatch 三色 = 该主题的 背景 / 主强调 / 次强调，供色板按钮预览。
  const APP_THEMES: {
    id: AppTheme;
    label: string;
    swatch: [string, string, string];
  }[] = [
    {
      id: "dracula",
      label: "Dracula Purple",
      swatch: ["#282a36", "#bd93f9", "#ff79c6"],
    },
    {
      id: "ocean",
      label: "Ocean Blue",
      swatch: ["#111b2e", "#38bdf8", "#7dd3fc"],
    },
    {
      id: "forest",
      label: "Forest Green",
      swatch: ["#13241b", "#34d399", "#6ee7b7"],
    },
    {
      id: "sunset",
      label: "Sunset Orange",
      swatch: ["#2a1c10", "#fb923c", "#fbbf24"],
    },
    {
      id: "mist",
      label: "Morning Mist",
      swatch: ["#f2f4f8", "#db2777", "#7c3aed"],
    },
  ];

  // ---- Rack3D 扩展：LOGO 替换（上传 SVG） ----
  let logoFileInput: HTMLInputElement | null = null;

  function handleLogoFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        // store 侧会做轻量消毒；非法（非 SVG）会被拒并回落为默认
        uiStore.setCustomLogoSvg(text);
      })
      .finally(() => {
        // 清空 value，允许重复上传同一文件
        input.value = "";
      });
  }
</script>

<Dialog {open} title="Settings" size="S" testid="settings-dialog" {onclose}>
  <div class="settings-dialog">
    <section class="settings-section" aria-labelledby="settings-appearance">
      <h3 class="settings-section-title" id="settings-appearance">
        Appearance
      </h3>
      <div class="settings-row">
        <Switch
          checked={uiStore.showBanana}
          label="Banana for scale"
          helperText="Show a banana beside racks for a sense of size."
          onchange={() => uiStore.toggleBanana()}
        />
      </div>
      <!-- Rack3D 扩展：界面配色方案（五套主题） -->
      <div class="theme-field">
        <span class="theme-field-label" data-testid="theme-label"
          >Colour theme</span
        >
        <div class="theme-grid" role="group" aria-label="Colour theme">
          {#each APP_THEMES as t (t.id)}
            <button
              type="button"
              class="theme-swatch"
              class:active={uiStore.appTheme === t.id}
              aria-pressed={uiStore.appTheme === t.id}
              data-testid={"theme-option-" + t.id}
              onclick={() => uiStore.setAppTheme(t.id)}
            >
              <span class="swatch-colours" aria-hidden="true">
                <span style="background:{t.swatch[0]}"></span>
                <span style="background:{t.swatch[1]}"></span>
                <span style="background:{t.swatch[2]}"></span>
              </span>
              <span class="swatch-label">{t.label}</span>
            </button>
          {/each}
        </div>
      </div>
    </section>

    <!-- Rack3D 扩展：LOGO 替换（上传 SVG / 恢复默认） -->
    <section class="settings-section" aria-labelledby="settings-logo">
      <h3 class="settings-section-title" id="settings-logo">Logo</h3>
      <div class="settings-action-row">
        <div class="logo-preview">
          <div class="logo-preview-mark">
            <LogoLockup size={30} showText={false} />
          </div>
          <span class="settings-action-help" data-testid="logo-state">
            {uiStore.customLogoSvg
              ? "Custom logo in use."
              : "Using the default logo. Upload an SVG to replace it."}
          </span>
        </div>
        <div class="logo-actions">
          <Button
            variant="secondary"
            onclick={() => logoFileInput?.click()}
            data-testid="logo-upload"
          >
            <span>Upload SVG</span>
          </Button>
          <Button
            variant="secondary"
            onclick={() => uiStore.setCustomLogoSvg(null)}
            disabled={!uiStore.customLogoSvg}
            data-testid="logo-reset"
          >
            <IconUndo size={ICON_SIZE.sm} />
            <span>Restore default logo</span>
          </Button>
        </div>
      </div>
      <input
        bind:this={logoFileInput}
        type="file"
        accept=".svg,image/svg+xml"
        class="logo-file-input"
        onchange={handleLogoFileChange}
      />
    </section>

    <section class="settings-section" aria-labelledby="settings-behaviour">
      <h3 class="settings-section-title" id="settings-behaviour">Behaviour</h3>
      <div class="settings-row">
        <Switch
          checked={uiStore.compatibleOnly}
          label="Compatible devices only"
          helperText="Hide devices that do not fit the active rack width."
          onchange={() => uiStore.toggleCompatibleOnly()}
        />
      </div>
      <div class="settings-row">
        <Switch
          checked={uiStore.enableBayedRacks}
          label="Enable bayed racks"
          helperText="Show the controls for baying racks together. Existing bays stay put when off."
          onchange={() => uiStore.toggleEnableBayedRacks()}
        />
      </div>
      <div class="settings-row">
        <Switch
          checked={uiStore.warnOnUnsavedChanges}
          label="Warn on unsaved changes"
          helperText="Confirm before leaving with unsaved work."
          onchange={() => uiStore.toggleWarnOnUnsavedChanges()}
        />
      </div>
      <div class="settings-row">
        <Switch
          checked={uiStore.promptCleanupOnSave}
          label="Prompt to clean up unused types"
          helperText="Offer to remove unused custom device types before saving or exporting."
          onchange={() => uiStore.togglePromptCleanupOnSave()}
        />
      </div>
    </section>

    <section class="settings-section" aria-labelledby="settings-data">
      <h3 class="settings-section-title" id="settings-data">Data</h3>
      <div class="settings-action-row">
        <div class="settings-action-text">
          <span class="settings-action-label">Clean up unused device types</span
          >
          <span class="settings-action-help">
            {unusedCount === 0
              ? "No unused custom device types right now."
              : `${unusedCount} unused custom device ${unusedCount === 1 ? "type" : "types"} can be removed.`}
          </span>
        </div>
        <Button
          variant="secondary"
          onclick={handleCleanup}
          disabled={unusedCount === 0}
        >
          <IconTrash size={ICON_SIZE.sm} />
          <span>Review</span>
        </Button>
      </div>
      <div class="settings-action-row">
        <div class="settings-action-text">
          <span class="settings-action-label">Reset dismissed prompts</span>
          <span class="settings-action-help">
            {promptDismissed
              ? "The clean-up prompt is currently dismissed."
              : "No prompts are dismissed."}
          </span>
        </div>
        <Button
          variant="secondary"
          onclick={handleResetPrompts}
          disabled={!promptDismissed}
        >
          <IconUndo size={ICON_SIZE.sm} />
          <span>Reset</span>
        </Button>
      </div>
    </section>
  </div>
</Dialog>

<style>
  .settings-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .settings-section-title {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--colour-text-muted);
  }

  .settings-row {
    display: flex;
    align-items: center;
    min-height: 44px;
  }

  .settings-action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: 44px;
  }

  .settings-action-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .settings-action-label {
    font-weight: var(--font-weight-medium);
    color: var(--colour-text);
    font-size: var(--font-size-base);
  }

  .settings-action-help {
    font-size: var(--font-size-sm);
    color: var(--colour-text-muted);
  }

  /* ---- Rack3D 扩展：配色方案色板 ---- */
  .theme-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }

  .theme-field-label {
    font-weight: var(--font-weight-medium);
    color: var(--colour-text);
    font-size: var(--font-size-base);
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
  }

  .theme-swatch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-2);
    background: var(--colour-button-bg);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--colour-text);
    font: inherit;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background var(--duration-fast) var(--ease-out);
  }

  .theme-swatch:hover {
    background: var(--colour-button-hover);
  }

  .theme-swatch.active {
    border-color: var(--colour-focus-ring);
    box-shadow: var(--glow-pink-sm);
  }

  .swatch-colours {
    display: flex;
    width: 100%;
    height: 22px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 1px solid var(--colour-border);
  }

  .swatch-colours span {
    flex: 1;
  }

  .swatch-label {
    font-size: var(--font-size-xs);
    line-height: 1.2;
    text-align: center;
  }

  /* ---- Rack3D 扩展：LOGO 替换 ---- */
  .logo-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .logo-preview-mark {
    display: flex;
    align-items: center;
    min-height: 34px;
  }

  .logo-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .logo-file-input {
    display: none;
  }
</style>
