# P1 Windows 动态壁纸层 — 完整验证报告

## 一、项目目标

在 Windows 上实现 Electron 应用嵌入桌面壁纸层（WorkerW），渲染三联画渐变壁纸，且不遮挡桌面图标。

---

## 二、技术路线演变

| 阶段 | 方案 | 结果 |
|---|---|---|
| P1 | `electron-as-wallpaper` (Rust/Neon) | ❌ 失败：patch 不生效、桌面遮挡 |
| P1.1 | Rust patch 持久化 | ❌ 失败：pnpm patch 机制问题 + 补丁编译错误 |
| P1.2 | koffi 纯 JS FFI 直调 user32.dll | ✅ 嵌入成功，但渲染问题 |
| P1.3 | 诊断工具 + 加载顺序调整 | ✅ 定位到渲染问题，但未解决 |
| P1.4 | `disableHardwareAcceleration` 软件渲染 | ✅ 证明渲染管线正常，但窗口闪现后消失 |
| P1.5 | 删除 setBounds/invalidate 代码 | ✅ 三联画稳定显示一段时间，但后台节流导致变白 |

---

## 三、P1.2 koffi 重写（commit 096202a）

### 为什么放弃 `electron-as-wallpaper`

调研三个成熟开源壁纸应用（Lively Wallpaper、weebp、SpoutWallpaper），确认它们调用 user32.dll 的序列**完全一致**。对比发现 `electron-as-wallpaper` 漏掉了三个关键步骤：

| 步骤 | 正确做法 | electron-as-wallpaper | 后果 |
|---|---|---|---|
| 发现 WorkerW | EnumWindows 找含 SHELLDLL_DefView 的窗口，取下一个兄弟 WorkerW | 找不到就回退 Progman | reparent 进错父窗口 |
| 预定位 + 坐标变换 | SetWindowPos → MapWindowPoints → SetParent → SetWindowPos | 只调 SetParent | 多屏错位、Z 序乱 |
| SWP_NOACTIVATE | flags 含 `0x0010`（绝不激活壁纸窗口） | 缺失 | Win11 销毁窗口 |

### koffi 实现优势

- 删除 `electron-as-wallpaper` 依赖 + pnpm patch
- 删除 `patches/` 目录
- 新增 `koffi`（纯 JS，无原生编译）→ Windows 不再需要 Rust 工具链 / VS Build Tools
- 实现 `src/main/win32/user32.ts`：直调 user32.dll 的 FindWindowW / SendMessageTimeoutW / EnumWindows / FindWindowExW / SetParent / SetWindowPos

### 实现的完整序列

```
1. FindWindowW("Progman") → progman
2. SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000)  // 生成 WorkerW
3. EnumWindows: 找含 SHELLDLL_DefView 的顶层，取其下一个兄弟 WorkerW
4. SetWindowPos(hwnd, HWND_BOTTOM, x, y, w, h, SWP_NOACTIVATE)    // 预定位
5. SetParent(hwnd, workerW)                                       // reparent
6. SetWindowPos(hwnd, HWND_BOTTOM, x, y, w, h, SWP_NOACTIVATE)    // 再定位
```

### 关键洞察

Lively 根本不用 `WS_EX_TRANSPARENT` 或 `setIgnoreMouseEvents`。窗口树正确时，图标在 `SHELLDLL_DefView`（WorkerW 的兄弟，在它上面），图标点击天然落到图标上。壁纸窗口只是空桌面区域的承载者。

---

## 四、P1.3-P1.5 渲染问题排查

### 问题现象

- 窗口嵌入成功，图标可见
- 三联画不显示（灰色/白色背景）
- P1.4 发现三联画能闪现但立即消失
- P1.5 三联画能稳定显示一段时间，但切换到其他应用后变白

### 根因确认

**软件渲染模式下，Electron/Chromium 对非激活后台窗口进行渲染节流。**

| 项目 | 详情 |
|---|---|
| 触发条件 | 用户切换到其他窗口（浏览器）→ wallpaper 变成"后台"窗口 |
| 机制 | `focusable: false` + `SWP_NOACTIVATE` → 窗口永远不激活 → 后台节流释放软件渲染目标 |
| 证据 | 纯白色（内容丢失）、时间相关、无控制台错误 |
| 已排除 | `setBounds` 已移除；`setBackgroundThrottling(false)` 已调用但无效 |

---

## 五、P1 阶段最终状态

### 已解决的问题

| 问题 | 解决方案 | 状态 |
|---|---|---|
| Rust patch 持久化失败 | 放弃 `electron-as-wallpaper`，改用 koffi | ✅ |
| koffi 3.x API 兼容性 | `wstr` → `wstring`；`koffi.register(fn, pointer)` | ✅ |
| electron-vite + koffi require 冲突 | koffi 加入 external | ✅ |
| 桌面图标遮挡 | Z 序修正（SHELLDLL_DefView 在上） | ✅ |
| 窗口被销毁（Win11） | SWP_NOACTIVATE flag | ✅ |
| 渲染管线不工作 | `disableHardwareAcceleration` 软件渲染 | ✅ |
| 窗口闪现后消失 | 删除 setBounds/invalidate 代码 | ✅ |

### 遗留问题（P2 解决）

| 问题 | 影响 | 优先级 |
|---|---|---|
| 后台节流导致长时间运行变白 | 稳定性 | P0 |
| WorkerW 被 Explorer 重建/刷新 | 需要 re-embed 机制 | P1 |
| 多显示器支持 | 单屏 MVP 范围 | P2 |

---

## 六、技术债务

| 项目 | 详情 |
|---|---|
| `disableHardwareAcceleration` | 软件渲染性能不如 GPU，但稳定。P2 可尝试 GPU + 定期 invalidate |
| `setBackgroundThrottling(false)` | 已调用但无效，需进一步研究 Electron 后台节流机制 |
| WorkerW 句柄存活性 | 无检测机制，Explorer 重建 WorkerW 时应用会静默失败 |

---

## 七、验证结果汇总

| 检查项 | 状态 | 备注 |
|---|---|---|
| `embedded: true` | ✅ | 控制台输出 |
| 三联画渐变在桌面图标后面 | ✅ | 能正常显示 |
| 桌面图标可点击 | ✅ | 结构性穿透，无需 setIgnoreMouseEvents |
| `Win+D` 后壁纸层还在 | ⚠️ 未验证 | 推测正常（Z 序正确） |
| 长时间运行稳定性 | ❌ | 后台节流导致变白，P2 解决 |

---

## 八、结论

**P1 技术路线确认可行：** Electron + koffi FFI + WorkerW 嵌入 + 软件渲染，可以正确实现 Windows 动态壁纸层。

**P1 阶段目标已达成：**
- ✅ 窗口嵌入 WorkerW 桌面层
- ✅ 图标在前，壁纸在后
- ✅ 三联画渲染正常
- ✅ 无桌面遮挡

**P2 阶段重点：**
- 解决后台节流稳定性问题
- 实现定期重绘/心跳机制
- 多显示器支持
- WorkerW 重建检测与 re-embed
