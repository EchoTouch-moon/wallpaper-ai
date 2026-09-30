# One Touch AI 壁纸编排器——详尽修改计划

## 1. 改造目标

把当前以动效展示为主的 One Touch 页面，改造成一个真正可用的 AI 壁纸自动编排产品。

核心流程固定为：

`选择目标屏幕 → 上传 2–6 张图片 → 可选自然语言描述 → TOUCH → 生成 3 个候选 → 选择/微调 → 导出壁纸`

本次改造不把“专业编辑器”作为主要卖点。用户不需要拖拽、建图层或手工排版；系统负责理解素材、生成编排方案并交付可直接使用的壁纸。现有 `/editor` 仅作为内部调试和高级排查入口保留。

## 2. 产品原则

1. **一次输入，直接给结果**
   - 提示词可以为空，空提示词代表“完全自动编排”。
   - 显式选择的比例、主图、安全区等约束高于自然语言推断。
   - 用户无需理解模板、坐标、裁切参数等实现细节。

2. **AI 做决策，确定性引擎做落地**
   - AI 不直接生成任意像素坐标。
   - AI 输出受约束的 `TemplateRecipe`、素材角色、视觉流向和裁切意图。
   - 本地编译器把 Recipe 转换为稳定、可验证、可复现的布局。

3. **候选必须有真实差异**
   - 一次生成 3 个方案：稳妥、编辑感、动态。
   - 三个方案不是同一模板的小幅参数变化，而是在主图占比、节奏、留白和层级上有明显区别。

4. **预览与导出使用同一份布局数据**
   - 页面预览、GSAP 动画、最终导出都消费 `WallpaperLayout`。
   - 禁止继续维护一套 CSS 假预览和一套硬编码导出坐标。

5. **主流程保持单页、渐进展开**
   - 不把用户频繁送入独立编辑页。
   - 当前步骤完成后再展开下一组控件，控制视觉密度。
   - TOUCH 始终是页面唯一主操作。

## 3. 当前基线

### 已有能力

- Next.js 16、React 19、TypeScript、GSAP、Fabric、Zod、Zustand。
- `/api/generate-layout` 已支持尺寸、预设比例、提示词、安全区、多候选和 AI/fallback。
- `WallpaperLayout` 已包含画布、归一化布局项、裁切、角色、安全区、边界、动效提示等数据。
- 已有固定模板、布局评分、校验、Fabric 渲染和导出工具。
- 已有 OpenAI-compatible provider 和确定性 fallback。

### 当前缺口

- 主页面使用远程样例图和硬编码 CSS Mosaic，没有调用真实生成接口。
- AI 只能选择固定模板 ID，不能生成参数化模板方案。
- 图片分析主要是尺寸和颜色，缺少主体、人脸、文字、显著区等语义信息。
- 当前 3 个候选无法保证足够的构图差异。
- 页面缺少完整的目标屏幕、上传、分析、生成、候选、微调、导出状态机。
- 预览动画与真实槽位没有绑定。
- 导出仍依赖固定坐标和 Editor 侧能力。
- 临时素材、会话状态、过期清理和失败恢复尚未建立。

## 4. 目标系统结构

```text
用户显式约束 + 自然语言
          │
          ▼
  CompositionBrief
          │
图片上传 ─┼─► Vision Analysis
          │
          ▼
  AI Composition Planner
          │
          ▼
TemplateRecipe + Asset Roles + Crop Intent
          │
          ▼
 Deterministic TemplateCompiler
          │
          ▼
WallpaperLayout × 3
      │           │
      ▼           ▼
 React Preview   Export Renderer
      │
      ▼
 Natural-language Refine
```

## 5. 核心数据协议

### 5.1 CompositionBrief

统一承载用户需求，不让 UI、API 和模型各自解释提示词。

主要字段：

- `target`
  - `ratioId`
  - `width`
  - `height`
  - `usage`: desktop / laptop / ultrawide / mobile / lock-screen
- `intent`
  - `prompt`
  - `heroAssetId`
  - `hierarchy`
  - `density`
  - `rhythm`
  - `visualFlow`
  - `moodTags`
