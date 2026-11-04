# Rack3D 扩展说明（基于 Rackula 二次开发）

> 本文件是 **Rack3D 自有文档**，不属于 Rackula 上游内容。
> 上游说明见 `README.md`。

---

## 一、本次新增能力

| # | 能力 | 入口 | 对应代码 |
| --- | --- | --- | --- |
| 1 | 本地部署基座工程 | `npm run dev` | `rackula/`（上游） |
| 2 | 界面中文汉化 | 默认 `zh-CN` | `src/lib/i18n/` |
| 3 | 右侧「实时数据映射」页签 | 右侧面板第三个页签 | `src/lib/components/TelemetryPanel.svelte`、`src/lib/telemetry/` |
| 4 | 3D 机柜查看模块 | 画布右上角 `3D` 角标 | `src/lib/components3d/Rack3DViewer.svelte`、`src/lib/three/` |
| 5 | 正交 / 透视相机切换（默认正交） | 3D 工具条分段控件 | `rack-scene.ts` `setCameraMode()` |
| 6 | 视角预设下拉（斜视 / 正视 / 侧视 / 顶视） | 3D 工具条 `视角` 下拉 | `rack-scene.ts` `setViewPreset()` |
| 7 | 点击设备 / 机柜自动聚焦（可开关） | 3D 工具条 `自动聚焦` | `rack-scene.ts` `focusDevice()` / `focusRack()` |
| 8 | 选中轮廓（Selection Outline，深度/ID 遮罩 + 合并通道，**支持遮挡**） | 点击设备 / 机柜 | `rack-scene.ts` `buildPostPipeline()` / `refreshSelection()` |
| 9 | 场景元素摆放（立方体 / 球体 / 桌子 / 椅子） | 3D 工具条 `摆放` | `rack-scene.ts` 地平面交互、`view.svelte.ts` `addProp()` |
| 10 | 机柜作为**整体交互对象**：整柜轮廓 + 柜级弹窗；选中他柜转半透明 | 点击机柜柜体（立柱 / 顶底板） | `rack-scene.ts` `setSelectedRack()` / `applyRackOpacity()` |
| 11 | 取景填充比：机柜占视窗宽 **80%**、设备占 **85%**、**全场景（整排机柜总宽）占 80%** | 自动聚焦 / 重置视角 | `rack-scene.ts` `FRAME_FILL_RACK` / `FRAME_FILL_DEVICE` / `FRAME_FILL_SCENE` |
| 12 | 2D 画布 ↔ 3D 视窗**双向选中同步**（选中机柜/设备 → 3D 同选 + 轮廓 + 弹窗；画布无选中 → 3D 复位并关闭弹窗） | 在 2D 画布点选 / 点空白 | `Rack3DViewer.svelte` 统一 sync `$effect`，真相源 = `selection` store |
| 13 | **黑 / 白两套三维场景主题**一键切换（配色 + 打光 + 材质反射特性） | 3D 工具条 `暗色 / 亮色` 分段控件 | `rack-scene.ts` `THEMES` / `setSceneTheme()` / `applyTheme()` |
| 14 | 选中轮廓**被遮挡段弱化显示**（仍可见，强度约为露出段的一半） | 点击设备 / 机柜 | `rack-scene.ts` 合并通道 `uAlpha` / `uOccludedAlpha` |

---

## 二、开发与运行

```bash
cd G:/Rackula-main/Rackula-main
npm install --ignore-scripts   # 国内网络建议；--ignore-scripts 跳过 sharp/husky 的二进制下载
npm run dev                    # http://localhost:5173
npm run build                  # 产物在 dist/
npm run check                  # svelte-check 类型检查（当前 0 error / 0 warning）
```

> 依赖里 `sharp` / `playwright` 仅用于图片处理与 E2E，不影响开发与运行。

> ⚠️ **`npm install` 若卡在「建完空目录后不动」，是工具沙箱拦截了 `node_modules` 写入，
> 不是网速问题**。请让执行命令脱离沙箱（`dangerouslyDisableSandbox`）后重跑。

### 遥测联调（可选）

```bash
# 终端 A：启动零依赖的模拟数据源
node tools/mock-telemetry-server.mjs --port 8787 --count 12

# 终端 B：启动前端
npm run dev
```

在「实时数据映射」页签把适配器改为 **REST / HTTP 轮询**，端点填
`http://127.0.0.1:8787/api/devices`，再为机柜/设备新增绑定即可。

> 零配置演示可直接选 **本地模拟器（演示）** 适配器，无需启动任何服务端。

> ⚠️ `index.html` 的 meta CSP 为 `connect-src 'self'`，浏览器会拦截跨域直连。
> 演示阶段请使用 **本地模拟器** 适配器（零配置、开箱可用）；
> 正式接入采集平台时，请在部署层（`deploy/security-headers.conf`）追加
> `connect-src` 域名，不要改动上游 `index.html`。

### 端到端验证工具（`tools/`）

本机无 Chrome，但有 Edge，因此用工程自带的 `playwright-core` 驱动系统 Edge，
**无需下载 Chromium**：

```bash
node tools/e2e.mjs tools/rack3d-verify-v3.mjs   # 推荐入口：同进程内起 Vite → 跑脚本 → 关 Vite
node tools/rack3d-verify.mjs      # 基础验证：控制台报错 + 三处功能截图
node tools/rack3d-seed-demo.mjs   # 注入演示布局（双柜 12 台设备 + 11 条绑定）后验证
node tools/rack3d-verify-opt.mjs  # 三项展示层优化的客观断言（配色 / 渲染模式 / 设备数据卡片）
node tools/rack3d-verify-v2.mjs   # 第二轮 8 项断言（相机 / 视角 / 投影 / 自动聚焦 / 高光 / 染色 / 弹窗 / 摆放）
node tools/rack3d-verify-v3.mjs   # 第三轮 11 项断言（几何对齐 / 机柜交互 / 遮罩轮廓 / 取景距离 / 同步 / 主题），见下表
node tools/rack3d-verify-v4.mjs   # 第四轮断言（去雾 / 半球光 / 材质提亮 A/B / 点空白复位不跳回），见下表
node tools/rack3d-verify-v5.mjs   # 第五轮断言（排列顺序同步 / 复位 80% / 地面提亮 / 未选柜整体降透明 / 透视外壳不可选 / 弹窗全指标），见下表
node tools/rack3d-verify-v6.mjs   # 第六轮断言（复位不计入场景元素 / 弹窗不溢出 / 网格 30%+地背景同色 / 设备聚焦 70%），见下表
node tools/shot-theme.mjs         # 主题对照截图（同一机柜在 暗/亮 两套主题下各截一张 3D 视口图）
node tools/probe-load.mjs          # 页面加载体检：错误收集 + 3D 画布像素统计 + 依赖 URL 状态清单
node tools/probe-canvas-readback.mjs # 诊断：画布读回（drawImage）与真实截图是否一致
node tools/probe-framing.mjs      # 取景诊断探针（转储 orthoHalfHeight / sceneBox / 相机参数，定位取景 NaN）
node tools/rack3d-probe-racks.mjs # 机柜拾取诊断探针（逐机柜命中详情，定位"只有第一个柜可点"类问题）
node tools/rack3d-color-probe.mjs # 配色聚焦探针（鼠标移开后再读计算样式，排除 :hover 干扰）
node tools/rack3d-pixel-probe.mjs # 画布像素网格采样（定位顶视图/背景色等观感问题）
node tools/rack3d-ls-dump.mjs     # 导出浏览器 localStorage，用于分析布局 schema
```

