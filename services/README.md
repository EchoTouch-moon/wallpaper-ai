# services/ — 冻结的实验线

本目录是**冻结的历史实验资产**，主产品链路不再经过它。

- `layout-orchestrator/`：Python LangGraph 排版编排服务（LangGraph + postgres
  checkpoint + `/api/layout-sessions/[sessionId]/approve` 审批流）。
- 自 2026-10 协议优先（protocol-first）策略落地后，实施后端统一为 TypeScript：
  `/api/generate-layout` 的 ai 模式直接走 `handleGenerateLayoutRequest`（TS），
  Python 侧接线（`LAYOUT_ENGINE`、`LAYOUT_ORCHESTRATOR_URL`、审批代理）已移除。
- 树内代码与测试原地保留、不做维护，仅作历史参考。

**复活条件**：若重启本实验线，必须实现 `LayoutModelProvider` v2 接口接入协议层，
不得旁路。背景与决策记录见
[plan/deep-optimization-roadmap.md](../plan/deep-optimization-roadmap.md) 方向 B。