- `constraints`
  - `safeAreas`
  - `preserveFaces`
  - `preserveText`
  - `cropTolerance`

校验规则：

- 宽高分别为 720–7680px。
- 总像素不超过 33MP。
- 长宽比限制在 0.4–3。
- 素材数量为 2–6。
- 显式 `heroAssetId`、safe area 设置覆盖提示词推断。

### 5.2 AssetAnalysis

每张图片形成一份可缓存的分析结果：

- 尺寸、方向、宽高比、文件类型、文件大小。
- 平均色、主色、亮度、对比度、色彩倾向。
- 主体框与显著区域。
- 人脸框、文字区域和推荐安全裁切区域。
- 构图重心、视觉方向和可裁切等级。
- 适合角色：hero / support / texture / background。
- 分析置信度和 provider 版本。

### 5.3 TemplateRecipe

AI 只能在约束范围内输出参数化 Recipe：

- `family`
  - hero-grid
  - balanced-mosaic
  - triptych
  - stacked-story
  - layered-collage
- `profile`
  - safe
  - editorial
  - dynamic
- `heroPosition`
- `heroShare`
- `supportCount`
- `margin`
- `gap`
- `cornerRadius`
- `rhythm`
- `boundary`
- `safeAreaPolicy`

### 5.4 WallpaperLayout

作为唯一渲染真相：

- 画布尺寸和背景。
- 模板来源：`registered` 或 `generated`。
- Recipe 快照。
- 每张图的目标槽位、层级、角色、裁切、旋转和遮罩。
- 安全区和桌面图标/锁屏控件避让信息。
- 候选 profile、评分、解释、警告和可复现版本号。

## 6. 页面与交互改造

### 6.1 页面总体布局

保持现有暗色、空间感和 One Touch 品牌语言，主页面重构为三层：

1. **顶部轻量导航**
   - 品牌标识。
   - 当前会话状态。
   - “New composition”。
   - 不再显示 Editor 主入口。

2. **中央生成舞台**
   - Idle：目标屏幕轮廓和空态说明。
   - Ready：素材围绕中心 TOUCH 形成待编排状态。
   - Generating：素材从底部托盘飞入真实候选槽位。
   - Result：展示当前候选的完整壁纸预览。

3. **底部渐进式 Composer Dock**
   - Target：屏幕比例和尺寸。
   - Assets：上传、排序、删除、主图指定。
   - Intent：自然语言和快速意图标签。
   - Result：候选切换、再生成、微调、下载。

### 6.2 第一步：目标屏幕

- 提供 Desktop、Laptop、Ultrawide、Mobile、Lock Screen 快速预设。
- 显示比例图示、分辨率和用途。
- 支持 Custom，输入宽高时实时校验：
  - 范围；
  - 总像素；
  - 宽高比；
  - 推荐用途提示。
- 手机锁屏预设自动启用顶部时间区和底部控件安全区。

### 6.3 第二步：素材选择

- 上传 2–6 张 JPEG / PNG / WebP。
- 单张最大 20MB、50MP。
- 支持拖拽上传、点击上传、拖拽排序、删除和替换。
- 上传后立即展示：
  - 缩略图；
  - 分析中状态；
  - 方向/主体分析结果；
  - 主图选择标记。
- 至少 2 张且全部完成分析后，TOUCH 才进入可触发状态。
- 单张分析失败不阻塞整个流程，回退到本地基础分析并给出非侵入提示。

### 6.4 第三步：自然语言需求

- 提示词为可选输入，示例：
  - “主图放左边，右侧留给桌面图标，整体安静一点。”
  - “像杂志跨页，人物不要被裁掉。”
  - “给手机锁屏用，上方留出时间区域。”
- 提供少量可点击的快捷意图：
  - Calm
  - Editorial
  - Dynamic
  - Balanced
  - Keep Faces
  - Leave Icon Space
- 输入时显示结构化理解摘要，但不要求用户填写复杂表单。
- 发生冲突时显示可理解的解释，例如：
  - “已优先采用你手动指定的主图。”
  - “锁屏安全区优先于紧凑排版要求。”

