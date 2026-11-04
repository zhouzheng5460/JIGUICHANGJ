# 机柜 3D 配置器 · 交接说明

> 面向接手同事的快速上手文档。上游技术细节见 `RACK3D.md`（44KB 开发文档）与上游 `README.md`。

## 一、这是什么

基于开源项目 **Rackula**（MIT，rackula 26.9.0）二次开发的**机柜 3D 配置器**：

- 技术栈：**Svelte 5（runes）+ Vite + Three.js + bits-ui + Zod**
- 已完成：全套界面汉化、3D 场景渲染（机柜/设备/凹槽/灯带/框架）、2D↔3D 双向同步、主题（亮/暗）、拾取与选中、机柜并排布局、设备弹窗、告警状态着色、遥测数据接入（REST 轮询 + 本地模拟器）

## 二、快速启动（Windows）

```bat
:: 依赖安装（本机 npm 源已指向 npmmirror；--ignore-scripts 跳过 husky 钩子）
npm install --ignore-scripts

:: 启动开发服务器（固定 5200 端口）
npm run dev -- --port 5200 --strictPort
```

浏览器打开 `http://127.0.0.1:5200/`。Node 建议 22+（本机用 22.22.2）。

其他常用命令：

| 命令 | 用途 |
|---|---|
| `npm run build` | 生产构建 |
| `npm run check` | svelte-check 类型检查 |
| `npm run test:run` | 单元测试（Vitest，需 8G 内存上限，见 scripts.test） |
| `npm run lint` | ESLint |

> ⚠️ 本仓库已精简：`assets-source/`（311M 上游原始素材）未纳入版本库。运行时用的是编译产物 `assets/`（已入库），**日常开发与构建不受影响**；只有需要用 `npm run process-images` 重新生成设备图片时才需要它。

## 三、代码地图：哪些是我们的，哪些是上游的

**自有代码只放在 `src/lib/{three,components3d,telemetry,i18n}/`，其余一律是上游 Rackula 原则上不动。**

上游侧的接入点（改这些要谨慎、留注释）：

- `src/main.ts`、`src/App.svelte`、`src/lib/ui.svelte.ts`
- `src/lib/components/SidePanel.svelte`、`SidePanelContent.svelte`
- `package.json`

| 目录 | 内容 |
|---|---|
| `src/lib/i18n/` | 汉化层（见下节） |
| `src/lib/three/` | 3D 场景核心：`rack-scene.ts`（场景/拾取/主题/动画）、`view.svelte.ts`（视图状态） |
| `src/lib/components3d/` | 3D 相关 Svelte 组件 |
| `src/lib/telemetry/` | 遥测适配：REST 轮询 + 本地 mock 模拟器 |
| `tools/` | 自研工具脚本（e2e、i18n 扫描、取色探针、mock 遥测服务器等） |

## 四、汉化体系（改文案必读）

唯一维护面是 **`src/lib/i18n/dict.zh-CN.ts`**，由三部分组成：

- `TEXT`：整串词典
- `RULES`：正则替换表（值可为**函数**——中英混合串必须用函数式替换，纯字符串 `$1` 拼接会留半截英文）
- `applyComposed`：组合应用入口，负责遍历整棵 DOM 子树（含 placeholder/title/aria-label/alt/data-tooltip）

配套文件：

| 文件 | 职责 |
|---|---|
| `i18n/default-names.ts` | 默认名与复制后缀（**持久化数据**，不能直接进 TEXT 表） |
| `i18n/app-chrome.ts` | 页签标题 / favicon（标题用 MutationObserver 兜住上游 `LOCAL - ` 前缀） |
| `tools/i18n-coverage-check.mjs` | 静态缺口自查 |

两个历史坑：

1. `applyComposed` 只处理「直接子节点全为文本节点」的元素——放宽到含元素子节点的容器会被兜底正则把整面板拍平成文本。
2. 切语言 = 写 `localStorage['rack3d_locale']` 后**整页重载**，不是响应式切换。

## 五、3D 关键约定（改场景必读）

- **单位**：1U = 44.45mm；场景内部 1U = 6 单位；**U 位换算必须减 1U**：`yBottom = (position/6 - 1) * U_HEIGHT_M`（`PlacedDevice.position` 是 1/6U，6 = U1）
- 设备盒高 ×0.94 留缝；并柜沿 X 轴、间距 100mm、整排居中
- **拾取**：`Raycaster.params.Line.threshold` 必须 = .004（默认 1 会导致刻度线全屏误命中、只有第一个柜能点中）；位移 >5px 视为旋转不选中
- 正交/透视切换须**重建 OrbitControls**；自动聚焦只依据 `selection` store
- **2D↔3D 真相源 = `selection` store**；机柜顺序真相源 = `rack-row.ts:organizeRackRow()`，3D 同步改顺序两处都要改
- **主题**：`applyTheme()` 只改色与光、不重建几何；金属度是亮度根本杠杆（无环境贴图时越高越黑）；合并通道片元末尾必须 `#include <colorspace_fragment>`
- 红色只准用于「严重」与链路异常

## 六、持久化与数据

- localStorage：`Rackula:workspace`（索引）+ `Rackula:layout:<id>`（正文）
- 遥测：真实适配器只有 **REST 轮询**与**本地 mock 模拟器**（`tools/mock-telemetry-server.mjs`）；MQTT/Modbus/SNMP/OPC-UA 目前是**占位**，接真平台前别当已实现功能宣传
- 线缆目前**纯视觉展示**，无电气联动
- 只读锁尚无桌面端 UI 入口

## 七、验证手段（无 Chrome 环境也适用）

本机无 Chrome，e2e 用 **Edge + playwright-core + executablePath**（见 `tools/e2e.mjs`）：

- 注入 localStorage 用 `page.addInitScript()`；探针读样式前先 `mouse.move()`
- 「更亮了」类断言必须 A/B 对照（两版各截一张再比像素）
- 3D 取色用 `tools/rack3d-color-probe.mjs` / `probe-canvas-readback.mjs`（canvas 读回）

## 八、待办（产品层面）

按优先级：机柜真实三维模型还原 → 开关门动画 → 板卡插拔双向联动（3D 拔卡→发 DCS 仿真；真实数据→驱动 3D 动画）→ 线缆插拔展示 → 第一人称漫游 → 空间场景绘制 → 科技/写实双风格 → DCS 链路分组独显 → 2D+3D 运行时嵌入业务系统 → 项目管理与 SSO（复用 DCS 平台）→ DCS 采集推送标准适配 → 信创适配。

完整功能项与人天清单见随附文档《机柜3D配置器-功能模块与功能项清单》。
