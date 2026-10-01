# 深度优化路线图（P1+ / P2）

状态快照（2026-10-01）：P0（门禁修复、落库、CI）与首批 P1 维护项（契约脚本、死代码、空目录、包边界、planningRatio 去重、Turbopack 恢复）已完成并推送 `desktop/dynamic-layer-v1`。本路线图基于当日代码调查，覆盖更深层的架构与质量方向。

---

## 方向 A：生成协议统一（消除 legacyRequest 双栈）— 推荐首选

> 2026-10-01 更新：本方向已扩展为「多模态编排协议 v2」——与"让规划 LLM 看到图片、通过受约束控制词表驱动编排"合并设计，详见 [multimodal-planning-protocol-design.md](./multimodal-planning-protocol-design.md)。

**现状（证据）**

- OneTouch 主链路：`/api/compositions` → `generateCompositionCandidatesAsync` → `OpenAICompatibleLayoutProvider.generatePlan({ request: legacyRequest(brief, assets) })`。`generateCompositionCandidatesAsync.ts` 的 `legacyRequest()` 把 `CompositionBrief` 翻译回旧的 `GenerateLayoutRequest` 形状（`intent.mode/style/compositionIntent/safeArea/count`）喂给 provider。
- Editor 链路：`/api/generate-layout` → `handleGenerateLayoutRequest`（template/mock-ai/ai 三模式）与 `handleLangGraphGenerateLayoutRequest`（Python LangGraph）。
- 后果：provider 的 prompt 协议、`aiPlanSchema`、Pydantic `contracts.py` 全部锚定旧形状；brief 的新语义（hierarchy/density/rhythm/visualFlow/heroAssetId）被压扁成 `compositionIntent`/`safeArea` 枚举，**信息有损**，后续语义能力（如密度微调）到不了模型。

**目标**：provider plan 协议直接消费 `CompositionBrief`（输出端的 `TemplateRecipe` 约束不变），`legacyRequest` 退役。

**步骤**

1. 定义 brief 原生的 plan 请求 schema（输入端换血，输出端 `aiPlanSchema` 的 recipe 约束原样保留）。
2. `provider.generatePlan` 改吃 brief；Editor 的 ai 模式同步切换（或保留旧协议为显式 compat 层，标注退役期限）。
3. 删除 `legacyRequest`，补协议回归测试；`.env.example` 的 `LAYOUT_ENGINE` 语义随之一并清理。

**风险**：prompt 行为变化影响生成质量 → 用 `scripts/smoke-layout-model.mjs` 与固定输入的 deterministic fallback 对比验证。

**工作量**：1-2 人日。**验证门**：183 单测 + 6 e2e + smoke + 契约 parity 全绿。

---

## 方向 B：LangGraph 实验线收敛（需要产品决策，勿单方面执行）

**现状**：`services/layout-orchestrator`（LangGraph + postgres checkpoint + `/api/layout-sessions/[sessionId]/approve` 审批流）完整存在、有 7 个测试文件，但 OneTouch 主产品不经过它；`LAYOUT_ENGINE=legacy` 为默认。`store/editorStore` 等 Editor 设施仍在活跃使用（7 个组件引用），不是死代码。

**选项**

| 选项 | 内容 | 成本 |
| --- | --- | --- |
| B1 保留实验线 | 维持现状，文档标注定位 | ≈0 |
| B2 收缩冻结 | Editor ai 模式默认走 OpenAI-compatible provider，LangGraph 移入 archive 分支 | 0.5 人日 |
| B3 深化整合 | LangGraph 作为可插拔 provider 接入 brief 协议（与方向 A 联动） | 2-3 人日 |

**决策点**：产品方向问题，需要用户拍板后执行。

---

## 方向 C：跨语言契约对称收口（小而确定）

**现状（`test_contract_parity.py` 注释明确记录的两处已知不对称）**

1. `imageAssetAnalysisSchema`（Zod）非 `.strict()`，Pydantic 孪生 `ImageAssetAnalysis` 是 `extra="forbid"` → 资产内未知字段一边收一边拒。
2. `currentLayout`：前端 strict `wallpaperLayoutSchema`，后端 loose `dict[str, object] | None`。

**步骤**：前者加 `.strict()`（注意 Editor 工程 localStorage 历史数据兼容——宽松读入 + 严格写出，或版本迁移）；后者把 Pydantic 侧升级为结构化模型或前端放宽为与后端一致。同步启用 python 测试里被避开的资产未知字段用例。

**工作量**：0.5 人日。**验证**：契约 parity 测试（含新用例）通过。

---

## 方向 D：性能与体积（先测量后立项）

- 上传分析管线：`temporaryAssetStore` 中 sharp 解码与 `analyzePixels` 的重复 IO 审查。
- bundle：fabric（编辑器）与 gsap（studio）按入口拆分——主页面不应背上编辑器依赖。
- e2e 当前 6 spec ≈ 12s，健康，无需动。

**步骤**：`@next/bundle-analyzer` 产出 baseline → 按数据立项。**工作量**：测量 0.5 人日 + 按发现另计。

---

## 方向 E：CI 强化

- e2e 进 CI（playwright 浏览器缓存 + webServer 就绪探测，预计 +3-4 min）。
- pnpm store 缓存缩短 install。
- 契约 parity（python + uv）作为可选 job。

**工作量**：0.5 人日。

---

## 方向 F：外部依赖项（本机无法完成）

- `apps/wallpaper-host`（Rust/Windows）真机验证：P2.4 定时轮换、区域级换控、Explorer 恢复状态机。
- 真实大模型质量：需 `LLM_API_KEY`；建议先建小型评估集（10 个 brief × 3 候选，启发式评分 + 人工抽检），让方向 A 的协议改造有质量对照。

---

## 建议执行顺序

**C（半天，确定性收益）→ A（核心架构收益）→ E（巩固防线）→ D（测量驱动）**；B 待用户决策，F 待外部条件。