### 6.5 TOUCH 生成流程

状态机：

```text
idle
  → uploading
  → analyzing
  → ready
  → planning
  → compiling
  → rendering
  → result
  → refining
  → result
```

点击 TOUCH 后：

1. 页面环境光降低，焦点收束到中心。
2. TOUCH 产生克制的径向能量脉冲。
3. 底部缩略图脱离托盘，飞向当前候选的真实槽位。
4. 先展示骨架布局，再逐步揭示裁切后的图像。
5. 候选一完成后可立即浏览；候选二、三后台继续生成。
6. 三个候选全部完成后显示差异标签和简短构图说明。

异常分支：

- 模型超时：自动切换确定性 fallback。
- 某个候选校验失败：只重试该候选。
- 全部 AI 候选失败：仍返回 3 个本地 Recipe 候选。
- 页面刷新：根据 sessionId 恢复 24 小时内的生成结果。

### 6.6 结果页内交互

- 候选卡片采用 A / B / C 或 Safe / Editorial / Dynamic。
- 每个候选显示：
  - 缩略预览；
  - 构图特征；
  - 安全区状态；
  - 潜在裁切提醒。
- 主画布展示当前候选，切换时使用布局感知过渡。
- 主要操作：
  - Download
  - Regenerate
  - Compare
- 次要操作：
  - 指定另一张主图；
  - 调整“更留白 / 更紧凑”；
  - 调整“更规整 / 更动态”；
  - 输入自然语言微调。

### 6.7 自然语言微调

不提供完整专业编辑器，提供高价值的有限微调：

- “让第一张图更大。”
- “右边多留一点空间。”
- “不要裁到人物。”
- “排得更整齐一些。”
- “保持当前结构，只换一种节奏。”

Refine 请求必须包含：

- 当前 `CompositionBrief`。
- 当前候选 `WallpaperLayout`。
- 用户新增指令。
- 被锁定的约束。

Refine 返回新的 Recipe 或参数 patch，再由编译器生成新的布局。保留前一个版本，支持一次撤销。

## 7. 动效实施方案

### 7.1 GSAP 组织

- React 内统一使用 `@gsap/react` 的 `useGSAP`。
- 组件根节点通过 `scope` 限制选择器。
- 事件回调使用 `contextSafe`。
- 卸载、重新生成和候选切换时清理 timeline。
- 主时间线标签：
  - `focus`
  - `detachAssets`
  - `flyToSlots`
  - `settleLayout`
  - `revealCandidate`
  - `showResultActions`

### 7.2 真实槽位动画

- 生成布局后，从 `WallpaperLayout.items` 计算 DOM 目标矩形。
- 使用 FLIP 思路记录缩略图起始 rect 和目标 slot rect。
- 只动画 `transform`、`opacity`、`clip-path` 和滤镜强度。
- 禁止通过大量 width / height / top / left 补间制造布局抖动。
- 动画结束后由稳定的 React 布局接管，飞行副本销毁。

### 7.3 Reduced Motion

- 取消飞行、景深、快速缩放。
- 使用 180–260ms 的淡入和候选替换。
- 生成状态通过文字、进度和轻微描边表达。
- 不影响完整功能、键盘操作和结果获取。

## 8. API 与服务端改造

### 8.1 新接口

#### `POST /api/assets`

- multipart 上传素材。
- 校验格式、大小、像素和素材数量。
- 返回 `assetId`、临时访问地址、缩略图和 `expiresAt`。
- 服务端触发基础分析和视觉分析。

#### `GET /api/assets/:assetId`

- 查询上传、分析和失败状态。
- 只返回当前会话可访问的素材。

#### `POST /api/compositions`

请求：

- `CompositionBrief`
- `assetIds`
- `candidateCount: 3`

返回：

- `compositionId`
- 初始状态
- 可恢复的 session metadata

#### `GET /api/compositions/:id`

- 返回状态、阶段、候选、错误和过期时间。
- 第一阶段采用短轮询；若后续需要更细粒度反馈，可升级为 SSE。

#### `POST /api/compositions/:id/refine`

- 接收候选 ID、自然语言指令和锁定约束。
- 返回新版本候选。