> ⚠️ **本机沙箱会在宿主命令结束时回收整棵进程树**：后台任务、`Start-Process`、
> detached 子进程都活不过一条命令，所以"先起服务、再跑探针"两步走一定失败。
> `tools/e2e.mjs` 把「起 Vite → 跑脚本 → 关 Vite」放进**同一进程组**，是唯一稳定姿势。
> 起 Vite 涉及写 `node_modules/.vite` 缓存，命令需要 `dangerouslyDisableSandbox`。

`rack3d-verify-v3.mjs` 覆盖 A–J 十一项断言：

| 断言 | 含义 |
| --- | --- |
| A | 设备盒体**底边**贴合 U 槽底；最高 U 设备顶面低于柜内净高（不穿顶板） |
| B | **任意**机柜点击都能弹出机柜弹窗（不只是第一个柜） |
| C | 选中机柜时其余机柜转半透明（两个方向都验） |
| D | 选中设备走深度/ID 遮罩，出现选中色（粉）像素且跨度足够 |
| E | 轮廓被前方几何体**弱化显示**：顶视图仍可见，但强度（`max(r-g)`）低于正视图 75% |
| F | 取景填充比：机柜 ≈ 0.80、设备 ≈ 0.85 |
| G | 无选中时复位到「全部设备都可见」的取景（`orthoTop` 与复位值逐位相等） |
| H | 黑白两套场景主题可切换：`theme` 字段随切换变化，且画布角落亮度 亮 ≈ 193 / 暗 ≈ 2 |
| I | 2D 画布点选机柜 → 3D 整柜选中 + 机柜弹窗（双向同步的 2D→3D 方向） |
| J | 2D 画布点空白 → 3D 复位到未选中、弹窗数归零 |

> ⚠️ **轮廓"遮挡强度"要用通道差当代理量，不能靠粉色像素计数**：
> 换个视角后物体在屏幕上的投影尺寸也变了，像素计数既受强度影响也受几何影响，
> 无法区分"变弱"和"变小"。`r - g` 差值只取决于混色 alpha（纯粉 ≈ 134，
> 混到柜体灰面上按 alpha 线性衰减），换视角不会干扰，是稳定可比的强度代理量。
> 实测：正视图 `max(r-g)=190` → 顶视图（被顶板挡住）= 91，约为 48%。

`rack3d-verify-v4.mjs` 覆盖 K–O 五项断言：

| 断言 | 含义 |
| --- | --- |
| K | 场景**不使用雾**：`scene.fog === null`（且光照对象数 ≥ 4，防"读不到 scene 导致恒 null"的假通过） |
| L1 | 半球光存在且已增强：`hemiIntensity = 2.8`、`groundColor = #59626f`（暗色主题） |
| L2 | 环境光 `0.72` / 补光 `1.45`（暗色主题）；L3 金属度已压低（框架 ≤ 0.4、机身 ≤ 0.15） |
| L4 | **A/B 提亮对照**：把旧光照/材质参数在运行期套回去再测一次，机身面板亮度 `65.9 → 103.7`（×1.57）、全模型 `53.3 → 86.8`（×1.63） |
| L6 | 旧参数改完后 `setSceneTheme()` 能**完整还原**（金属度、半球光强度回到原值） |
| M | **点空白复位不跳回**：2D 画布选中机柜 → 相机推近（`orthoTop` 1.132 → 0.519）→ 点 2D 画布空白 → 复位到 1.132，**再等 3 秒仍为 1.132**；同时 `activeRackId` 仍残留 `rack-1`，证明修复来自"聚焦只看 selection"而非副作用顺手清干净 |
| N | 3D 视窗内点空白 → 仍能清空选中 + 复位到全场景（回归保护） |
| O | 亮色主题 A/B：去雾会略微压低亮色主题亮度，因此同样做同比，机身面板 `117.5 → 138.5`（×1.18），**不得倒退** |

`rack3d-verify-v5.mjs` 覆盖 P–U 六项断言：

| 断言 | 含义 |
| --- | --- |
| P | 机柜**排列顺序**同步到 3D：布局里数组顺序与 `position` 顺序故意相反，3D 仍按 `organizeRackRow()` 的 position 顺序排列（实测 `rack-2` 在左 x=-0.29、`rack-1` 在右 x=+0.29）。实现点：`Rack3DViewer.orderedRacks()` 用 `organizeRackRow()` 取行顺序 + `layoutSignature` 计入 `rack.position`（否则只改顺序时签名不变、场景永不重建） |
| Q | 复位取景：机柜排在视窗里的**横向占比实测 0.8026**（目标 80%，`FRAME_FILL_SCENE` 在宽度受限的竖长视口下正好命中） |
| R | 地面提亮：`floor #1c1f26 → #343b48`（网格线同步 `#3d4453/#252a34 → #4a5364/#2f3644`），隐藏机柜后整幅亮度 `22.8 → 31.9`（**×1.40**） |
| S | 选中某柜时，**其它柜的柜内设备 / 面板凹槽 / 灯座 / 指示灯**一起降透明度（设备与凹槽 0.30、框架 0.18、侧板 0.06、指示灯 0.55），被选柜保持完全不透明，清空选中后完全复原 |
| T | 透视（xray）模式下**机柜外壳不参与拾取**：同一坐标在实体模式下选中机柜、透视模式下不选中（按「点空白」处理）；点柜内设备仍可正常选中 |
| U | 3D 弹窗列出**全部**绑定指标（功率/电流/电压/温度/湿度/状态/开关/转速）：设备弹窗 11 行（含进度条 + 趋势图），机柜弹窗 13 行（柜级绑定 + 进度条） |

