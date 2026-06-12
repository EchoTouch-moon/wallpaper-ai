# AI Wallpaper Studio

可编辑的 AI 照片壁纸工作室，技术栈为 Next.js、TypeScript、Tailwind
CSS、Fabric.js、Zustand 和 Zod。

## 已有能力

- JPG、PNG、WebP 多图上传和浏览器本地图片分析。
- 桌面与手机壁纸比例、安全区和高清 PNG 导出。
- Fabric 图片移动、缩放、旋转、裁剪、换图、图层和吸附。
- 四类注册模板、Mock AI 推荐、候选预览与推荐理由。
- Canonical Layout JSON、应用/序列化往返和 50 步撤销重做。
- IndexedDB 素材与单草稿自动保存、刷新恢复。
- OpenAI-compatible AI 排版和自然语言布局修改。
- 模型失败时自动回退本地规则，原始图片不会发送到模型服务。

## 模型配置

复制 `.env.example` 的变量到本地环境：

```bash
LLM_API_KEY=your-key
LLM_BASE_URL=https://provider.example/v1
LLM_MODEL=your-model
LLM_RESPONSE_FORMAT=json_object
LLM_TIMEOUT_MS=30000
```

`LLM_BASE_URL` 是 OpenAI-compatible API 根路径，服务端会调用
`/chat/completions`。响应格式支持：

- `json_object`：默认，适合多数兼容服务。
- `json_schema`：仅在服务明确支持 Structured Outputs 时使用。
- `text`：从普通文本中提取并校验首个 JSON 值。

模型只返回注册模板、槽位素材和归一化裁剪计划。服务端会依次执行 Zod
解析、引用校验、本地 Layout 物化和最终边界校验。API Key、原图、
Object URL 和 Fabric 对象均不会进入客户端请求或模型提示词。

未配置模型时，AI 模式会显示本地回退结果；也可以在排版面板直接选择
“本地规则”。

## Development

```bash
npm install
npm run dev
```

质量检查：

```bash
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

## 协作

多模型开发采用 `<agent>/<domain>-<deliverable>-<version>` 分支格式，文件
所有权和合并顺序见
[多模型分支工作流](docs/multi-agent-branch-workflow.md)。

架构说明见
[AI Wallpaper Studio 架构总览](docs/AI_Wallpaper_Studio_Architecture_Overview.md)，
最新状态见
[2026-06-12 项目进展报告](docs/project-progress-report-2026-06-12.md)。

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Delete` / `Backspace` | 删除选区 |
| `Cmd/Ctrl + D` | 复制选区 |
| Arrow keys | 微调 1 px |
| `Shift + Arrow keys` | 微调 10 px |
| `Cmd/Ctrl + [` / `]` | 调整图层顺序 |
| `Escape` | 清除选区 |
| `Tab` on the canvas | 切换聚焦模式 |
