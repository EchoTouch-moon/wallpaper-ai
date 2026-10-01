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

### 2.5 引擎无关：协议是唯一稳定接缝（ports & adapters）

协议 v2 被明确为产品级的**稳定契约**——schema 化、带版本号、用 JSON fixture 做跨实现一致性测试。所有执行引擎降级为协议背后的**可替换适配器**：

| 适配器 | 状态 | 说明 |
| --- | --- | --- |
| OpenAI-compatible 直连 | ✅ 现有 | `OpenAICompatibleLayoutProvider`，v2 升级为多模态 |
| 确定性 fallback | ✅ 现有 | 零配置兜底，永在 |
| **精简 agent 循环** | 🆕 新增（v2 后） | 见 2.7——无需任何框架，协议约束使其安全 |
| LangGraph（Python） | ⬇️ 降级 | 从"另一条通路"降级为可选适配器或直接冻结；**路线图方向 B 的产品决策就此消解**：留不留 LangGraph 不再影响架构，冻结成本≈0 |

代码侧的统一动作：`LayoutModelProvider` 接口升级为 v2 协议的唯一入口（`generatePlan(planningRequest) → aiPlanResponse`），LangGraph 线如果保留也要实现这个接口而不是旁路。

### 2.6 精简 agent 循环（协议之后的自然延伸）

协议约束 + 现有的确定性编译器/校验器，正好构成一个无框架 agent 循环的全部要件：

```
有界循环（≤N 轮）:
  1. 模型看图（多模态输入）→ 提出 recipe 候选
  2. 确定性编译器 + validateLayout 验证候选        ← 复用现有设施
  3. 全过 → 返回；有败 → 把结构化错误喂回模型自修    ← 复用现有逐候选修复逻辑
```

价值：单次调用里模型修不好的候选，能在循环里自我纠正（现状是直接落 fallback）；成本：一个小循环体，无框架依赖。这就是"精简 agent"的形态——**协议把行为约束住了，agent 只需要专注推理**。

### 2.7 质量对照（先行）

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
