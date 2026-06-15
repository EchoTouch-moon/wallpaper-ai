# Layout Orchestrator 学习服务

这里是一个独立的 Python 3.12 工作区，用于在正式迁移布局编排服务之前，
循序渐进地学习 LangGraph。

## 环境初始化

```bash
cd services/layout-orchestrator
uv sync
```

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