> ⚠️ **弹窗指标行与进度条/趋势图刻意会重复显示同一个数值**：行给"精确读数"，
> 图给"占比 / 趋势"，二者口径一致（`METRIC_FULL_SCALE` 与阈值 `crit` 同源）。
> 不要为了去重把数值指标从行里滤掉——那正是「弹窗缺指标项」这个需求的起因。

> ⚠️ **透视模式下关掉外壳选中，必须在 `pick()` 里做而不是 `hitTestRacks()`**：
> `debugProbe()` 诊断接口复用 `hitTestRacks()`，如果在里面过滤，探针就再也看不到
> 外壳命中，验证脚本会失去"扫描外壳点"的能力。

`rack3d-verify-v6.mjs` 覆盖 V–Y 四项断言：

| 断言 | 含义 |
| --- | --- |
| V | 默认 / 复位取景**不计入**机柜以外摆放的三维模型：`sceneBox()` 不再 `expandByObject(propGroup)`，远处放了元素后 `resetView()` 的 `orthoTop` 与"没放元素时"逐位相等（实测 1.065738 == 1.065738） |
| W | 弹窗**不溢出** 3D 视窗、不遮挡标题与按钮：设备弹窗（中部 / 最顶部）/ 机柜弹窗三种场景的 rect 都完整落在 `.rack3d-viewport` 内。实测卡片高 469px（远超旧常量估算的 250px），这正是以前顶出去的原因 |
| X | 地面网格线不透明度 30%（`THEMES.gridOpacity`），且**地面色 == 背景色**（暗 `#191a21`、亮 `#e9e9e9`） |
| Y | 聚焦机柜内设备：设备包围盒宽度占屏幕宽度 **0.70**（`FRAME_FILL_DEVICE` 从 0.85 调低） |

`rack3d-verify-v7.mjs`（Round E，第七轮）覆盖 A–C 六项断言：

| 断言 | 含义 |
| --- | --- |
| A1 | 线框蓝色线框 `opacity = 0.5` 且 `transparent = true` |
| A2 | 线框混合模式 = `AdditiveBlending`（three.js 枚举 `2`，即「叠加」；叠加在实体之上呈发光式叠绘，而非普通半透明压暗） |
| B1 | 地面材质 = `MeshBasicMaterial`（无光材质，`isMeshBasicMaterial === true`，不接受任何光照影响；颜色只由主题决定） |
| C1 | 每台机柜顶部都有常驻名称标签（`Sprite` + 画布纹理），初始 `visible = true` |
| C2 | 选中机柜并弹出其弹窗时，该机柜的标签 `visible` 被置为 `false`（避免与弹窗标题重复） |
| C3 | 关闭机柜弹窗后，该机柜标签恢复 `visible = true` |

> ⚠️ **机柜名称标签是装饰性 Sprite，必须"三不"：不计入取景包围盒、不参与射线拾取、不随主题重绘**。
> - 不计入取景：`setFromObject(runtime.group)` 会把标签一起算进去，而标签浮在柜顶且比柜体还宽（0.72m），
>   一旦计入就会把 `focusRack()` / `rackDepth()` 的包围盒撑大、相机被推远、机柜本体显小。
>   因此新增 `rackBodyBox(runtime)` 显式跳过 `labelSprite`，`focusRack()` 与 `rackDepth()` 都用它。
> - 不参与拾取：标签 `sprite.raycast = () => {}`，否则点机柜顶部附近会误命中标签、或在 xray 下挡住柜内设备的穿透点击。
> - 不随主题重绘：标签用深色药丸 + 白字，暗/亮两套主题下都可读，省去 `applyTheme()` 里重建纹理。
>   标签是 `group` 的子节点，随机柜平移自动跟随；`setRackLabelHidden(rackId, hidden)` 控制显隐，
>   由 `Rack3DViewer` 的 `$effect`（监听 `rackPopup`）在"选中该柜且弹窗打开"时隐藏、关闭后恢复。

> ⚠️ **弹窗夹取必须用实测尺寸，不能用常量估算**。
> 卡片高度由指标行数决定（8 个指标 + 进度条 + 趋势图 ≈ 469px），常量 250px 会让
> `yMin/yMax` 算出一个"装得下"的假区间，卡片实际顶出视窗压到标题栏上。
> 做法：`getDeviceAnchor/getRackAnchor` 接受可选的 `cardWidth/cardHeight`，
> 组件在渲染循环里直接读 `popupEl.offsetWidth/offsetHeight` 传入；
> CSS 再加 `max-height: calc(100% - 16px); overflow-y: auto` 兜底，
> 视窗加 `overflow: hidden` 作最后防线。

> ⚠️ **验证"点空白/点外壳"前必须先关掉上一轮弹窗**：弹窗浮在画布上层且
> `pointer-events: auto`，它盖住的区域里 `debugProbe` 扫出的坐标点下去实际命中的是
> 弹窗，画布根本收不到 click——症状是"机柜弹窗切不过去"，极易误判成选中逻辑坏了。
> 先 `document.querySelectorAll(".popup-close").forEach(b => b.click())`。

> ⚠️ **像素统计脚本必须挂上 mock 遥测绑定**：没有绑定 = 所有设备状态是「未接入」，
> 机身与被测色全是灰的，`devicePixelPct` 会恒为 0，看起来像"读画布坏了"。
> 排查顺序永远是：先怀疑探针的**输入数据**，再怀疑引擎，最后才怀疑读回机制。

> ⚠️ **"更亮了"这类主观断言必须做 A/B，不能设绝对阈值**。
> 绝对亮度受相机距离、主题、设备数量、遥测状态共同影响，阈值毫无说服力。
> 做法：在运行期把旧参数直接套回活场景（`ambientLight.intensity`、材质 `metalness`、
> 重算 `userData.baseColour` 后 `setDeviceStatuses()`），同一相机同一场景再测一次，
> 用比值下断言；测完走 `setSceneTheme(c.theme)` 正常还原并顺带验证可复原性。

