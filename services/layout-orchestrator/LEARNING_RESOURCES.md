# LangGraph 学习资料与阅读顺序

资料以官方文档为主。第一课不要求通读，只阅读标注的部分。

## 第一课必读

### 1. LangGraph Graph API

[Graph API 官方文档](https://docs.langchain.com/oss/python/langgraph/graph-api)

重点阅读：

- `Graphs` 开头关于 State、Nodes、Edges 的定义；
- `StateGraph`；
- `State`、`Schema`；
- `Default reducer`；
- `Nodes`。

先记住三个结论：

```text
State：当前工作流的数据快照
Node：读取 State 并返回局部更新的普通函数
Edge：决定下一个执行哪个 Node
```

官方文档特别说明，节点不需要返回完整 State，只需要返回自己产生的更新。
这正是第一课要求“返回局部更新”的原因。

### 2. Python TypedDict

[Python typing 官方文档](https://docs.python.org/3/library/typing.html#typing.TypedDict)

重点理解：

- `TypedDict` 描述字典中允许出现的键和值类型；
- 它主要服务于静态类型检查，不会自动进行运行时校验；
- `total=False` 或 `NotRequired` 可以表达暂时不存在的字段。

思考题：`TypedDict` 和 Pydantic 分别适合 Graph State 与 API 请求校验中的哪一层？

### 3. pytest 入门

[pytest 官方入门](https://docs.pytest.org/en/stable/getting-started.html)

第一课只需要掌握：

- `test_` 命名约定；
- 普通 `assert`；
- 单独运行一个测试文件；
- 阅读失败信息。

常用命令：

```bash
uv run pytest
uv run pytest tests/test_validate_request.py
uv run pytest tests/test_validate_request.py -vv
```

### 4. uv 项目工作流

[uv 项目官方指南](https://docs.astral.sh/uv/guides/projects/)

当前只需理解：

- `pyproject.toml` 声明依赖和工具配置；
- `uv.lock` 固定可复现的依赖版本；
- `uv sync` 同步项目环境；
- `uv run` 在项目虚拟环境中执行命令。

## 推荐学习方法

每完成一个小功能，按以下顺序复盘：

1. 先画出输入 State 和输出更新。
2. 再解释节点为什么不修改原对象。
3. 写成功路径测试。
4. 写失败路径和边界测试。
5. 最后运行类型检查和代码规范检查。

遇到问题时，先记录自己的判断，再向 Codex 提问。不要直接索要完整答案，
这样更容易形成对状态流动的直觉。

## 暂时跳过

第一课不需要学习：

- Conditional Edges；
- Reducer 自定义合并；
- Checkpointer 与持久化；
- Interrupt 和 Human-in-the-loop；
- Tool Calling；
- 多 Agent；
- LangSmith。

这些内容会在 State 和 Node 掌握后逐步加入。