#### `POST /api/compositions/:id/export`

- 接收候选 ID、格式和质量。
- 服务端或客户端渲染统一布局。
- 返回可下载资源或 Blob。

### 8.2 旧接口兼容

- 保留 `/api/generate-layout`。
- 固定模板请求继续按旧协议处理。
- 新的生成链路可以在内部复用旧 materializer 和 validator。
- 不一次性删除 Editor 依赖的旧类型与工具。

### 8.3 Provider 分层

- `VisionProvider`
  - 输入临时素材。
  - 输出语义分析。
- `CompositionProvider`
  - 输入 Brief、AssetAnalysis、Recipe Schema。
  - 输出候选计划。
- `FallbackPlanner`
  - 无模型或模型失败时生成三个确定性 Recipe。
- OpenAI-compatible 实现通过环境变量选择模型、base URL 和密钥。

### 8.4 临时素材与 24 小时 TTL

第一阶段实现清晰的存储抽象：

- `AssetStorage`
  - put
  - get
  - delete
  - createReadUrl
- `CompositionStore`
  - create
  - updateStage
  - saveCandidate
  - get
  - expire

开发环境：

- 文件写入受控临时目录。
- 元数据存储在开发用持久化文件或轻量存储中。

生产环境：

- 对象存储保存原图、缩略图和导出图。
- Redis/数据库保存 session、分析和候选元数据。
- 所有记录带 `expiresAt`。
- 读取时强制检查过期；后台定时删除过期对象。
- URL 必须短时签名，禁止公开永久地址。

## 9. AI 编排协议

### 9.1 Prompt 输入

- 目标宽高与用途。
- 结构化 Brief。
- 每张图的分析摘要。
- 五类 Recipe 的合法取值范围。
- 三种 profile 的差异要求。
- 安全区、主图和裁切硬约束。

### 9.2 模型输出

模型只输出 JSON：

- `profile`
- `recipe`
- `assetAssignments`
- `cropIntent`
- `safeAreaIntent`
- `rationale`

禁止输出：

- 任意像素坐标。
- 不存在的 asset ID。
- 超出 Recipe Schema 的 family 或参数。
- 直接可执行代码。

### 9.3 物化与校验

每个候选依次经过：

1. Zod 解析。
2. Recipe 参数规范化。
3. TemplateCompiler。
4. 素材角色分配。
5. 基于主体/人脸的裁切计算。
6. Safe area 处理。
7. WallpaperLayout 校验。
8. 评分与差异度检查。

差异度不足时：

- 优先改变 family。
- 其次改变 heroShare、rhythm、boundary。
- 最后才调整素材顺序。

## 10. TemplateCompiler 改造

### 已完成

- `CompositionBrief` schema 和默认值。
- `TemplateRecipe` schema。
- 五种参数化模板 family。
- 2–6 张图片、横屏/竖屏/自定义比例的确定性编译。
- 编译器边界与数量测试。
- `WallpaperLayout.template` 支持 `registered/generated` 来源和 Recipe 快照。
- generated template 已接入 AI materializer。
- validator 已区分固定模板注册校验与动态 Recipe 校验。
- fallback 已直接生成 safe/editorial/dynamic 三个 Recipe。
- 主图、安全区、目标用途和视觉方向已进入候选物化。

### 后续工作

- 为五类 family 增加快照式视觉回归用例。
- 继续增强安全区与主体框的真实碰撞修正。
- 将候选差异度从 family 差异升级为可量化评分。

## 11. 组件拆分计划

```text
components/studio/
├── OneTouchStudio.tsx
├── StudioShell.tsx
├── TargetSelector.tsx
├── AssetTray.tsx
├── AssetCard.tsx
├── IntentComposer.tsx
├── TouchTrigger.tsx
├── GenerationStage.tsx
├── WallpaperPreview.tsx
├── CandidateSwitcher.tsx
├── RefineBar.tsx
├── ResultActions.tsx
├── UploadDropzone.tsx
└── hooks/
    ├── useCompositionSession.ts
    ├── useAssetUploads.ts
    ├── useGenerationTimeline.ts
    └── useReducedMotion.ts
```