> ⚠️ **验证脚本里的点击坐标不能手填比例，必须由引擎算出**。
> 3D 视口在本机是**竖长条**（canvas 约 393×701，宽高比 0.56），场景按"宽度受限"
> 取景，机柜只占屏幕中间约 1/4 高度——任何硬编码的 `(0.1, 0.8)` 之类比例都会落在
> 机柜之外，表现为"点什么都没反应"，从而误判成功能坏了。
> 正确做法：用引擎只读诊断接口 `window.__rack3d.debugProbe(x, y)` 在画布上**扫描**出
> 满足条件的坐标（命中指定机柜且未命中设备 / 命中指定设备 / 什么都没命中）再点它。
> 另外**扫描必须趁"全场景取景"时做完**：一旦选中某个机柜，自动聚焦就把相机推过去了，
> 另一个机柜随即移出视野，再扫也扫不到。

脚本会输出客观指标：`pageerror` 数量、3D 画布非背景像素占比、
`placeholder/title/aria-label` 的翻译结果、以及本该被译掉的英文残句清单。

`rack3d-verify-v2.mjs` 覆盖 A–H 八组断言：

| 断言 | 含义 |
| --- | --- |
| A | 默认相机为「正交」，视角下拉含 斜视/正视/侧视/顶视 |
| B | 四个视角预设切换后画面均改变且都完整落在视口内 |
| C | 正交 ↔ 透视切换保构图（覆盖率不发生数量级跳变） |
| D | 自动聚焦：开启时点击设备显著放大，关闭时不放大 |
| E | 选中高光：出现选中色（粉）像素，且关闭数据卡片后仍保留 |
| F | 状态染色：出现状态色（绿 / 琥珀 / 红）像素 |
| G | 弹窗新布局：行式列表 + 进度条 + 折线路径非空 + `contained` |
| H | 摆放：元素面板、地面落地、浮动条改色并落库 |

> ⚠️ **画布像素统计必须按「原生分辨率」采样 + 用「色相关系」判色**：
> 线框只有 1px 宽，先缩小再判色会把线宽稀释成背景色（粉 `#ff79c6` 缩到 0.7px
> 变成 `(184,91,147)`），用欧氏距离判色会直接漏检。

`rack3d-verify-opt.mjs` 额外输出：

| 指标 | 含义 |
| --- | --- |
| `panelBorderIsRed` / `titleIsRed` / `closeIsRed` | 是否残留告警红 `#e05252`（期望全为 `false`） |
| `cyan` | 青色线框像素占比 —— 实体模式应≈0，线框/透视模式显著 >0 |
| `contained` | 设备数据卡片是否完整落在 3D 视口内（不被 `overflow` 裁切） |
| `moved` | 轨道旋转后卡片是否跟随相机移动 |
| `XRAY PICK` | 透视模式下能否"看穿柜体"点中内部设备 |

> ⚠️ **探针读计算样式前必须先把鼠标移开**：Playwright 点击后鼠标会停在元素上，
> 若目标恰好被后续打开的面板覆盖，读到的是 `:hover` 态色值，会得出"样式没生效"的错误结论。



---

## 三、汉化方案：运行期词典层

### 为什么不是逐组件替换

Rackula 有 150+ Svelte 组件、800+ 条界面文案。逐条替换会把自有改动散布到几乎
每个上游文件，后续 `upstream/main` rebase 将不可维护（企划 6.4 要求上游代码原则上不动）。
因此采用**运行期 DOM 词典层**：

```text
src/lib/i18n/
├── dict.zh-CN.ts   ← 唯一维护面：英文原文 → 简体中文
├── translator.ts   ← DOM 遍历 + MutationObserver，幂等翻译
├── locale.ts       ← 语言状态（localStorage: rack3d_locale）
└── index.ts        ← 导出入口
```

- **零侵入**：不修改任何上游组件。
- **幂等**：译文不再是词典 key，自身写入不会自激循环。
- **渐进降级**：未收录的文案保留英文，不出现空白或占位符。
- **动态内容**：Svelte 重新渲染回英文时会被观察器再次翻译。

### 新增/修改词条

打开 `dict.zh-CN.ts`，把英文原文原样作为 key 加入 `TEXT` 即可：

```ts
export const TEXT: Record<string, string> = {
  "Add device": "添加设备",
  // ...
};
```

带变量的动态文案走 `RULES`：

```ts
[/^(\d[\d,]*) devices$/, "$1 台设备"],
```

替换值也可以是**函数**，入参会先被二次查词，用于「句子里夹着英文词条」的情况：

```ts
[
  /^Storage status: (.+), (.+)$/,
  (label, place) => `存储状态：${label} · ${place}`,
],
```

### 三条翻译通道（按需选用）

| 通道 | 适用场景 |
| --- | --- |
| `TEXT` | 精确整串匹配，覆盖绝大多数文案 |
| `RULES` | 正则替换；替换值为字符串（`$1` 引用捕获组）或函数 |
| 整句通道 | 上游含插值的句子（`No {face}-facing devices yet.`）在 DOM 上是多个文本节点，逐节点匹配永远对不上，由 `applyComposed` 按**整句**匹配并整体替换 |

另外，翻译覆盖 `placeholder` / `title` / `aria-label` / `alt` / `data-tooltip`
五个属性，且**必须遍历整棵子树** —— 只处理根元素会让所有后代属性漏翻。

> 注意：若用脚本按英文 `aria-label` 定位元素，汉化生效后会失效（属性已被译成中文），
> 请改用 `class` 或 `data-testid`。


### 切换语言

默认中文。切换后整页重载（译文替换不可逆，重载是最可靠的还原路径）。
临时切回英文可在浏览器控制台执行：

```js
localStorage.setItem("rack3d_locale", "en"); location.reload();
```

---

## 四、实时数据映射（企划 M3 前端侧）

### 数据流

```text
采集平台 ──▶ 适配器(插件) ──▶ 归一化 TelemetryFrame ──▶ store ──▶ 面板 + 3D 状态
             rest / mock      { asset_id, ts, metrics, quality }
```

### 扩展一个新平台

在 `src/lib/telemetry/store.svelte.ts` 的 `ADAPTER_RUNNERS` 注册表里加一项即可，
**不需要改动面板与 3D 层**：

```ts
const ADAPTER_RUNNERS: Record<AdapterType, Runner | null> = {
  mock: (binding) => { /* ... */ },
  rest: (binding) => pollRest(binding),
  mqtt: (binding) => pollMqtt(binding),   // ← 新增
  // ...
};
```

### 字段映射

