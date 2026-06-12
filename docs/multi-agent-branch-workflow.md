# 多模型分支工作流

## 命名

统一使用：

```text
<agent>/<domain>-<deliverable>-<version>
```

示例：

```text
codex/core-ai-layout-contract-v1
claude/backend-llm-gateway-v1
gemini/frontend-ai-layout-workflow-v1
codex/test-ai-layout-e2e-v1
```

`domain` 使用 `core`、`backend`、`frontend`、`test`、`docs` 或
`integration`。分支名描述交付物，不使用 `dev`、`update` 等模糊名称。

## 集成顺序

1. 从最新 `main` 创建阶段集成分支，例如
   `codex/integration-ai-layout-v1`。
2. Core 分支先定义 Schema、类型和跨层协议，并优先合入集成分支。
3. Backend、Frontend 和 Test 从包含 Core 的集成分支并行创建。
4. 功能分支通过自身检查后使用 `--no-ff` 合入集成分支。
5. 集成分支运行全量测试、构建和视觉检查，再由维护者合入 `main`。

## 文件所有权

| Domain | 主要目录 |
| --- | --- |
| Core | `lib/layout-generation/*Schema*`、协议类型、Layout 物化 |
| Backend | `app/api`、Provider、模型配置、Prompt 和回退 |
| Frontend | `components/editor`、编辑器 UI 状态 |
| Test | `*.test.mjs`、`e2e`、Playwright 配置 |
| Docs | `README.md`、`.env.example`、`docs` |

如果任务必须修改其他 Domain 的文件，提交说明中需要明确原因。多个模型不要
同时重写 Core Schema 或 `EditorProvider`。

## 提交与检查

提交使用 Conventional Commits。每个提交只包含一个可说明的里程碑：

```text
feat(ai): add constrained layout plan contract
feat(ai): add OpenAI-compatible layout gateway
feat(editor): add AI layout generation workflow
test(ai): cover provider and editor workflows
docs(ai): document compatible model setup
```

合并前至少运行与改动相关的 `test`、`typecheck`、`lint` 和生产构建。测试
Provider 必须使用注入的 Mock，不允许默认 CI 访问真实付费模型。
