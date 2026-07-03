# Plan: WallpaperAI Desktop — 动态壁纸层（区域级实时换图）

- **状态**: Draft v3（锁定决策 + 加快捷键交互 + Mac/Windows 协作工作流）
- **作者**: iris
- **日期**: 2026-07-03
- **关联分支**: 当前 `codex/learning-langgraph-foundations-v1`；建议分叉 `desktop/dynamic-layer-v1`
- **决策记录**（已锁定）:
  - 产品形态 = **动态壁纸层**：Electron 窗口嵌入桌面图标层**之后**，整屏铺满
  - 核心 = 用现有 Fabric 编辑器引擎，按模板裁出多个区域，**区域级实时换图**
  - 切换触发 = **手动（托盘/编辑器/快捷键）+ 定时（每区域独立轮换）**
  - 选图来源 = **AI 推荐（复用 generateLayouts）+ 本地素材库**
  - 仓库形态 = **同仓 monorepo**（pnpm workspace）
  - WorkerW 嵌入 = **直接用 `electron-as-wallpaper` 包**，定制需求再 fork
  - AI swap 语义 = **先整组 candidate 取目标 slot**（零改 prompt 快速跑通）
  - 壁纸层交互 = **全局快捷键 + 焦点模式**（详见 §5.5）
  - renderer = **wallpaper 层用 Vite+React**（不需要 Next 路由）；editor 沿用 Next
  - 开发环境 = **Mac 主力开发 + Windows 验证机**（详见 §12）

---

## 0. 为什么推翻 v1

v1 的方案是"渲染一张 PNG → 调 Win32 `IDesktopWallpaper` 设静态背景"。**这与作者需求不符**：

- ❌ 静态壁纸：换一个区域必须整张重渲染再设壁纸，不实时、不可单独换区域。
- ✅ 作者要的：一个**活的渲染层**嵌在桌面图标后面，里面是真正的 Fabric 画布，每个区域是独立对象，调 API 可单独换图、实时刷新。

这是 **Wallpaper Engine / Lively Wallpaper** 形态，不是换图软件形态。技术路径完全不同：从"设壁纸文件"换成"**WorkerW 窗口嵌入**"。

---

## 1. 目标与非目标

### 1.1 目标
1. **动态壁纸层**：Electron 窗口 reparent 到 Windows `WorkerW`，铺满桌面图标层之后。
2. **区域化布局**：复用现有 `WALLPAPER_TEMPLATES`（triptych / moodboard / collage），每个 slot 是独立 Fabric 对象。
3. **区域级实时换图**：通过 IPC/API 单独换某个 slot 的图，无需重渲整张，无闪烁。
4. **混合触发**：托盘/编辑器手动换 + 每 slot 独立定时轮换。
5. **混合选图**：本地素材库轮换 + AI 推荐（复用 `generateLayouts` 按 slot role 挑图）。
6. **共享核心**：`lib/layout*` / `lib/layout-generation/*` / `lib/fabric/*` 抽成 `@wallpaper/core`，web 与 desktop 共享。

### 1.2 非目标
- macOS / Linux 桌面层嵌入（结构预留跨平台接口，本期只做 Windows）。
- 视频/GIF/Shader 壁纸（Lively 那种）——我们专注"可换图的静态照片拼贴"。
- 锁屏壁纸、移动端、账号/付费。
- 外部 HTTP/WebSocket API 触发（作者未选；预留接口位，不实现）。

---

## 2. 现状盘点 → 区域级换图的天然契合点

| 现有代码 | 区域级换图里的角色 |
|---|---|
| `lib/layout/templates.ts`（`WALLPAPER_TEMPLATES`，desktop 模板含 triptych/moodboard/collage，每个 template 含 `slots[]` 带 `role`） | ✅ **就是"特殊框架裁剪布局"**，直接用 |
| `lib/fabric/applyLayout.ts` → `createLayoutImage` 为每个 item 生成独立 `FabricImage`，挂 `slotId`/`assetId`/`objectId` | ✅ **每个 slot = 一个可寻址对象**，换图只要替换这一个对象 |
| `lib/layout/swap.ts` → `swapLayoutItemAssets`（含 crop 重计算） | ✅ **换图逻辑现成**，扩展为"换入新 asset"而非只交换两个现有 item |
| `lib/fabric/layoutGeometry.ts`、`crop.ts` | ✅ 复用，几何/裁剪不变 |
| `lib/layout-generation/generateLayouts` + `generationFallback`（本地兜底）+ `openAiCompatibleProvider` | ✅ 选图来源 1：AI 推荐复用 |
| `lib/storage/projectDatabase.ts`（IndexedDB） | 🟡 renderer 内继续用做素材库；主进程加 SQLite 做轮换计划/历史 |
| `lib/fabric/exportCanvas.ts`（导 PNG） | 🟡 动态层场景**不再需要导出设壁纸**，但保留用于"快照分享" |
| `app/api/*`（Next Route Handler） | 🔄 改 Electron `ipcMain.handle`，签名照搬 |
| **WorkerW 嵌入 / 托盘 / 多显示器 / 桌面层渲染** | ❌ **全新**，本期主战场 |