优先按绑定里的 `point_map`（原始点位 → 标准指标）映射；未配置时按字段别名自动识别：

| 采集平台字段 | 标准指标 |
| --- | --- |
| `power` / `power_w` / `watts` | `power_w` |
| `temp` / `temperature` | `temp_c` |
| `on` / `off` / `switch` / `power_state` | `on_off` |
| `status` / `state` | `status` |
| `rpm` / `fan_rpm` | `rpm` |
| `current` / `amp` | `current_a` |
| `voltage` | `voltage_v` |

### 断链兜底

连续失败时保留最后一帧并标记 `bad`（面板显示「链路异常」，3D 指示灯转红），
超过 8 秒无新帧自动降级为 `stale`。**绝不静默显示假数据。**

---

## 五、3D 机柜查看模块（企划 M2）

### 建模规则（全部为规则化程序建模，无需外部模型）

| 配置属性 | 3D 映射 |
| --- | --- |
| `u_height` | 设备高度 = U 数 × 44.45mm（EIA-310） |
| `is_full_depth` | 全深机箱 / 半深机箱 |
| `category` / `colour_override` | 材质基色 |
| `face` | 安装面（front / rear / both） |
| `position` | 机架内位置（内部单位，**U1 = 6**）；见下方「U 位对齐」 |
| Bayed 分组 | 多柜沿 X 轴排列，柜间距 100mm |
| 遥测状态 | 面板指示灯颜色 + 机身材质自发光 |

#### U 位对齐（易错点）

Rackula 的内部单位是「1 起算」的：**U1 对应 `position = UNITS_PER_U = 6`**，而不是 0
（见 `src/lib/utils/position.ts` 与 `collision.ts`：`U1 = UNITS_PER_U`，
设备占位 `[position, position + uHeight*6 - 1]`，柜顶上限 `height*6 + 5`）。
而 3D 机箱底板在 `y = 0`、`u=0` 刻度线也在 `y = 0`。因此换算必须减 1U：

```ts
const yBottom = (device.position / UNITS_PER_U - 1) * U_HEIGHT_M;
```

若写成 `position / UNITS_PER_U * U_HEIGHT_M`，**所有设备会整体上移 1U**：
U1 设备悬空一格、最高 U 的设备溢出柜顶（顶视图会看到「柜顶伸出两块矩形」）。
这是本项目真实踩过的坑，排查时先看顶视图有没有溢出、底视图有没有空一格。

#### 设备盒体定位基准（另一个易错点）

设备盒体比 U 槽位**矮**（`boxHeight = 机箱高 × 0.94`，留出上下散热缝），
所以定位基准必须是**盒体包围盒的底边**，而不是槽位中心：

```ts
const boxHeight = deviceHeight * 0.94;
const yBottom = (device.position / UNITS_PER_U - 1) * U_HEIGHT_M;
const yCenter = yBottom + boxHeight / 2;      // ← 以底边为基准，不是槽位中心
```

若按槽位中心对齐（`yCenter = yBottom + deviceHeight / 2`），盒体整体上浮
`deviceHeight × 0.03`（1U 约 1.3mm），看起来就是"设备浮在槽里 / 和相邻件穿模"。
柜体顶底板同理要贴在柜体**外表面**（`y = ±0.006` / `heightM ± 0.006`）：
若把 12mm 板厚嵌进柜内，最高那台设备的顶面必然与顶板互相穿插。

### 交互

- 左键拖拽旋转 / 滚轮缩放 / 右键平移
- 点击**机柜柜体**（立柱 / 顶底板）→ 整柜进入选中态：整柜轮廓 + **柜级弹窗**
  （规格 / 形态 / 设备数 / 柜内状态分布 / 柜级绑定），并同步 2D 画布的活动机柜；
  开启自动聚焦时相机推近到整柜（宽度占视窗 80%）
- 点击设备 → 轮廓 + 状态染色 + 设备弹窗；开启自动聚焦时相机推近到该设备（占屏 85%）
- **点击空白处** → 清空全部选中（含活动机柜），相机复位到「全部设备都可见」的取景
- 底部工具条：重置视角 / 侧板显隐 / 遥测着色开关 / 导出 PNG
- 顶部工具条：相机投影分段控件（正交 / 透视）、**场景主题分段控件（暗色 / 亮色）**、视角下拉、自动聚焦开关、摆放开关

### 2D ↔ 3D 选中双向同步

`selection` store（`selectedType` / `selectedRackId` / `selectedDeviceId`）是**唯一真相源**，
两个方向都往它写、也都从它读：

| 方向 | 触发 | 结果 |
| --- | --- | --- |
| 3D → 2D | 在 3D 里点机柜 / 设备 | `onSelectRack` / `onSelectDevice` 回写 `selection.selectRack()` / `selectDevice()` |
| 2D → 3D | 在 2D 画布点机柜 / 设备 | `Rack3DViewer` 的统一 sync `$effect` 读 store → 3D 整柜/设备选中 + 轮廓 + 弹窗 |
| 清空 | 任一侧点空白（2D 画布空白 / 3D 画布空白） | 3D `clearSelection()`：关闭全部弹窗、取消轮廓、他柜恢复不透明；开启自动聚焦时复位取景 |

实现要点：

```ts
// 只依赖 store 的变化；picked / pickedRack / anchor 都是 untrack 的本地副本，
// 否则"弹窗开关"会反过来触发这个 effect，形成回环。
$effect(() => {
  const type = selection.selectedType;
  const deviceId = selection.selectedDeviceId ?? null;
  const rackId = selection.selectedRackId ?? null;
  void sceneToken;                       // 控制器重建后要重放
  untrack(() => { /* device → rack → 无选中 三分支 */ });
});
```

> ⚠️ 3D 内点空白时，`onSelectRack(null)` 必须**无条件**清 `layoutStore.activeRackId`。
> 若只在 `rackId` 为真时才写，3D 高亮会残留上一个机柜。

> ⚠️ **自动聚焦的判断依据只能取 `selection` store，不能把 `layoutStore.activeRackId`
> 或 `pickedRack` 算进去。**
> `activeRackId` 是「侧栏活动机柜」语义——2D 画布点空白走的是
> `selection.clearSelection()`，它**只清选中态、不会清 activeRackId**。
> 早先的 key 写成 `selectedDeviceId | pickedRack | activeRackId`，于是
> 「2D 画布点空白 → 相机复位到全场景 → key 仍解析出机柜 → 又 `focusRack()` 跳回去」，
> 表现正是*复位后立刻跳回来聚焦*。
> 现在 key 只由 `selectedDeviceId` / `selectedRackId` 组成：
> 这两个 id 在 `clearSelection()` 里必被清空，因此无选中时天然不会误触发；
> 而 3D 内点选本来就会回写 `selection`，功能不受影响。

