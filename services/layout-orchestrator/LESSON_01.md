# 第一课：状态与请求校验

## 学习目标

实现未来布局 Graph 中最小但有实际意义的一段：

```text
输入请求 → validate_request 节点 → 合法请求或校验错误
```

这一课不要编译 `StateGraph`，也不要调用模型。先理解 State 和 Node 之间
如何传递数据。

## 你的任务

创建以下文件：

```text
src/layout_orchestrator/graph/state.py
src/layout_orchestrator/graph/nodes.py
tests/test_validate_request.py
```

### 1. 定义 State

使用 `TypedDict` 定义 `LayoutGraphState`，包含以下可选字段：

- `request: dict[str, object]`
- `validated_request: dict[str, object]`
- `validation_errors: list[str]`

编码前先思考：为什么 Graph 执行过程中，不是每个 State 字段都必须存在？

### 2. 实现 `validate_request`

节点接收 `LayoutGraphState`，返回一个局部 State 更新。

本练习中，合法请求必须满足：

- `canvas` 是字典；
- `assets` 是列表且至少包含三个元素；
- `intent` 是字典。

校验成功时：

- 返回 `validated_request`；
- 返回空的 `validation_errors`。

校验失败时：

- 不抛出异常；
- 每个缺失或非法字段返回一条清晰的错误信息；
- 不返回 `validated_request`。

节点不得修改传入的原始 State。

### 3. 编写测试

至少覆盖：

- 一个合法请求；
- 缺少 `canvas`；
- `assets` 少于三个；
- 证明原始 State 没有被修改。

## 完成检查

```bash
uv run pytest
uv run ruff check .
uv run mypy
```

全部通过后，先不要提交。告诉 Codex“第一课写完了”，进入代码审查和复盘。

## 复盘问题

准备解释：

1. 节点读取了哪些 State 字段？
2. 节点写回了哪些字段？
3. 为什么校验失败进入 State，而不是直接抛异常？
4. 为什么节点只返回局部更新，而不是完整 State？
