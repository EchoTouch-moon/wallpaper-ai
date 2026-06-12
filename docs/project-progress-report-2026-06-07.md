# AI Wallpaper Studio 项目进展报告

> 历史快照：本文记录 2026-06-07 状态。最新进展请查看
> [2026-06-12 项目进展报告](project-progress-report-2026-06-12.md)。

报告日期：2026-06-07
当前分支：`codex/triptych-layout-v1`
已提交基线：`ea527ad fix(editor): stabilize canvas snapping`
工作区状态：功能代码已提交

## 1. 项目结论

项目已经从 Canvas 骨架进入可用的本地 MVP 阶段，当前具备“上传图片、浏览器本地分析、生成三拼候选、应用并编辑、自动保存、恢复和 PNG 导出”的主要链路。

以 v1 技术路线衡量：

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| 编辑器基础能力 | 已完成 | 上传、移动、缩放、旋转、复制、删除、图层顺序、裁剪、吸附 |
| 高清导出 | 已完成 | 按目标分辨率导出 PNG，不包含编辑辅助 UI |
| Canonical Layout 协议 | 已完成 | Zod 为唯一数据源，TypeScript 类型由 Schema 推导 |
| 本地图片分析 | 已完成 | 平均色、主色、亮度、饱和度、对比度、方向和质量评分 |
| 同色系三拼 | 已完成 | 桌面/手机并行，每次生成三个确定性候选 |
| 布局应用与往返 | 已完成 | Layout 可应用到 Fabric，并可序列化回协议 |
| 撤销与重做 | 已完成 | 最多 50 步，模板应用和编辑完成时记录 |
| 本地草稿 | 已完成 | IndexedDB 保存 Blob 和项目数据，800ms 防抖自动保存 |
| 安全区 | 已完成 | 桌面图标/任务栏、手机时钟/组件区域，可切换且不参与导出 |
| AI 布局服务 | 未开始 | 尚未实现 `/api/generate-layout` 和 OpenAI Structured Output |
| 完整 v1 模板族 | 未完成 | Moodboard、Portrait Triptych、不规则模板和图层面板待实现 |

## 2. 本轮吸附优化

### 问题判断

旧实现会在每个 Fabric `object:moving` 事件中重新选择最近候选并立即写回 `left/top`。当对象位于多个边缘或中心线附近时，候选可能逐帧切换；吸附与脱离又使用同一个阈值，因此容易在边界来回跳动。

横轴和纵轴在代码中本来就是分别计算的，抖动的主要原因不是两个轴直接修改同一个坐标，而是每个轴都缺少稳定的拖动会话和候选锁。

### GitHub 调研依据

