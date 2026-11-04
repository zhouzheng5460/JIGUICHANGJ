/**
 * 页签外观（标题 / 图标）
 * ============================================================================
 * 中文化后的两个浏览器外观项：
 *   1. `<title>` → 「机柜3D配置器」（英文环境保留上游标题与 LOCAL/DEV 前缀）
 *   2. favicon → 设置里上传的自定义 SVG LOGO，未设置时回落到上游图标
 *
 * 两者都不改上游文件：标题由 main.ts 在 mount 之后接管（并持续兜住
 * PersistenceEffects 的环保前缀改写），图标由 ui store 在设置/启动时同步。
 */

import { getLocale } from "./locale";

/** 中文环境下的浏览器页签标题 */
const APP_TITLE_ZH = "机柜3D配置器";

/** 我们注入的 favicon <link> 的 id，用于「恢复默认」时精确移除 */
const FAVICON_LINK_ID = "rack3d-favicon";

let titleObserver: MutationObserver | null = null;

/**
 * 应用页签标题。
 *
 * ⚠️ 上游 PersistenceEffects 会在自己的 onMount 里给标题拼上 "LOCAL - " /
 * "DEV - " 环保前缀，而 Svelte 5 的 mount() 之后该 effect 仍可能在稍后才刷新
 * —— 所以「mount 后再设一次」并不保险（实测仍被拼成 "LOCAL - 机柜3D配置器"）。
 * 这里改为持续兜住：设一次 + 观察 <head>，任何后续改写都被纠正回中文标题。
 * 写入自身会触发一次 mutation，但值已相等即不再写，不会自激。
 */
export function applyDocumentTitle(): void {
  if (typeof document === "undefined") return;
  if (getLocale() !== "zh-CN") return;

  if (document.title !== APP_TITLE_ZH) document.title = APP_TITLE_ZH;

  if (titleObserver || !document.head) return;
  titleObserver = new MutationObserver(() => {
    if (document.title !== APP_TITLE_ZH) document.title = APP_TITLE_ZH;
  });
  titleObserver.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/**
 * 把自定义 LOGO 的 SVG 源码同步为浏览器页签图标。
 *
 * - 传 SVG：注入（或复用）一个 `rel="icon" type="image/svg+xml"` 的 <link>，
 *   href 用 `data:` URL。SVG 里可能含 `#`（颜色）等保留字符，必须
 *   encodeURIComponent，否则整串会被截断。
 * - 传 null：移除我们注入的 <link>，index.html 里的原始 favicon 重新生效。
 */
export function applyCustomLogoToFavicon(svg: string | null): void {
  if (typeof document === "undefined") return;
  const head = document.head;
  if (!head) return;

  const existing = document.getElementById(
    FAVICON_LINK_ID,
  ) as HTMLLinkElement | null;

  if (!svg) {
    existing?.remove();
    return;
  }

  const link = existing ?? document.createElement("link");
  if (!existing) {
    link.id = FAVICON_LINK_ID;
    link.rel = "icon";
    link.type = "image/svg+xml";
    head.appendChild(link);
  }
  link.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