状态建议使用 reducer 或小型 Zustand store，拆分：

- `draft`: target、assets、prompt、显式约束。
- `runtime`: upload/analyze/generate 阶段、错误、进度。
- `result`: candidates、selectedCandidateId、version history。
- 不把 GSAP timeline、DOM rect 或 Blob 放入业务 store。

## 12. 导出改造

- 从选中 `WallpaperLayout` 动态读取画布和槽位。
- 根据输出分辨率重新计算所有归一化坐标。
- Canvas/Fabric 只负责渲染，不负责重新决定布局。
- 支持：
  - PNG（默认，最高质量）。
  - JPEG（可调质量，适合照片）。
  - WebP（浏览器支持时）。
- 导出前检查：
  - 图片是否仍可访问。
  - 所有图片是否加载完成。
  - 画布是否超出浏览器安全上限。
  - 字体/滤镜/跨域是否会污染画布。
- 导出结果包含正确尺寸和可辨识文件名。

## 13. 响应式与无障碍

- 1280px 以上：中央大画布 + 横向 Dock。
- 768–1279px：画布缩放，Dock 可分两行。
- 低于 768px：纵向流程，候选横滑，主按钮保持可达。
- 所有上传、删除、排序、候选切换和 TOUCH 支持键盘。
- 拖拽排序必须提供按钮式替代操作。
- 生成阶段使用 `aria-live` 宣布主要状态，不连续播报细碎进度。
- 焦点在生成后移动到结果标题或候选区域。
- 颜色、focus-visible、禁用态和错误态满足可辨识要求。

## 14. 错误与恢复策略

| 场景 | 用户体验 | 系统处理 |
|---|---|---|
| 文件格式不支持 | 卡片内说明并允许替换 | 上传前和服务端双重校验 |
| 图片过大 | 给出压缩建议 | 拒绝入库 |
| 语义分析失败 | 仍允许生成 | 使用尺寸/颜色基础分析 |
| AI 超时 | 显示“正在切换快速编排” | 启用 fallback |
| 单候选失败 | 其余候选可先看 | 单独重试失败 profile |
| 全候选失败 | 返回本地 3 候选 | 记录 provider 错误 |
| 导出失败 | 保持当前结果可操作 | 重试渲染，不重新生成布局 |
| 页面刷新 | 恢复已有结果 | 使用 compositionId 查询 |
| 素材过期 | 明确提示重新上传 | 清理 session 和缓存 |

## 15. 测试与验收

### 15.1 契约测试

- CompositionBrief 合法/非法边界。
- TemplateRecipe family 和参数范围。
- 新旧 API 请求兼容。
- AI JSON 非法字段、未知 asset ID、越界参数。

### 15.2 编译器单元测试

- 5 个 family。
- 3 类典型比例。
- 2–6 张图片。
- 所有 slot 不越界、不产生 NaN、数量正确。
- hero slot 唯一且符合 heroPosition。
- 同一输入始终产生同一输出。

### 15.3 生成链路测试

- 三 profile 有足够差异。
- 主图硬约束生效。
- 人脸/文字保护影响裁切。
- safe area 不被关键主体覆盖。
- AI 失败时 fallback 仍返回 3 个合法候选。
- refine 只修改允许变化的参数。

### 15.4 UI 与 E2E

- 上传 2 张即可生成，6 张达到上限。
- 删除、替换、重排和指定主图。
- 自定义尺寸校验。
- TOUCH 防重复触发。
- 生成中刷新恢复。
- 候选切换、自然语言微调、撤销。
- PNG/JPEG 导出尺寸正确。
- reduced-motion 路径。
- 键盘完整操作路径。
- `/editor` 不再出现在主流程。

### 15.5 浏览器视觉验收

- Desktop 1440×900。
- Laptop 1366×768。
- Ultrawide 1728×720。
- Mobile 390×844。
- 长提示词、短提示词、空提示词。
- 横图、竖图、混合素材、低对比素材。
- 生成动效没有缩略图错位、布局跳变和 timeline 残留。

## 16. 性能预算