- [Fabric.js #882](https://github.com/fabricjs/fabric.js/issues/882) 记录了逐帧修改对象坐标造成 “dancing” 的相同现象。
- [Fabric.js](https://github.com/fabricjs/fabric.js) 官方对齐示例使用场景坐标和明确的对齐锚点。
- [Konva snapping 示例](https://konvajs.org/docs/sandbox/Objects_Snapping.html) 分别选择横纵轴最接近的单一候选。
- [tldraw snapping](https://tldraw.dev/sdk-features/snapping) 使用固定初始几何和 drag delta 计算 nudge，并将 8 屏幕像素作为缩放无关阈值。

### 当前实现

- 为一次拖动创建 `SnapSession`。
- 横轴和纵轴分别记录锁定的 guide 与锚点索引。
- `8px / zoom` 内进入吸附。
- `14px / zoom` 外才释放吸附，形成滞回。
- 锁定期间不切换到看似更近的相邻候选。
- 对象切换、裁剪模式、拖动完成和 Canvas 卸载时重置会话。
- 导线仍按横纵轴独立显示，允许同时对齐到交点。

该方案保留现有 Fabric 事件架构，不依赖私有 API，也不改变文档坐标或序列化协议。

## 3. 已交付能力

### 视觉与工作区

- Apple Liquid Glass 统一设计系统。
- 明暗系统适配、减少动态效果和无模糊回退。
- 浮动工具栏、左右侧栏、候选方案栏和画布状态信息。
- 桌面和移动比例预览。

### 图片与 Canvas 编辑

- JPG、PNG、WebP 点击或拖拽上传。
- Object URL 生命周期管理。
- Fabric 图片对象稳定写入 `objectId`、`assetId`、`role` 和 `slotId`。
- 移动、缩放、旋转、删除、复制、图层前移/后移。
- 固定窗口裁剪和焦点拖动。
- 模糊背景创建与移除。
- 画布边缘、中心和对象边缘/中心吸附。

### 布局与分析

- 图片最大 `96 x 96` 本地采样并忽略透明像素。
- 色彩距离采用 Hue、Lightness、Saturation 加权。
- 同色组不足三张时选择最近图片并生成回退说明。
- 桌面与手机各包含：
  - Minimal Equal Triptych
  - Editorial Hero + Two
  - Cinematic Edge-to-Edge
- 候选缩略图由布局 JSON 和 CSS 渲染。
- 应用候选时替换当前布局并进入历史栈。

### 数据与持久化

- `WallpaperLayout`、`WallpaperTemplate`、`ImageAssetAnalysis`、`EditorProject` 均由 Zod 定义。
- 布局校验覆盖重复 ID、非法坐标、越界裁剪、未知素材和未知模板。
- IndexedDB 保存原始 Blob、分析结果、候选和当前布局。
- 刷新后恢复固定本地草稿，历史栈从恢复状态重新开始。
- 删除素材时同步删除 Blob，并清理引用该素材的候选。

## 4. 架构现状

| 层级 | 主要职责 |
| --- | --- |
| `components/editor` | 工作区 UI、Provider、画布、素材、Inspector、候选和工具栏 |
| `lib/fabric` | Canvas 初始化、布局应用/序列化、裁剪、导出和吸附 |
| `lib/image` | 浏览器图片采样、颜色分析、分组和元数据 |
| `lib/layout` | Zod 协议、模板注册、三拼规划和校验 |
| `lib/storage` | IndexedDB Blob/草稿和项目快照 |
| `lib/wallpaper` | 比例、构图预设、分辨率和安全区 |
| `store/editorStore.ts` | 仅保存可序列化编辑器状态 |

Fabric Canvas 实例仍只由 `EditorProvider` 持有，未进入 Zustand；这为后续 JSON 保存、AI 输出校验和多项目能力保留了清晰边界。

当前 TypeScript/TSX/CSS 约 5,874 行，包含 10 个测试文件。

## 5. 质量与验证

| 检查项 | 当前结果 |
| --- | --- |
| 单元测试 | 29 项通过 |
| TypeScript | `tsc --noEmit` 通过 |
| ESLint | 通过 |
| Diff whitespace | `git diff --check` 通过 |
| 生产构建 | Next.js 16.2.7 生产构建通过 |
| 自动化拖动手感检查 | 未执行；浏览器策略拒绝继续控制 localhost |
| 吸附算法序列验证 | 通过；覆盖进入、锁定、释放、切换和连续拖动 |

吸附测试新增覆盖：

- 进入阈值。
- 阈值边界不吸附。
- 锁定后在释放阈值内保持原 guide。
- 越过释放阈值后切换到更近 guide。
- 无候选时解除锁定。
- 连续拖动序列不会在阈值边缘反复切换。

## 6. 风险与技术债

1. 需要一次人工拖动验收，重点观察低缩放比例、旋转图片和多个密集对象附近的手感。
2. README 和产品文案仍以英文为主，后续应确定正式语言策略。
3. Node 测试使用实验性 TypeScript strip 模式，会输出模块类型警告，但不影响结果。
4. 当前只有固定本地草稿，没有项目列表、迁移策略或存储配额提示。
5. 历史记录只保存布局状态，未来装饰层和更多对象类型加入后需扩展往返测试。
6. 当前未做 AI、人脸、主体和 OCR 分析。

## 7. 建议的下一阶段

优先级建议：

1. 完成人工吸附验收，并根据手感微调 `8px / 14px` 阈值。
2. 增加项目 JSON 显式导入导出，以及 IndexedDB schema version/migration。
3. 实现 Layered Moodboard 的 Editorial 与 Memory Board 预设。
4. 增加 Portrait Triptych 和图层面板。
5. 增加 3 至 5 个手工不规则 polygon 模板。
6. 建立 `/api/generate-layout`，只允许 AI 从模板注册表选择并输出 Zod Structured Output。
7. 最后加入自然语言修改、人脸/主体保护和 OCR 留白约束。

## 8. 版本里程碑

| Commit | 内容 |
| --- | --- |
| `a7c6338` | Liquid Glass 设计系统 |
| `7fcf844` | 图片编辑工作流 |
| `a420fa9` | 高清 PNG 导出 |
| `047dd29` | 聚焦工作区 |
| `364816a` | 模糊背景 |
| `fb6991c` | 基础吸附与焦点裁剪 |
| `9372fe1` | Canonical Zod 布局协议 |
| `595e2f5` | 本地颜色分析与分组 |
| `0c49312` | 三拼布局工作流 |
| `7a82bb2` | IndexedDB 草稿与安全区 |
| `ea527ad` | 吸附会话、轴向锁定与释放滞回 |
