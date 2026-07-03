# P1 完成记录：Electron 壳 + 动态壁纸层 PoC

- **状态**: ✅ Mac 端 mock 模式跑通；Windows 真实嵌入待验证机确认
- **分支**: `desktop/dynamic-layer-v1`
- **日期**: 2026-07-03

## 目标
搭 Electron 壳（electron-vite），建 `desktop-platform` 抽象让 Mac 可 mock 开发、Windows 跑真实 WorkerW 嵌入，并用 wallpaper renderer 渲染 `@wallpaper/core` 的真实模板几何，证明产品形态成立。

## 做了什么

### 1. 新增 `apps/desktop` workspace 包
- `electron-vite` 5 + Electron 43 + Vite 8 + React 19
- 三目标结构：`src/main`（主进程）、`src/preload`（预加载）、`src/renderer`（壁纸渲染层）
- `electron.vite.config.ts` 配置三合一构建

### 2. `desktop-platform` 抽象（核心设计）
`src/shared/desktop-platform.ts` 定义接口，让 Mac/Windows 共享业务逻辑：
- `embedToWallpaperLayer(window)` — Win32 真实 WorkerW 嵌入 / mock 跳过
- `registerGlobalShortcut` / `getDisplays` / `setAutoLaunch` / `secrets`
- `resolvePlatformChoice()` 按 `process.platform` 选实现，`WALLPAPER_PLATFORM=mock` 强制 mock

**两个实现**：
- `src/main/platform/mock.ts` — Mac 开发用：窗口正常显示、快捷键内存态、密钥存 env
- `src/main/platform/win32.ts` — 真实实现：动态 `import("electron-as-wallpaper")` 调 `attach(window, {...})` 嵌入 WorkerW，`globalShortcut` 真全局快捷键

### 3. 主进程（`src/main/index.ts`）
- 单实例锁、app 生命周期
- 创建全屏无边框壁纸窗口（`frame:false, skipTaskbar:true`）
- 加载 renderer（dev 用 dev server URL，prod 用 `loadFile`）
- 调 `platform.embedToWallpaperLayer(window)`；mock 跳过、win32 真嵌入
- `setIgnoreMouseEvents(true, {forward:true})` 默认鼠标穿透
- IPC P1 骨架：`platform:name/embedded/displays`、`layout:swapSlot`（P2 填充）

### 4. preload（`src/preload/index.ts`）
`contextBridge` 暴露 `window.wallpaper` 受控 API（getPlatformName/isEmbedded/getDisplays/swapSlot）。

### 5. wallpaper renderer（`src/renderer/src/WallpaperStage.tsx`）
- **复用 `@wallpaper/core/layout` 的真实 `triptych_desktop_equal` 模板几何**
- 三个 slot 按归一化坐标定位（hero/support 各色渐变占位）
- 右上角诊断徽章显示 `platform / embedded / displays / template`

## 验证结果（Mac mock 模式）

| 检查 | 结果 |
|---|---|
| desktop typecheck | ✅ |
| electron-vite build（main+preload+renderer） | ✅ 三目标全过 |
| `dev:mock` 启动 | ✅ main/preload built + dev server 5173 + Electron 进程存活 |

> Mac 上窗口显示三个渐变 slot + 诊断徽章（`platform: mock, embedded: false`）。**桌面层嵌入效果只能在 Windows 验证**（见下）。

## 关键技术发现

1. **`electron-as-wallpaper` 是 Neon(Rust) 原生模块**，Windows-only，安装需 Rust 工具链。放在 `optionalDependencies`，Mac 上编译失败不影响整体 install；win32 平台用动态 `import()` 按需加载。
2. **Electron 二进制需单独下载**（~200MB，GitHub 慢）。Mac 上首次 `pnpm install` 后需手动跑 `node install.js`，建议用镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
3. **renderer 别名解析陷阱**：不能在 vite config 里给 `@wallpaper/core` 设别名（会与子路径冲突）。靠 pnpm workspace 软链 + 包 `exports` 字段解析即可。

## Windows 验证步骤（P1 收尾）

> 这部分需要在你的 Windows 验证机上执行，是 P1 真正成立的最后一关。

### 准备（首次）
```powershell
# 1. 装 Node 20.19+ 和 pnpm
npm i -g pnpm
# 2. 装 Rust 工具链（electron-as-wallpaper 编译需要）—— https://rustup.rs
# 3. 装 VS Build Tools（含 C++ 桌面开发），原生模块编译用
# 4. 拉代码
git clone <repo> C:\dev\wallpaper-ai
cd C:\dev\wallpaper-ai
git checkout desktop/dynamic-layer-v1
pnpm install   # electron-as-wallpaper 此时会编译成功
```

### 真实嵌入验证
```powershell
cd apps\desktop
pnpm dev
```
**预期**：
1. Electron 启动，窗口创建
2. 控制台打印 `[main] embedded into wallpaper layer (win32)`
3. **桌面图标后面出现三联画渐变壁纸层**
4. `Win+D` 显示桌面也能看到
5. 诊断徽章显示 `platform: win32, embedded: true`

### 故障排查
- **嵌入失败 / 看不到壁纸层**：Win11 24H2 切主题会销毁 WorkerW；重启 explorer（任务管理器 → 重新启动 Windows 资源管理器）后重试
- **`attach failed`**：确认 `electron-as-wallpaper` 的 `neon.node` 已编译（`pnpm rebuild` / `electron-builder install-app-deps`）
- **窗口出现在前台而非桌面层**：说明 `attach` 未生效，检查 native 模块 ABI 是否匹配（需 `@electron/rebuild` 对 Electron 43 重建）

## 下一步（P2）
区域级实时换图：填实 `layout:swapSlot` IPC，在 wallpaper renderer 用 Fabric 渲染真实图片，实现"换某 slot 图"无闪烁替换。
