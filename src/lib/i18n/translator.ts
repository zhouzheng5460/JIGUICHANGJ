/**
 * Rack3D 运行期翻译器（DOM 词典层）
 * ============================================================================
 * 只读遍历 DOM 文本节点与若干属性，按 dict.zh-CN.ts 做映射替换。
 *
 * 关键设计：
 *   - **零侵入**：不修改、不包装任何 Rackula 组件，上游代码保持原样。
 *   - **幂等**：译文不再是词典的 key，因此自身写入触发的 MutationObserver
 *     记录会在下一轮被判定为"无需翻译"并直接返回，不会自激循环。
 *   - **渐进降级**：词典未覆盖的文案保留英文原文，不出现空白或占位符。
 *   - **动态内容**：Svelte 重新渲染回英文时会被观察器再次翻译。
 */

import { TEXT, RULES, KEEP_AS_IS } from "./dict.zh-CN";

const KEEP = new Set(KEEP_AS_IS);

/** 不进入翻译的标签（脚本、样式、代码块、文本域值） */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"]);

/** 参与翻译的属性 */
const ATTRS = ["placeholder", "title", "aria-label", "alt", "data-tooltip"];

const HAS_CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
const HAS_LETTER = /[A-Za-z]/;

/** 归一化：折叠连续空白、裁剪首尾 */
function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** 规则替换值的递归查词上限，防止自引用规则无限递归 */
const MAX_RULE_DEPTH = 2;

/** 先查 TEXT 精确表，再逐条试 RULES */
function resolve(value: string, depth: number): string | null {
  const key = normalize(value);
  if (!key) return null;
  if (!HAS_LETTER.test(key)) return null;
  if (KEEP.has(key)) return null;

  // 中文判定分两种：
  //   a) 纯英文 → 正常查词；
  //   b) **中英混合**（既有汉字又有拉丁字母）→ 不能当作"已翻译"直接跳过。
  //      上游大量文案把变量插在句子里，而变量本身可能就是中文，
  //      例如 `Undo: Duplicate rack "机柜 A"`（机柜名已是中文）。
  //      这类串显然没译过，仍须放行 RULES；但绝不查 TEXT 表
  //      （TEXT 的键全是纯英文，混合串去查只会误命中）。
  //   c) 纯中文（无拉丁字母）→ 上面 HAS_LETTER 已拦掉。
  const mixed = HAS_CJK.test(key);
  if (!mixed) {
    const direct = TEXT[key];
    if (direct !== undefined) return direct;
  }

  for (const [pattern, replacement] of RULES) {
    if (!pattern.test(key)) continue;

    if (typeof replacement === "string") return key.replace(pattern, replacement);

    // 函数式替换：先对捕获组再做一次查词，这样 `Storage status: {label}, {loc}`
    // 这类插值句子里的英文片段（如「Not exported」）也能被译到。
    const match = pattern.exec(key);
    if (!match) continue;
    const captures = match.slice(1).map((raw) => {
      const part = raw ?? "";
      if (depth >= MAX_RULE_DEPTH) return part;
      return resolve(part, depth + 1) ?? part;
    });
    return replacement(...captures);
  }
  return null;
}

/**
 * 查询译文。
 * @returns 译文；返回 null 表示"无需翻译"（未命中词典 / 已是中文 / 白名单）
 */
export function lookup(value: string): string | null {
  return resolve(value, 0);
}

/** 计算替换文本，并保留原有的首尾空白 */
function translatePreservingSpace(raw: string): string | null {
  const out = lookup(raw);
  if (out === null) return null;
  const leading = /^\s*/.exec(raw)?.[0] ?? "";
  const trailing = /\s*$/.exec(raw)?.[0] ?? "";
  return `${leading}${out}${trailing}`;
}