**结论**：区域级实时换图的"内容侧"你**几乎全有**。新增工作 90% 在 Windows 桌面层集成。

---

## 3. 目标架构

```
wallpaper-ai/                          ← 现有 web 项目（继续维护）
└── packages/
    └── core/                          ← P0 抽出，web + desktop 共享
        └── src/{layout,layout-generation,wallpaper,image,fabric}/

wallpaper-ai-desktop/                  ← 桌面动态壁纸层（新仓库 / 或 monorepo apps/desktop）
├── electron/
│   ├── main/
│   │   ├── index.ts                   ← 生命周期、托盘、自启、单实例锁
│   │   ├── desktop-layer.ts           ← ★ WorkerW 嵌入核心（新写）
│   │   ├── display-manager.ts         ← ★ 多显示器：每屏一个 wallpaper window（新写）
│   │   ├── wallpaper-window.ts        ← 每个 wallpaper window 的 BrowserWindow 工厂（新写）
│   │   ├── swap-engine.ts             ← ★ 区域级轮换调度（新写）
│   │   ├── ipc/
│   │   │   ├── layout.ts              ← 复用 handleGenerateLayoutRequestAsync
│   │   │   └── swap.ts                ← ★ swapSlot(slotId, assetId?) IPC（新写）
│   │   ├── settings/                  ← LLM key（safeStorage）、每 slot 轮换计划
│   │   └── storage/                   ← SQLite：rotation_rules、wallpaper_history、asset_index
│   └── preload/
│       └── index.ts                   ← contextBridge：swapSlot / nextForSlot / pauseSlot
├── wallpaper-renderer/                ← 跑在桌面层的精简 renderer（无编辑器 chrome）
│   ├── pages/wallpaper.tsx            ← 全屏 Fabric canvas，监听 IPC 触发 swap
│   ├── hooks/useWallpaperLayout.ts    ← applyLayoutToCanvas + 实时 swap 订阅
│   └── lib/ → @wallpaper/core
├── editor-window/                     ← 独立的可视化编辑/管理窗口（从现有 editor 抽）
│   └── （现有 components/editor/* 迁入）
└── packaging/                         ← electron-builder、.ico、NSIS
```

### 3.1 三个窗口的职责
| 窗口 | 数量 | 角色 | 可见性 |
|---|---|---|---|
| **wallpaper window** | 每显示器 1 个 | 跑 Fabric canvas，嵌到 WorkerW，渲染壁纸层 | 桌面图标后面 |
| **editor window** | 0 或 1 | 现有编辑器：管理模板/素材/计划，预览 | 用户主动打开 |
| **tray** | 1 | 托盘菜单：手动换某 slot、暂停、打开编辑器、退出 | 系统托盘 |

> 关键设计：**wallpaper window 与 editor window 共享同一份 layout state**（通过主进程 SQLite + IPC 广播）。editor 改了，wallpaper 实时同步；tray 点"换 hero"，主进程推送给 wallpaper window 执行 swap。

---

## 4. 新写核心一：桌面层嵌入（WorkerW）

这是与 v1 的根本区别，是"动态层"成立的前提。

### 4.1 嵌入流程（`desktop-layer.ts`）
```
1. app.whenReady() → 创建 wallpaper BrowserWindow（frame:false, transparent 可选, skipTaskbar:true）
2. 用 koffi/原生 addon 调 user32：
   a. FindWindowW("Progman", null) 拿 Progman 句柄
   b. SendMessageTimeoutW(progman, 0x052C, 0, 0, ...) 触发 Progman 生成 WorkerW
   c. EnumWindows 枚举，找到 Progman 之后那个 WorkerW（含 SHELLDLL_DefView 的兄弟）
   d. SetParent(wallpaperHwnd, workerWHwnd)  ← 把壁纸窗口塞进桌面层
3. 调整 wallpaper window 尺寸 = 该显示器物理分辨率，覆盖整屏
```