> ⚠️ **多柜场景下"只有第一个机柜能点中"的根因**：
> `THREE.Raycaster.params.Line.threshold` 默认是 **1 个世界单位**，而本场景整排机柜
> 也只约 1m 宽——于是 U 位刻度线、线框叠加层的"射线-线段"判定几乎全屏误命中。
> 再叠加"先命中的机柜就 `break`"的旧循环，第一个机柜只要被擦到就永远独占选中。
> 修法两条一起上：① `Line.threshold` 降到 `0.004`、`Points.threshold` 降到 `0.01`；
> ② 拾取改为 `hitTestRacks()`——**对每个机柜单独取最近命中，再全局比距离**，
> 并把纯装饰的 `Line` 对象整体排除在拾取之外。

### 相机与视角

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 投影 | **正交** | 工程读数优先，无近大远小畸变；可切透视用于观感 |
| 视角 | **默认视图（斜视）** | 下拉可切 正视图 / 侧视图 / 顶视图 |

**取景填充比**（`frameBox(box, fill)`）——`fill` 是目标在"视窗较吃紧的那一维"上占的比例：

| 场景 | 常量 | 值 |
| --- | --- | --- |
| 聚焦机柜 | `FRAME_FILL_RACK` | `0.8` |
| 聚焦设备 | `FRAME_FILL_DEVICE` | `0.85` |
| 全场景（视角预设 / 重置视角 / 清空选中） | `FRAME_FILL_SCENE` | `0.8` |

> 全场景取景的包围盒横跨**整排机柜的总宽**（`sceneWidth` 含柜间距），
> 因此 `0.8` 的实际观感就是需求里的"所有机柜的宽度占视窗 80%"。
> 早期取 0.88 会明显偏小（四周留白过多）。

> ⚠️ 视口是**竖长条**（宽高比 ≈ 0.56）时机柜/设备都是横向更吃紧，
> 所以实际表现就是"宽度占 80% / 85%"；横长视口下同一套参数会变成高度受限，
> 这是几何约束，不是取景算法的问题。

- 两套相机（`perspectiveCamera` / `orthoCamera`）常驻，切换时按当前 FOV
  反推 `halfHeight` 并重新取景，**保证构图不跳变**。
  切换相机必须**重建 `OrbitControls`**（它绑定在相机实例上）并释放旧实例。
- 视角预设各对应一个单位方向向量，取景用**支撑函数投影**
  （`extentOn(axis) = Σ|half_i · axis_i|`，即包围盒在相机三轴上的半投影），
  比包围球更贴合正交视角，避免顶 / 侧视图溢出或过小。
- ⚠️ 带 `direction` 取景时**必须当帧重算相机三轴**（worldUp × forward），
  不能读 `camera.matrixWorld`——那是上一帧的姿态，会导致除斜视外全部取景失准。

### 选中轮廓（Selection Outline：深度/ID 遮罩 + 合并通道）

实现是**三段式后处理**，不是外扩的 `EdgesGeometry` 线框：

1. **主通道** → `sceneRT`：整个场景（颜色 + `DepthTexture`）；
2. **遮罩通道** → `maskRT`：只把选中对象（或其整个机柜）标到 `MASK_LAYER`，
   用白色 `overrideMaterial` 渲一遍（颜色 + 独立 `DepthTexture`）；
3. **合并通道**：全屏四边形同时采样两张颜色与两张深度：
   - **轮廓环** = 对"选中物体大范围覆盖"做 5×5 邻域膨胀，再扣掉本体覆盖区；
   - **可见性** = 遮罩非空 **且** 场景深度 ≈ 遮罩深度
     （主通道里选中物体本身也参与渲染，所以"自己就是最前面那个面"等价于可见，
     场景深度更近则说明被前面的几何体挡住）。
     半透明件不写深度，因此不会把轮廓挡掉，与"透视模式能看穿柜体"的观感一致。

这样做的收益正是需求里说的两点：轮廓**屏幕空间等宽**（不受物体远近影响），
且**会被前方几何体正确遮挡**。

> ⚠️ **合并通道必须做 linear→sRGB 输出编码，否则整场景偏暗约 4×**。`sceneRT`/`maskRT`
> 是渲染目标，纹理默认**线性空间**；three.js 只会对"直渲到 canvas 的材质"自动套
> `renderer.outputColorSpace`（sRGB）解码，**不会对 RT 纹理做这一步**。合并通道的
> `ShaderMaterial` 是后处理、直写 `gl_FragColor` 到 canvas，若不在片元末尾写
> `#include <colorspace_fragment>`，浏览器就把线性值当成 sRGB 显示 → 背景/地面/
> 一切颜色都严重偏暗（如 `#191a21` 实际显示 ≈ `#050507`，`#31343f` ≈ `#080a0d`）。
> 现象就是"颜色怎么调都还是很黑"。修法：在 `gl_FragColor = ...;` 之后、`}` 之前加
> `#include <colorspace_fragment>`（见 `buildPostPipeline()` 的 composite 片元）。
> 改主题色/调亮前务必确认此步已就位。
> ⚠️ **composite 片元里的 GLSL `//` 注释绝不能带反引号**：误写 `` `#include <colorspace_fragment>` ``
> 会提前闭合 JS 模板字符串，导致整文件 1527 报错、Vite 500。写 `#include` 注释时不要加反引号。

#### 遮挡段弱化（不是直接抹掉）

需求是"被遮挡的部分也要显示一些，但弱于未被遮挡的部分"，所以合并通道做了**两次膨胀**：

```glsl
// visDil：邻域内是否有"露出来的"选中面
// occDil：邻域内是否有选中面（无论露没露出来）
float ringVisible  = visDil * (1.0 - occupied);   // 露出来的那一段
float ringOccluded = occDil * (1.0 - occupied);   // 被挡住的那一段
float strength = ringVisible >= 0.5 ? uAlpha : uOccludedAlpha;
```

| uniform | 含义 | 值 |
| --- | --- | --- |
| `uAlpha` | 未被遮挡的轮廓强度 | `0.92` |
| `uOccludedAlpha` | 被遮挡的轮廓强度 | `0.45` |

