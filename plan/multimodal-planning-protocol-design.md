# 多模态编排协议 v2 设计（vision-grounded planning）

目标：修订编排层协议，让规划 LLM **真正看到图片**（逐张 + 全组），并通过受约束的控制词表驱动编排层完成构图——同时不破坏"模型只出语义、几何由确定性层计算"的安全边界。

## 一、现状盘点（2026-10-01 代码证据）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 单图视觉理解 | ✅ 已有 | `lib/server/visionProvider.ts` 把 buffer 发 OpenAI 兼容视觉模型，返回 contentType / faces / subjectBox / saliencyCenter / styleTags / bestUse / cropSafety，合并进 `ImageAssetAnalysis`（`VISION_ENABLED` 门控，关闭时像素统计兜底） |
| 受约束编排 | ✅ 半有 | `TemplateRecipe` 允许模型在配方族内组合结构/主次/节奏；几何由编译器计算 |
| 素材管道 | ✅ 就绪 | 原始图存 `ONE_TOUCH_STORAGE_DIR`（24h TTL + accessToken），composition 会话持有 assetIds，服务端可读 buffer |
| 规划时看图 | ❌ 缺口 1 | `layoutPlanPrompt.ts` 只序列化 `request.assets` 结构化 JSON，像素从不进规划调用 |
| 跨图审美推理 | ❌ 缺口 2 | 各图分析彼此独立，规划模型无法做色彩和谐 / 相邻冲突 / 视觉动线判断 |
| 编排控制词表 | ❌ 缺口 3 | 只有结构语义；没有焦点意图、叠压程度、视觉权重这类"编"的旋钮 |

另：协议主干仍是旧 `GenerateLayoutRequest`（`legacyRequest()` 把 brief 压扁翻译，语义有损）——v2 与路线图方向 A（协议统一）合并实施。

## 二、协议 v2 设计

### 2.1 PlanningRequest（输入端换血）

- 直接消费 `CompositionBrief`（不再经过 legacyRequest）。
- 资产条目 = 结构化分析（含视觉补丁）+ **图片内容引用**（base64 data URL 或临时存储读取），由 provider 组装为多模态消息（OpenAI content parts：`image_url` + 文本），规划模型一次看全 2-6 张图。
- 输出端不动：`aiPlanSchema` 的 templateId-or-recipe 约束、逐候选修复、确定性编译全部保留。

### 2.2 控制词表扩展（语义层旋钮，非几何）

```ts
// per-slot（新增，可选，缺省走编译器默认）
cropIntent: {
  focus: "subject" | "saliency" | "center" | { x, y };  // 归一化
  zoom: "tight" | "standard" | "loose";
}
visualWeight: "dominant" | "balanced" | "subtle";

// recipe 级（dynamic 族新增，可选）
layering: "none" | "slight" | "strong";
```

编译器负责把这些语义映射为几何（crop 框、缩放档位、叠压偏移），模型始终不产生绝对坐标。

### 2.3 安全不变量（不动）

1. 模型不产绝对几何、不产 URL；坐标一律归一化。
2. 所有输出过 `templateRecipeSchema` + 编译器 + `validateLayout`；坏候选逐个修复或落确定性 fallback（现有机制）。
3. `assetId` 只能引用请求中提供的素材。

### 2.4 门控与降级链

`VISION_PLANNING_ENABLED`（复用 VISION_API_KEY/VISION_MODEL 配置）：

```
多模态规划 →（失败/关闭）→ 纯文本规划（现状） →（失败）→ 确定性 fallback
```

零配置时上传与生成行为与今天完全一致。

### 2.5 契约范围与 LangGraph 解耦

v2 只上 OneTouch 线；旧 `LayoutGenerationRequest` 原样冻结为 LangGraph 兼容面。这样路线图方向 B（LangGraph 留/冻结/深化）的决策不阻塞 v2，反之亦然。跨语言 parity 测试继续守护冻结面。

### 2.6 质量对照（先行）

按路线图方向 F 先建小评估集：10 个典型 brief × 各 3 候选，启发式评分（槽位焦点保真度、跨图色彩和谐、safe-area 遵守）+ 人工抽检。v2 上线前后跑同集对比，防"看得见反而编得差"。

## 三、实施拆解

| 步骤 | 内容 | 验证 |
| --- | --- | --- |
| 1 | 评估集与评分脚本（先行基线） | 基线报告 |
| 2 | PlanningRequest v2 schema + brief 原生 prompt | 单测：schema 约束、修复路径 |
| 3 | provider 多模态消息组装（含降级链） | 单测：mock provider 三档降级 |
| 4 | 编译器 cropIntent / layering / visualWeight 映射 | 单测：语义→几何映射表 |
| 5 | e2e 补一条"vision 规划开关"用例（mock） | e2e 全绿 |
| 6 | 评估集复跑对比 | 对照报告 |

工作量估算：2-2.5 人日。风险集中在步骤 4 的语义映射手感与 prompt 稳定性，靠评估集与降级链兜底。