### 4.2 实现选型（推荐 koffi）
| 方案 | 优 | 劣 |
|---|---|---|
| **koffi**（纯 JS FFI，推荐） | 无编译、跨发行简单、调 user32 直接 | FFI 调用稍慢（桌面层操作低频，可接受） |
| Rust addon（`windows` crate） | 性能好、类型安全 | 要 Rust 工具链、跨编译 |
| C++ N-API | 最原生 | 编译分发复杂 |

> 建议先用 koffi 跑通单屏，性能/稳定性不够再上 Rust。可参考现成包 [`electron-as-wallpaper`](https://npmx.dev/package/electron-as-wallpaper)（已封装 WorkerW + 鼠标键盘转发）。

### 4.3 已知坑（务必处理）
- **Win11 24H2**：切壁纸/主题会让 WorkerW 被销毁，parent-child 断裂 → 监听 `WM_SETTINGCHANGE`/主题事件，**检测到 WorkerW 失效就重新嵌入**。
- **鼠标穿透**：壁纸层在图标后面时，桌面图标点击要正常 → 默认 `setIgnoreMouseEvents(true)` 让点击穿透到图标；需要交互时（如点 slot 换图）临时打开。
- **多显示器**：每个显示器独立 WorkerW/SHELLDLL_DefView 结构 → `display-manager.ts` 每屏建一个 wallpaper window。
- **DPI/缩放**：用 `screen.getAllDisplays()` 的 `scaleFactor`，BrowserWindow 尺寸用物理像素，Fabric canvas 同步物理像素避免糊。

---

## 5. 新写核心二：区域级实时换图（swap-engine）

这是产品的灵魂，也是"区域级"三个字的实现。

### 5.1 数据模型（SQLite）
```sql
-- 每个 wallpaper window（每显示器）当前应用的 layout
CREATE TABLE active_layout (
  display_id TEXT PRIMARY KEY,
  template_id TEXT,
  layout_json TEXT,           -- WallpaperLayout（含每个 item 的 slotId/assetId/crop）
  updated_at INTEGER
);

-- 每个 slot 的轮换计划
CREATE TABLE rotation_rules (
  display_id TEXT,
  slot_id TEXT,
  mode TEXT,                  -- 'off' | 'interval' | 'ai'
  interval_seconds INTEGER,   -- mode=interval 时
  pool TEXT,                  -- 'local' | 'ai'，配合作者选的"本地素材库 + AI 推荐"
  last_swap_at INTEGER,
  next_swap_at INTEGER,
  PRIMARY KEY (display_id, slot_id)
);

-- 本地素材索引（renderer 的 IndexedDB 之外的 source of truth）
CREATE TABLE asset_index (
  id TEXT PRIMARY KEY, file_path TEXT, width INTEGER, height INTEGER,
  analysis_json TEXT,         -- 复用 lib/image/analyzeImage 的结果
  added_at INTEGER
);

CREATE TABLE wallpaper_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_id TEXT, slot_id TEXT, asset_id TEXT, swapped_at INTEGER, source TEXT
);
```

### 5.2 换图执行链（单 slot）
```
swapSlot(displayId, slotId, candidateAssetId?) :
  1. 主进程读 active_layout[displayId]
  2. 若未指定 candidateAssetId：
     - pool=local → 从 asset_index 按该 slot 的 role 选一张（避免重复最近 N 张）
     - pool=ai → 调 core.generateLayouts({ operation:'swap-item', currentLayout, slotId })
                 复用现有 AI 排版，按 slot role（hero/support/background）挑合适图
  3. 复用 core.swapLayoutItemAssets 的 crop 重算逻辑，得到新 item
  4. 写回 active_layout，广播 IPC 'layout:patched' { slotId, newItem }
  5. wallpaper renderer 收到 → 在 Fabric canvas 上仅替换该 slot 对应的 FabricImage 对象
     （canvas.remove(oldObj); canvas.add(newImg); canvas.requestRenderAll()）
  6. 写 wallpaper_history
```

> **关键：第 5 步只替换单个 Fabric 对象，不整张重渲**——这就是"实时、无闪烁"的来源。Fabric 的对象模型天然支持，无需额外魔法。

### 5.3 触发来源（对齐作者选择）
| 触发 | 入口 | 实现 |
|---|---|---|
| **手动 - 快捷键** | `Ctrl+Alt+N` 换焦点 slot 等 | `globalShortcut` → `ipc.swapSlot` |
| **手动 - 焦点模式点选** | 按住 Alt 点某 slot | wallpaper renderer → `ipc.swapSlot` |
| **手动 - 托盘** | 托盘菜单动态生成每个 slot（"换 hero"/"换 support_left"…） | tray menu → `ipc.swapSlot` |
| **手动 - 编辑器** | editor window 里点某 slot → "换一张" | editor → `ipc.swapSlot` |
| **定时 - 每 slot 独立** | `rotation_rules` 每 slot 自己的 interval | 主进程 `setInterval` 按 slot 调度，到点自动 swap |

### 5.4 AI 选图复用要点
现有 `generateLayouts` 返回的是**整组 candidate layout**。区域级换图时需要"只换一个 slot"的语义：
- **方案 A**：复用 `AiLayoutOperation = 'swap-item'`（你的 `aiPlanSchema` 已有 operation 概念），prompt 改为"在给定 layout 里，为 slot X 选一张最合适的图"，返回单个 item patch。
- **方案 B（已选，先用）**：让 AI 返回整组新 candidate，主进程只取目标 slot 的 item 应用。零改 prompt，快速跑通；P5 再做方案 A 省 token。
- 兜底：未配 LLM key 时，按 slot role + asset analysis（`dominantColors`/`bestUse`）本地规则选。

### 5.5 快捷键交互（壁纸层主要交互方式）

壁纸层默认鼠标穿透（点击落到桌面图标），所以**快捷键是主要交互入口**，托盘/编辑器为辅。

#### 全局快捷键（`globalShortcut`，应用未聚焦也生效）
| 快捷键 | 动作 | 说明 |
|---|---|---|
| `Ctrl+Alt+N` | 换当前焦点 slot 的下一张 | 最常用，"再来一张" |
| `Ctrl+Alt+Shift+N` | 换**所有** slot | 整组刷新 |
| `Ctrl+Alt+1..9` | 选中第 N 个 slot 为焦点 | 配合上面的换图 |
| `Ctrl+Alt+L` | 锁定/解锁当前 slot | 锁定的 slot 不参与定时轮换 |
| `Ctrl+Alt+E` | 打开编辑器窗口 | |
| `Ctrl+Alt+,` | 打开设置 | |
| `Ctrl+Alt+P` | 暂停/恢复所有轮换 | |

> 用 `globalShortcut.register`，应用退出时 `unregister` 全部。冲突时引导用户在设置里改键（Electron `globalShortcut` 不支持录音捕获，需在设置 UI 让用户手填）。

#### 焦点模式（局部，仅壁纸层窗口聚焦时）
默认壁纸层 `setIgnoreMouseEvents(true)` 穿透。按住 `Alt`（或托盘"交互模式"）临时进入焦点模式：
- `setIgnoreMouseEvents(false)` + 给 wallpaper window 短暂焦点
- 鼠标 hover 高亮当前 slot，**点击该 slot 直接换图**（"指哪换哪"）
- 松开 `Alt` 或 3 秒无操作 → 回到穿透

> 实现要点：用 `BrowserWindow.setIgnoreMouseEvents(true, { forward: true })` 让 mousemove 仍能转发（用于 hover 高亮），点击才穿透。

#### 快捷键冲突与可发现性
- 首次启动在托盘气泡提示主快捷键。
- 设置面板可视化列出所有快捷键 + 改键 + 冲突检测（`globalShortcut.register` 返回 false 即冲突）。
- 所有快捷键动作都同时在托盘菜单有对应项（照顾不爱记快捷键的用户）。

---

## 6. AI 后端混合策略（与作者"本地兜底 + 可选 LLM"一致）

| 档位 | 条件 | 调用 |
|---|---|---|
| 离线本地规则（默认） | 未配 key | `generateMockLayouts` + slot role 本地匹配 |
| 直连 LLM | 设置填 key | `handleGenerateLayoutRequestAsync` + `openAiCompatibleProvider` |
| LangGraph sidecar（高级，默认关） | 设置启用 | `startLangGraphSession`/`approveLangGraphSession` |

- LLM key 用 Electron `safeStorage` 加密落盘，注入 `loadLayoutModelConfig(environment)`。
- 现有 `findUnsupportedPayloadFields` 已防原图/key 入 prompt，桌面端继续生效。

---

## 7. 分阶段路线（P0 → P6）

| 阶段 | 目标 | 验收 | 预估 |
|---|---|---|---|
| **P0 抽 core 包** | `lib/{layout,layout-generation,wallpaper,image,fabric}` → `packages/core`；web 改引用；`npm test`+`typecheck` 全绿 | web 零回归 | 0.5–1 天 |
| **P1 Electron 壳 + WorkerW 嵌入 PoC** | 新仓；BrowserWindow 用 koffi 嵌到 WorkerW；桌面层显示一个静态 Fabric 三联画 | 关掉窗口，桌面图标后面能看到画面 | 2–3 天 |
| **P2 区域级换图打通** | `ipc.swap.ts` + wallpaper renderer 监听；托盘"换 center"按钮，桌面层实时换该区域图，无闪烁 | 点按钮，只那块图变化 | 2–3 天 |
| **P3 多显示器 + 编辑器窗口** | 每屏一个 wallpaper window；editor window 可改模板/素材并实时同步到桌面层 | 双屏不同 layout；editor 改了桌面立刻变 | 3–4 天 |
| **P4 每 slot 独立定时轮换** | `rotation_rules` + 调度器；hero 每 10min、support 每 30min 各自轮换 | 不同 slot 按各自节奏换 | 2–3 天 |
| **P5 AI 选图 + 本地素材库** | 本地素材导入/索引；AI 按 slot role 推荐填入；本地兜底 | 三档切换生效 | 2–3 天 |
| **P6 打包分发** | electron-builder NSIS/MSI、签名、electron-updater；24H2 WorkerW 自愈 | 干净 Win 机器安装可用 | 2–3 天 |

> 建议 **P0→P2 优先**（约 5–7 天）拿到"桌面层三联画 + 点按钮换某区域"的可演示 Demo，这是产品成立的关键验证点。

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| WorkerW 嵌入在 24H2 不稳 | 壁纸层消失 | 监听主题/壁纸变更事件，WorkerW 失效自动重嵌；提供"普通置顶窗口"降级模式 |
| koffi FFI 在某些 Win 版本异常 | 启动失败 | 预留 Rust addon 兜底接口；CI 跑 Win10/11 矩阵 |
| Fabric 7 + Electron 新 Chromium 兼容 | 渲染异常 | 锁版本；Playwright Electron e2e 覆盖 |
| 单 slot 换图闪烁 | 体验差 | 预加载新图（`FabricImage.fromURL` await 完再 remove 旧的）；过渡用 opacity 淡入 |
| 多显示器 DPI/分辨率变化 | 错位/糊 | 监听 `display-*` 事件，动态 resize canvas；物理像素对齐 |
| 鼠标穿透与交互冲突 | 点不到图标 / 点不到 slot | 默认穿透；按住热键或托盘"交互模式"临时开启 |
| LangGraph sidecar 体积 | 安装包臃肿 | 默认不带，作为独立高级包 |
| LLM key 安全 | 泄露 | `safeStorage` 加密；不落日志（现有 payload 校验继续防原图入 prompt） |

---

## 9. 验证策略

- **单元**：core 包独立 `node --test`；保留 Pydantic/Zod parity（commit `6c66186`）。
- **smoke**：`LLM_SMOKE_TEST=1 npm run test:ai:smoke` 在桌面 CI 同样跑。
- **e2e**：
  - 编辑器复用现有 Playwright。
  - 新增 Electron e2e（`@playwright/test` + `_electron`）：嵌入成功、swapSlot 生效、多屏、定时轮换。
- **集成手测清单**（P2/P4 验收）：
  1. 启动后桌面图标后面出现三联画壁纸层。
  2. 托盘点"换 center"→ 仅中间区域图变化，无闪烁、无整屏闪。
  3. 关 editor 窗口，壁纸层仍在。
  4. 双屏各自不同模板，互不干扰。
  5. hero 每 10min、support 每 30min 分别到点自动换。
  6. 拔电源切电池 → 轮换降频或暂停。

---

## 10. 已锁定的决策

| 项 | 决策 |
|---|---|
| 仓库形态 | **同仓 monorepo**（pnpm workspace：`packages/core` + `apps/desktop` + 根 web） |
| WorkerW 实现 | **直接用 `electron-as-wallpaper` 包**（已封装好，省 P1 时间）；定制需求再 fork 或换 koffi/Rust |
| AI swap 语义 | **先方案 B**（整组 candidate 取目标 slot，零改 prompt），P5 再做方案 A 省 token |
| 壁纸层交互 | **全局快捷键为主 + 焦点模式（按 Alt 点选）+ 托盘/编辑器为辅**（详见 §5.5） |
| renderer 选型 | **wallpaper 层 Vite+React**（轻量、不需路由）；editor window 沿用 Next |
| 开发环境 | **Mac 主力开发 + Windows 验证机**（详见 §12） |

---

## 11. 下一步

如 review 通过，**立刻执行 P0**：抽 `@wallpaper/core` 共享包，保证 web 不回归。这是所有后续工作的地基。
P0 完成后进 P1（WorkerW 嵌入 PoC）——这是产品形态成立的技术验证关键点。

---

## 12. Mac 开发 + Windows 验证协作工作流

作者环境：**Mac 主力开发，手边一台 Windows 用于验证**。核心矛盾——WorkerW 嵌入、托盘设壁纸等只在 Windows 生效，Mac 跑不起来。下面工作流让 Mac 上能写 90% 代码，Windows 只负责跑那 10% 的系统集成验证。

### 12.1 原则：把"平台相关"和"平台无关"彻底分层

```
平台无关（Mac 能全写全测）          平台相关（必须 Windows 验证）
─────────────────────────         ─────────────────────────────
@wallpaper/core 全部               WorkerW 嵌入（electron-as-wallpaper）
  - layout / layout-generation     globalShortcut（Win 键位语义）
  - fabric apply/swap/crop         托盘自启（注册表/Startup）
  - image analyze                  多显示器/DPI
swap-engine 选图/调度逻辑          safeStorage（Win DPAPI）
SQLite schema + 读写                electron-builder 出 NSIS/MSI
wallpaper renderer UI              鼠标穿透/焦点模式实际行为
editor window（Next 沿用）          24H2 WorkerW 自愈
```

> 关键工程动作：把所有平台相关调用收口到一个 `desktop-platform` 接口（见 §12.4），Mac 上用 mock 实现，Windows 上用真实实现。这样 Mac 端业务逻辑全可跑。

### 12.2 Mac 上的开发循环（日常 90% 时间在这）

1. **monorepo 起本地开发**
   ```bash
   # 根目录（wallpaper-ai/）
   pnpm install
   pnpm --filter @wallpaper/core test        # 核心包测试
   pnpm --filter @wallpaper/web dev          # web 端，验证 core 抽包不回归
   pnpm --filter @wallpaper/desktop dev:mock # 桌面端 mock 模式（见下）
   ```
2. **`dev:mock` 模式**：Electron 正常起，但 `desktop-platform` 注入 mock 实现：
   - WorkerW 嵌入 → 不嵌入，wallpaper window 当普通置顶窗口显示（能看 UI 和换图效果）
   - `globalShortcut` → 改用窗口内 `Mousetrap`/React 快捷键（Mac 上 `Cmd+Alt+N` 等价验证逻辑）
   - 托盘/自启 → 跳过
   - 多显示器 → 单屏跑，逻辑用 `screen.getAllDisplays()` 假数据驱动
3. **能验证什么**：core 正确性、swap 逻辑、UI 渲染、快捷键动作分发、轮换调度、SQLite 读写、editor↔wallpaper 同步。
4. **不能验证什么**：桌面层嵌入效果、Win 快捷键全局性、托盘、安装包。

### 12.3 Windows 上的验证循环（关键节点用）

#### 一次性准备（Windows 验证机）
```powershell
# 装 Node（用 nvm-windows 或官方安装包）、git、pnpm
npm i -g pnpm
# 装 Visual Studio Build Tools（编译可能的原生模块用，含 C++ 桌面开发组件）
# 装 Git Credential Manager（可选，拉私有仓方便）
git clone <repo> C:\dev\wallpaper-ai
cd C:\dev\wallpaper-ai
pnpm install
# electron 重建原生模块（如果用了 koffi/原生 addon）
pnpm rebuild
```

#### 三种同步代码到 Windows 的方式（按频率选）

| 方式 | 适用场景 | 操作 |
|---|---|---|
| **git push/pull**（推荐日常用） | 频繁迭代 | Mac push 到分支 → Windows `git pull && pnpm install` → `pnpm dev` |
| **rsync/scp 手动同步** | 改动小、懒得提交 | `rsync -av --exclude node_modules .../ user@win-ip:/C/dev/...` |
| **VS Code Remote-SSH** | 想在 Mac 编辑器里直接跑 Windows | Mac 装 Remote-SSH，连 Windows 机器，终端在 Windows 跑 |

#### Windows 上的关键验证命令
```powershell
# 1. 真实模式启动（真正嵌桌面层）
pnpm --filter @wallpaper/desktop dev

# 2. 验证 WorkerW 嵌入是否成功
#    启动后桌面图标后面应能看到壁纸层；最小化所有窗口（Win+D）也能看到

# 3. 验证全局快捷键
#    按键时应用不能在前台 —— 切到别的窗口，再按 Ctrl+Alt+N，看是否生效

# 4. e2e（如果写了 Playwright Electron 测试）
pnpm --filter @wallpaper/desktop test:e2e

# 5. 出安装包验证
pnpm --filter @wallpaper/desktop build
# 产物在 apps/desktop/dist/，双击 .exe 安装到干净环境测
```

### 12.4 `desktop-platform` 抽象（让分层落地的关键）

```ts
// packages/desktop-platform/index.ts
export interface DesktopPlatform {
  embedToWallpaperLayer(window: BrowserWindow): Promise<void>;  // WorkerW
  isEmbedded(): boolean;
  registerGlobalShortcut(accel: string, fn: () => void): boolean;
  getDisplays(): DisplayInfo[];
  setAutoLaunch(enable: boolean): Promise<void>;
  secureStore: { get(key: string): Promise<string|null>; set(key: string, val: string): Promise<void> };
}

// apps/desktop/src/platform/mock.ts   ← Mac 用
// apps/desktop/src/platform/win32.ts  ← Windows 用（真实实现）
// 启动时按 process.platform 选择注入
```

> **好处**：Mac 上 mock 跑通所有业务逻辑，到 Windows 只是"换实现"，bug 大幅减少。

### 12.5 各阶段在两端各自做什么

| 阶段 | Mac（开发） | Windows（验证） |
|---|---|---|
| **P0 抽 core** | 全部在这里做+测 | 跑一遍 `pnpm test` 确认跨平台无原生依赖 |
| **P1 WorkerW PoC** | 写 `desktop-platform` 接口 + mock；wallpaper renderer UI | **主战场**：验证 `electron-as-wallpaper` 嵌入成功，桌面层可见 |
| **P2 区域换图** | swap-engine 全逻辑 + renderer + mock 快捷键 | 验证点按钮/快捷键换某 slot，无闪烁 |
| **P3 多屏+editor** | editor window + 同步逻辑；mock 多屏假数据 | 验证真双屏各跑各的 |
| **P4 定时轮换** | 调度器全逻辑 | 长时间挂着验证轮换到点 |
| **P5 AI 选图** | LLM key 配置、prompt、兜底 | 同（与平台无关，但顺手在 Win 验） |
| **P6 打包** | electron-builder 配置（win target） | **主战场**：出 NSIS/MSI，干净机安装，24H2 WorkerW 自愈 |

### 12.6 跨机调试小技巧
- **日志**：主进程 `electron-log` 写到 `app.getPath('logs')`，Windows 路径 `%APPDATA%\wallpaper-ai-desktop\logs\`，远程让 Windows 机器 `Get-Content` 实时贴给你。
- **DevTools**：wallpaper window 嵌入后默认无 UI，开发时在主进程给一个 `--inspect-waller` 标志临时加 DevTools（嵌入模式下 DevTools 也在桌面层，能用）。
- **快速回滚对比**：Windows 上 `git stash` / `git checkout` 切 mock/真实模式快速对比。
- **网络共享**：Mac 上 `python3 -m http.server` 临时给 Windows 拉文件，比 git push 快。

### 12.7 推荐节奏
- **平时**：Mac `dev:mock` 迭代，攒一批改动。
- **每个阶段验收点**（P1 嵌入、P2 换图、P6 打包）：`git push` → Windows `pull && dev` → 验证 → 截图/录屏反馈 → Mac 修。
- **P1 前先做一次 Windows 环境预检**（12.3 准备步骤），确保 `pnpm install` 和 electron 能起来，别等 P1 才发现环境问题。