> ⚠️ 遮挡强度**不能取得太低**：低于 ~0.4 时，混色结果叠在深色柜体/背景上会退化成
> 几乎不可见的暗红（连"这是选中色"都看不出来），失去"提示方位"的意义。
> 0.45 既能稳定辨认为选中色，又只有满强度的一半左右。

> ⚠️ 不要把轮廓环的判定写成"环像素处的场景深度比较"。
> 那样只会在**被遮挡物边缘之外**留下一条浮空的轮廓线：设备贴着柜体前沿时，
> 膨胀出来的环会越过顶板边缘伸到背景上（背景深度远 → 判定"没被挡" → 按满强度画出来），
> 顶视图就会看到柜体外侧浮着一条粉色直线。先按**覆盖**膨胀得到环，再用**可见性**
> 决定这一段该用满强度还是弱强度，才是干净的。

> ⚠️ 合并通道要采样**深度纹理**，所以两个渲染目标都配了 `DepthTexture`；
> 若驱动/版本组合下多重采样渲染目标的深度解析不生效（读出来恒为 0），
> 遮挡判定会整体失效。`tools/rack3d-verify-v3.mjs` 的 **E 断言**就是这条的回归保险。

### 状态染色

- 高光/轮廓跟随 `selection` store 的选中真值（2D / 3D 共享），**不跟随弹窗**，
  关闭数据卡片后轮廓仍在。
- 状态染色：机身材质从基色向状态色按 `STATUS_TINTS` 强度插值，**每帧从基色出发**，
  避免多帧叠加漂移。强度：正常 `0.35` / 告警 `0.62` / 严重 `0.72` / 离线 `0.65`。
- 机身材质存**两级颜色**，缺一不可：
  - `userData.dataColour` = 数据里的原始基色（**不随主题变**）；
  - `userData.baseColour` = 当前主题下的机身色（由 `dataColour` 灰度化 + 明度收敛得到）。

  切主题时从 `dataColour` 重新折算 `baseColour`，再重跑一次 `setDeviceStatuses()`；
  若只存 `baseColour`，切主题后颜色会被反复灰度化而逐次漂移。
- 蓝色线框只染 `userData.rackTick === true` 的 U 位刻度线；
  否则会把线框叠加层一起染成高亮色。刻度线的"非高亮色"取自当前主题
  （`THEMES[theme].tick`），**不能写死**——否则切主题后会还原成暗色主题的刻度色。


### 场景元素摆放

- 机柜与其内部设备**视为一个整体，不可在 3D 内移动**（位置仍由 2D 布局决定）。
- 可摆放基础元素：立方体 / 球体 / 桌子 / 椅子。**优先地平面交互**，
  高度摆放不是高频行为，因此拾取直接与 `Plane(y=0)` 求交。
- 摆放模式：点击元素面板选中型号 → 点击地面落地；**若射线先命中机柜则拒绝落地**
  （避免把元素塞进柜体）。拖拽时临时 `controls.enabled = false`，
  且 `pointerdown/move/up` 监听**注册在 OrbitControls 之前**，否则轨道会抢事件。
- 选中元素显示浮动条：8 色调色板改色 + 删除。元素持久化在
  `localStorage: rack3d_scene_props`。

### 渲染模式（三档，工具条上方分段控件）

| 模式 | 表现 | 用途 |
| --- | --- | --- |
| 实体 `solid` | 默认实体渲染，线框层隐藏 | 日常查看 |
| 线框 `wireframe` | 叠加蓝色线框（cyan `#8be9fd`，`opacity 0.5` + `AdditiveBlending` 叠加发光），材质保持实体 | 看清轮廓与结构 |
| 透视 `xray` | 叠加蓝色线框 + 机柜框架透明度降至 `0.2`、侧板 `0.08` | 看穿柜体，点选内部设备 |

透视模式下射线拾取会**跳过半透明件继续往后找**，因此能直接点中柜内设备；
命中「不透明且不属于任何设备」的物体（立柱、顶底板）则视为遮挡并停止。

线框叠加层（`wireGroup` / `wireMaterials`）的 `LineBasicMaterial` 设 `opacity = 0.5` +
`blending = AdditiveBlending`（叠加）：蓝色线框在实体之上呈"发光式"叠绘，而非普通半透明压暗。
`AdditiveBlending` 在 three.js 枚举值为 `2`（`NormalBlending = 1`），`applyTheme()` 只改色不改混合模式。

> ⚠️ **地面必须是无光材质 `MeshBasicMaterial`，不能用 `MeshStandardMaterial`。**
> 早期地面用 `MeshStandardMaterial`（受场景灯光影响），切视角/切主题时地面亮度会随打光忽明忽暗，
> 与"地面色 == 背景色"的恒定观感冲突。改成 `MeshBasicMaterial` 后颜色只由主题决定，
> `applyTheme()` 里 `this.floor.material.color.setHex(p.floor)` 仍生效（基类 `Material.color` 不变）。

透明度由 `applyRackOpacity()` **统一按「渲染模式 + 是否选中了别的机柜」计算**：
选中某个机柜时，其余机柜框架压到 `0.18`、侧板 `0.06` 且 `depthWrite = false`
（突出当前关注对象，同时不让它们挡住轮廓判定）。这层归并是必要的——
否则「切渲染模式」会覆盖掉「他柜压暗」，反之亦然。

### 场景主题（黑 / 白，工具条分段控件）

一键切换整套三维场景观感，**只改颜色与打光，不重建几何**
（`setSceneTheme()` → `applyTheme()`）。配色风格对齐参考图「Future Smart Campus」：
低彩度、明亮、影子很软，机身做灰度化，只保留状态色承担语义。

> **场景刻意不使用雾（`scene.fog = null`）**。
> 本场景整体只有 ~1 米见方，任何有意义的 `fog near/far` 都会把机柜"洗"成背景色：
> 暗色主题下等于给模型整体压暗，亮色主题下则把它冲淡。纵深层次改由
> 地面网格 + 光照方向表达。实测去掉雾 + 强化半球光后，
> **暗色主题机身面板平均亮度 65.9 → 103.7（+57%）**、全模型平均亮度 53.3 → 86.8（+63%）。