function isSkipped(el: Element | null): boolean {
  let node: Element | null = el;
  while (node && node !== document.body) {
    const tag = node.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return true;
    if ((node as HTMLElement).dataset?.i18nSkip === "true") return true;
    // <option> 没有显式 value 时，其文本就是提交值，不能翻译
    if (
      tag === "OPTION" &&
      !node.hasAttribute("value") &&
      node.parentElement?.tagName.toUpperCase() === "SELECT"
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function applyTextNode(node: Text): void {
  const next = translatePreservingSpace(node.data);
  if (next === null || next === node.data) return;
  try {
    node.data = next;
  } catch {
    // 某些只读文本节点（罕见）写入会抛错，忽略即可
  }
}

/**
 * 整句匹配（只走 RULES）。
 * 上游部分文案由插值拼成（如 `No {face}-facing devices yet.`），在 DOM 上会拆成
 * 多个文本节点，逐节点匹配永远对不上整句。这里对「子节点全是文本节点」的元素
 * 做整句匹配并整体替换。
 *
 * 刻意不查 TEXT 表：那样会误伤 `文本节点 + 纯空白节点` 这类常见结构。
 */
export function lookupComposed(value: string): string | null {
  const key = normalize(value);
  if (!key) return null;
  if (!HAS_LETTER.test(key)) return null;
  if (KEEP.has(key)) return null;
  // 刻意不做「已含中文就跳过」：整句里的变量可能是中文
  // （如 `Undo: Duplicate rack "机柜 A"`），纯中文串已由 HAS_LETTER 拦下。
  for (const [pattern, replacement] of RULES) {
    if (!pattern.test(key)) continue;
    if (typeof replacement === "string") return key.replace(pattern, replacement);
    const match = pattern.exec(key);
    if (!match) continue;
    return replacement(...match.slice(1).map((raw) => resolve(raw ?? "", 1) ?? (raw ?? "")));
  }
  return null;
}

/**
 * 元素级整句翻译；返回是否发生了替换。
 * 仅当「直接子节点全为文本节点」时才做整句合成（允许夹带空白文本节点）。
 *
 * ⚠️ 绝不能放宽到「含后代文本」的容器：RULES 末尾的兜底规则（句末句点）
 * 对纯英文会原样返回，一旦命中含元素子节点的大容器（如整个 View/Edit 面板），
 * `el.textContent = out` 会把面板内所有控件拍平成一串文本（Round 15 回归教训）。
 * 含元素子节点的整句（如布局卡元信息）改为在上游把各短语包进独立 span，
 * 让每个 span 自身满足「纯文本子节点」条件后再走合成。
 */
function applyComposed(el: Element): boolean {
  const children = el.childNodes;
  if (children.length < 2) return false;
  for (let i = 0; i < children.length; i += 1) {
    if (children[i]?.nodeType !== Node.TEXT_NODE) return false;
  }
  const raw = el.textContent ?? "";
  if (!raw.trim()) return false;
  const out = lookupComposed(raw);
  // out 与归一化原文相同（如兜底规则原样返回英文）时不写，
  // 避免 MutationObserver 自激与无意义 DOM 写入。
  if (out === null || out === normalize(raw)) return false;
  el.textContent = out;
  return true;
}

function applyAttributes(el: Element): void {
  for (const name of ATTRS) {
    const current = el.getAttribute(name);
    if (current === null || current === "") continue;
    const out = lookup(current);
    if (out === null || out === current) continue;
    el.setAttribute(name, out);
  }
}

/** 遍历并翻译一棵子树 */
export function translateSubtree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    const parent = (root as Text).parentElement;
    if (!isSkipped(parent)) applyTextNode(root as Text);
    return;
  }
  if (
    root.nodeType !== Node.ELEMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
  ) {
    return;
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as Element;
    if (isSkipped(el)) return;
    applyAttributes(el);
    applyComposed(el);
  }

  // 第一遍：元素级。属性（placeholder / title / aria-label…）与「含插值整句」
  // 必须在这里处理 —— 只对根元素应用属性，会让整棵子树的 placeholder 全部漏翻。
  // 整句也要先于文本节点处理，否则碎片先被译掉，插值就再也拼不回整句了。
  const elementWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node: Node): number {
        return isSkipped(node as Element)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let element = elementWalker.nextNode();
  while (element) {
    const el = element as Element;
    if (el.isConnected || root.nodeType !== Node.ELEMENT_NODE) {
      applyAttributes(el);
      applyComposed(el);
    }
    element = elementWalker.nextNode();
  }

  // 第二遍：文本节点
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      return isSkipped((node as Text).parentElement)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    applyTextNode(current as Text);
    current = walker.nextNode();
  }
}

let observer: MutationObserver | null = null;

function handleRecords(records: MutationRecord[]): void {
  for (const record of records) {
    if (record.type === "characterData") {
      const node = record.target as Text;
      if (!isSkipped(node.parentElement)) applyTextNode(node);
      continue;
    }
    if (record.type === "attributes") {
      const el = record.target as Element;
      if (!isSkipped(el)) applyAttributes(el);
      continue;
    }
    for (const added of record.addedNodes) {
      translateSubtree(added);
    }
  }
}

/** 启动全局翻译（幂等，可重复调用） */
export function startTranslator(): void {
  if (observer) return;
  translateSubtree(document.body);
  observer = new MutationObserver(handleRecords);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

/** 停止全局翻译（用于切回英文前的清理） */
export function stopTranslator(): void {
  observer?.disconnect();
  observer = null;
}
