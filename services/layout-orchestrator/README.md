# Layout Orchestrator 学习服务

这里是一个独立的 Python 3.12 工作区，用于在正式迁移布局编排服务之前，
循序渐进地学习 LangGraph。

## 环境初始化

```bash
cd services/layout-orchestrator
uv sync
```

## 运行真实模型服务

服务兼容原项目的 `LLM_*` 变量，也兼容学习环境的
`DASHSCOPE_API_KEY` 与 `DASHSCOPE_BASE_URL`。未配置模型时会使用
受限的本地规划器，浏览器 BFF 仍能回退到本地规则。

```bash
uv run uvicorn layout_orchestrator.api:app --reload --port 8000
```

然后在 Next.js 环境中设置：

```bash
LAYOUT_ENGINE=langgraph
LAYOUT_ORCHESTRATOR_URL=http://127.0.0.1:8000
```

本地会话默认保存在 SQLite。部署时运行：

```bash
docker compose -f docker-compose.langgraph.yml up --build
```

该 compose 配置使用 PostgreSQL LangGraph checkpoint；不要将真实密钥写入
compose 文件，改由 shell 环境或部署平台的秘密管理注入。

日常命令不需要手动激活虚拟环境：

```bash
uv run pytest
uv run ruff check .
uv run mypy
```

## 学习边界

脚手架刻意没有实现应用 Graph。第一课由你亲自定义 Graph State，并实现一个
请求校验节点。掌握这些基础之前，暂不加入 FastAPI、模型调用、重试、持久化
和 Next.js 集成。

开始编码前请依次阅读：

1. [第一课：状态与请求校验](LESSON_01.md)
2. [学习资料与阅读顺序](LEARNING_RESOURCES.md)

后续课程、任务说明、代码审查和复盘统一使用中文；Python 标识符和 Git
提交信息保留英文。