| 项 | 暗色 `dark`（默认） | 亮色 `light` |
| --- | --- | --- |
| 视口背景（无雾） | `#191a21` | `#e9e9e9` |
| 地面底板 | `#191a21`（== 背景） | `#e9e9e9`（== 背景） |
| 网格 主线 / 次线 / 不透明度 | `#4a5364` / `#2f3644` / `0.3` | `#a4acb7` / `#c5cbd3` / `0.3` |
| 机柜框架 | `#828c99` | `#b2bac4` |
| 侧板 | `#39404c`（opacity `0.32`） | `#d6dbe2`（opacity `0.55`） |
| U 位刻度线 | `#4b5361` | `#c0c7d0` |
| 线框叠加层 | `#8be9fd` | `#0e7490` |
| 面板凹槽 / 灯座 | `#1b1f27` / `#2a2f3a` | `#7c848e` / `#9aa2ac` |
| 环境光 / 半球光 / 主光 / 补光（强度） | `0.72` / `2.8` / `2.2` / `1.45` | `1.0` / `2.3` / `1.9` / `1.0` |
| 半球光 天空色 / 地面色 | `#e6edfa` / `#59626f` | `#ffffff` / `#ced3da` |
| 机身灰度化 / 明度基准 | `0.85` / `0.72` | `0.88` / `0.88` |
| 框架金属度 / 粗糙度 | `0.35` / `0.6` | `0.06` / `0.82` |
| 机身金属度 / 粗糙度 | `0.12` / `0.6` | `0.04` / `0.62` |

主题选择持久化在 `localStorage: rack3d_scene_theme`（`view.svelte.ts`）。

> ⚠️ **半球光是"照亮暗部"的主力，比继续堆方向光有效得多。**
> 方向光只能照亮迎光面，背光面/底面会留死黑；`HemisphereLight` 用天空色照朝上的面、
> 用**地面色**照朝下与背光的面，能整体托起模型的暗部。
> 所以它的 `groundColor` 不能设得太暗——旧值 `#2b313c` 几乎等于"再压一层暗"，
> 现已提到 `#59626f`。

> ⚠️ **金属度必须由主题决定，不能写死在材质里。**
> three.js 的 `MeshStandardMaterial` 在**没有环境贴图**时，金属度越高漫反射越少、
> 镜面又无处可反射 → 直接渲染成近黑。这正是早期"整场景太暗"的主因。
> 只调光强是治标不治本；**降低金属度**才是提亮材质的根本手段。
> 早期暗色主题保留 `0.65` 是为了"近黑金属"的观感，但代价是整体发闷；
> 现已降到 `0.35`（框架）/ `0.12`（机身），亮色主题更低（`0.06` / `0.04`）。

> ⚠️ `applyTheme()` 必须能**完整复原**受主题影响的每一层状态：
> 灯光/地面/网格/框架/侧板/线框/面板凹槽/灯座/机身颜色，
> 以及**活动机柜高亮**（`setActiveRack(this.activeRackId)`）
> 和**遥测状态染色**（`setDeviceStatuses(this.lastStatuses)`）。
> 因此 `setActiveRack()` 要记住 `activeRackId`、`setDeviceStatuses()` 要记住 `lastStatuses`，
> 否则切主题会把高亮与状态一起弄丢。
> 另外 `setRacks()` 重建场景后也要调一次 `applyTheme()`——
> `applyTheme()` 只在构造期被 `buildEnvironment()` 调过，新建的材质不会自动套主题。

> ⚠️ 亮色主题下视口内的浮层（元素面板 / 提示 / 图例）也要一起提亮
> （`.rack3d-viewport.scene-light`），否则深色半透明浮层压在浅色场景上又脏又糊，
> 深色文字（`--colour-text` 是浅色）在白色浮层上还会直接看不见。

### 三维内的二维数据卡片

- 锚点：设备**顶部前缘**（`deviceAnchors`），每帧用 `Vector3.project(camera)` 投影成画布 CSS 像素。
- 位置**在引擎侧夹取到视口内**，锚点上方空间不足时置 `flip = true`，卡片翻到设备下方。
  否则靠近边缘的设备会把卡片顶出面板，被 `.rack3d-panel` 的 `overflow: hidden` 裁掉。
- 内容：状态点 + 名称 + 机型/U 高/安装面/所属机柜 + 链路状态与数据质量徽标 + 绑定指标明细。
  明细改为**行式布局**（左粗标签 / 右对齐数值），并附：
  第一个数值指标的**进度条**（宽度 = 当前值 / 阈值满量程）、
  第一个攒够 ≥2 个采样点的指标的 **SVG 折线图**（宽度 200 / 高 40）。
- 折线数据来自遥测 store 的**环形缓冲** `history`（每资产每指标保留最近 48 点，
  `HISTORY_LIMIT = 48`；数值指标在 `commitFrame` 时入队）。
- **未绑定的设备显示提示文案，绝不显示假数据。**
- 组件侧用 `onFrame` 回调 + `>0.5px` 阈值过滤，避免每帧触发 Svelte 更新。

### 配色（与设计系统统一）

面板边框 `--colour-border`、标题 `--colour-text`、关闭按钮 `--colour-text-muted`（悬停转
`--colour-text`）、工具条按钮 `--button-bg`、选中态 `--colour-selection`。
**不使用告警红** —— 红色只保留给「严重」状态与链路异常徽标，避免与状态语义混淆。

### 状态色

| 状态 | 色值 |
| --- | --- |
| 正常 | `#3ddc84` |
| 告警 | `#e0b341` |
| 严重 | `#e05252` |
| 离线 | `#6b7280` |
| 未接入 | `#5a6478` |

---

## 六、对上游文件的最小改动清单

改动全部为"接入点"，逻辑均在 Rack3D 命名空间内：

| 文件 | 改动 |
| --- | --- |
| `src/main.ts` | 挂载后调用 `initI18n()`（+2 行） |
| `src/App.svelte` | 引入并挂载 `Rack3DViewer` + `3D` 启动角标 + 样式 |
| `src/lib/stores/ui.svelte.ts` | `SidePanelTab` 增加 `"telemetry"` 及校验 |
| `src/lib/components/SidePanel.svelte` | 三页签标签/焦点映射 |
| `src/lib/components/SidePanelContent.svelte` | 新增 Telemetry 页签 Trigger 与 Content |
| `package.json` | 增加 `three`、`@types/three` |

---

## 七、上游同步策略

```bash
git remote add upstream https://github.com/RackulaLives/Rackula.git   # 若可直连
git fetch upstream && git rebase upstream/main
```

Rack3D 代码集中在 4 个自有目录，上游冲突面仅限上表 6 处接入点，季度评估一次即可。