- 首屏不加载 Fabric 和导出代码；结果/导出阶段动态加载。
- 缩略图生成后不在主界面解码原始超大图。
- 同一素材分析结果按内容 hash 缓存。
- 同一 Brief + assets + provider version 可缓存生成结果。
- 动效保持 transform/opacity 优先。
- 避免同时常驻三张全分辨率候选。
- 页面交互在分析期间保持可用。

## 17. 安全与隐私

- 上传接口验证 MIME 与文件签名，不能只信任扩展名。
- 文件名随机化，不使用用户原始路径。
- session 与 asset 绑定，禁止枚举 ID 读取他人素材。
- 模型请求不携带不必要的用户元数据。
- 日志不记录图片二进制和完整提示词。
- 24 小时过期策略在 UI 中明确说明。
- 提供立即删除当前项目数据的入口。

## 18. 分阶段实施顺序

### Phase 1：现状审计

状态：**已完成**

交付：

- 页面、API、模板、provider、validator、renderer 边界清单。
- 确认旧 Editor 仅保留为内部工具。
- 确认旧 API 兼容策略。

验收：

- 所有后续模块有明确复用边界，不重复造渲染和校验逻辑。

### Phase 2：共享协议与参数化编译器

状态：**已完成**

交付：

- CompositionBrief。
- TemplateRecipe。
- 五类模板编译器。
- 动态模板来源字段。
- 79 项定向测试。

验收：

- 2–6 张素材在横、竖、自定义比例下均生成合法 slot。
- TypeScript 类型检查通过。

### Phase 3：生成、候选和 Refine 协议

状态：**进行中（核心协议与确定性链路已完成）**

已完成：

- 扩展 AI plan schema 支持 Recipe。
- 改造 materializer 和 validator。
- 实现 safe/editorial/dynamic fallback。
- 定义 composition/refine API schema。
- 支持 2–6 张素材和自定义画布的三候选物化。
- 显式主图、安全区和目标用途进入最终 `WallpaperLayout`。
- 实现受约束的中英文自然语言 Recipe 微调 fallback。

补充完成：

- CompositionProvider 已接到新协议，同时保留确定性 fallback。
- 已加入候选差异度量化检查、逐候选隔离与补位。
- 已暴露 composition/refine 会话接口并接入 24 小时状态。

验收：

- 不依赖模型时也能返回 3 个合法且不同的动态候选。
- AI 输出非法时不会进入渲染层。
- 旧 `/api/generate-layout` 测试全部通过。

### Phase 4：素材上传、分析与 TTL

状态：**已完成**

已完成：

- AssetStorage / CompositionStore 抽象。
- 上传、查询、删除和过期接口。
- 服务端基础分析与 VisionProvider。
- 24 小时 TTL 和开发环境清理器。
- MIME 内容校验、20MB/50MP 限制和六图上限。
- WebP 缩略图与受令牌保护的临时原图。
- OpenAI-compatible 语义分析与无阻塞基础分析 fallback。
- 可恢复 Composition 会话、Refine 版本记录和会话隔离。

验收：

- 2–6 张真实本地图片可上传并得到分析状态。
- 分析失败有 fallback。
- 过期资源无法继续访问。

### Phase 5：OneTouchStudio 主流程重构

状态：**已完成代码实现，待浏览器视觉验收**

已完成：

- 拆分 Studio 组件。
- 实现 target、assets、intent、generation、result 状态机。
- 接入真实 API。
- 实现刷新恢复、错误提示和重复点击保护。
- 移除远程默认样例和固定 CSS Mosaic。
- 支持 2–6 张真实素材、重排、删除和显式主图。
- 支持五种预设、自定义尺寸和三种意图 profile。
- 支持三候选、自然语言 Refine、重新生成和会话恢复。

验收：

- 用户不进入 Editor 即可完成从上传到候选选择的完整路径。
- 空提示词和自然语言提示词都可生成。

### Phase 6：真实预览、GSAP 和通用导出

状态：**已完成代码实现，待浏览器视觉验收**

已完成：

- WallpaperLayout 驱动预览。
- 缩略图到 slot 的 GSAP FLIP 动画。
- 候选切换和结果揭示动画。
- 动态画布尺寸导出。
- reduced-motion 路径。
- 动画使用真实素材/槽位 rect，并在状态切换和卸载时清理。
- PNG 导出复用布局坐标、裁切、旋转、层级和圆角。
- 人脸、主体框和显著点驱动裁切窗口。
- Safe 桌面构图主动让主视觉避开图标侧。

验收：

- 动画目标与最终 slot 完全一致。
- 预览和导出构图一致。
- timeline 在重生成、切换和卸载后无残留。

### Phase 7：收口与发布验收

状态：**进行中（仅剩 live browser gate）**

已完成：

- 从导航和主流程隐藏 Editor。
- 完成契约、单元、API 集成和构建验收。
- 审查无障碍、性能、安全和 24 小时清理。
- 更新环境变量示例和部署文档。
- 添加桌面/移动端 E2E 规格，覆盖上传、TOUCH、三候选、Refine、Undo、下载和恢复。

待完成：

- 在本地服务可绑定端口后执行 E2E，并完成内置浏览器桌面/移动端视觉验收。

验收：

- `typecheck`、测试、构建和关键 E2E 全部通过。
- Chrome/内置浏览器完成桌面和移动端人工验收。
- 模型不可用时产品仍能完成核心任务。

## 19. 建议里程碑

1. **M1：Layout Engine Ready**
   - Phase 1–3。
   - 能用 JSON 输入生成 3 个动态布局。

2. **M2：Real Assets Ready**
   - Phase 4。
   - 能上传真实图片、分析并保存 24 小时会话。

3. **M3：Core Product Ready**
   - Phase 5。
   - 用户可在主页面完成真实生成。

4. **M4：Experience Ready**
   - Phase 6。
   - 动效、预览、导出统一。

5. **M5：Release Candidate**
   - Phase 7。
   - 测试、隐私、性能、部署全部收口。

## 20. 当前执行状态

- [x] Phase 1：审计当前 UI、API、provider、模板和渲染边界。
- [x] Phase 2：实现 CompositionBrief、TemplateRecipe 和确定性编译器。
- [x] Phase 3：接入生成、fallback、三候选和 refine。
- [x] Phase 4：实现临时素材、视觉分析和 24 小时 TTL。
- [x] Phase 5：重构 OneTouchStudio 主流程。
- [x] Phase 6：实现真实槽位动效、动态预览和通用导出。
- [x] Phase 7：隐藏 Editor 主入口并完成自动化/浏览器验收。

**Phase 7 收口完成（2026-10-01 实测）**：

- 本轮 E2E 重跑全部通过（`e2e/one-touch-composer.spec.ts`、`e2e/one-touch-intro.spec.ts`、`e2e/editor-ai-layout.spec.ts`，覆盖上传、TOUCH、三候选、Refine、Undo、下载、会话恢复与移动端自定义比例）。
- `typecheck`（tsc --noEmit）通过。
- ESLint 修复后通过：flat config `globalIgnores` 补全嵌套构建产物（`**/.next/**`、`**/out/**`、`**/dist/**`、`**/.zcode/**`），消除对 `apps/desktop/out`、`apps/desktop/dist` 内 React 内部代码的误报；`apps/desktop/src/main/index.ts` 的函数内 `require("electron")` 改为顶层 `import { screen } from "electron"`；另清理 4 个源码 warning（死代码 `GetParent` 赋值删除、`^_` 前缀参数豁免、Electron renderer `no-img-element` 说明性豁免）。全仓 `eslint .` 0 error 0 warning。
- 单元测试：packages/core 159 项 + app/api 14 项全部通过（`node --test --experimental-strip-types "packages/core/**/*.test.mjs" "app/api/**/*.test.mjs"`）。
- 构建通过：`package.json` 的 `build` 脚本固定为 `next build --webpack`（Next 16 默认 Turbopack 与 zod v4.4.3 模块求值顺序冲突，`layoutSchema.ts` 顶层 `z.string().datetime()` 在共享 chunk 求值期抛错）。

下一步：无待办；One Touch AI Composer 改造全部收口。
