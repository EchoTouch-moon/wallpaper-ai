# P0 完成记录：抽取 `@wallpaper/core` 共享包

- **状态**: ✅ 完成，零回归验证全绿
- **分支**: `desktop/dynamic-layer-v1`
- **日期**: 2026-07-03

## 目标
把 web 项目的 AI 排版/壁纸规则核心抽成 `@wallpaper/core` 包，让 web 与未来的桌面应用共享一份代码，且 web 端**零回归**。

## 做了什么

### 1. 建立 pnpm workspace
- 新增 `pnpm-workspace.yaml`（`packages/*` + `apps/*`）
- 切换包管理器：npm → pnpm（删除 `package-lock.json`，生成 `pnpm-lock.yaml`）
- 处理 pnpm 11 的 `strictDepBuilds` 默认拦截：在 workspace yaml 加 `dangerouslyAllowAllBuilds: true`

### 2. 抽取 `packages/core`
迁移以下内容到 `packages/core/src/`（用 `git mv` 保留历史）：
- `lib/{layout,layout-generation,wallpaper,image,fabric,editor}/` 全部
- `lib/storage/projectSnapshot.ts`
- `types/` 全部（5 个类型文件）

**留在 web 端**（不进 core）：
- `lib/storage/projectDatabase.ts`（IndexedDB，浏览器专属；桌面端会另写 SQLite）

### 3. 包内 import 改造
- core 包内 67 处 `@/lib/X`、`@/types/X` 别名 → **相对路径**（让任意 TS 编译器都能解析，不依赖 tsconfig paths）
- core 的 8 个 barrel `index.ts` 加 `.ts` 扩展名（兼容 Node `--experimental-strip-types` 的严格 ESM 解析）

### 4. web 端改写
- 33 处 `@/lib/X` / `@/types/X` → `@wallpaper/core/{layout,layout-generation,wallpaper,image,fabric,editor,types,storage}`
- 2 个 API route 的相对路径 import → `@wallpaper/core/layout-generation`
- web 的 `test` 脚本去掉已迁移的 `lib/*/*.test.mjs`

### 5. tsconfig 调整
- 根 tsconfig `exclude` 增加 `packages`、`apps`（避免用根别名编译 core 源码）

## 包结构
```
packages/core/
├── package.json          # @wallpaper/core, exports 8 个子路径
├── tsconfig.json
└── src/
    ├── index.ts          # 主 barrel（types + wallpaper + editor）
    ├── types/index.ts    # 所有共享类型
    ├── layout/           # 模板、布局、swap、校验
    ├── layout-generation/# AI 排版全套
    ├── wallpaper/        # 分辨率/比例/安全区/构图
    ├── image/            # 色彩分析、图片分析（browser API）
    ├── fabric/           # Fabric 适配（DOM 耦合）
    ├── editor/           # 历史、layout request
    └── storage/          # projectSnapshot
```

## 子路径导出（`package.json` exports）
- `@wallpaper/core`
- `@wallpaper/core/layout`
- `@wallpaper/core/layout-generation`
- `@wallpaper/core/wallpaper`
- `@wallpaper/core/image`
- `@wallpaper/core/fabric`
- `@wallpaper/core/editor`
- `@wallpaper/core/storage`
- `@wallpaper/core/types`

## 零回归验证（全绿）
| 检查 | 结果 |
|---|---|
| core typecheck | ✅ |
| web typecheck | ✅ |
| core tests | ✅ 63/63 |
| web tests | ✅ 11/11 |
| lint | ✅ |
| build (Next.js production) | ✅ |

## 验证命令
```bash
# core 包
cd packages/core && npx tsc --noEmit
cd packages/core && node --test --experimental-strip-types $(find src -name "*.test.mjs")

# web 端
npx tsc --noEmit
npx eslint .
node --test --experimental-strip-types app/api/*/*.test.mjs
pnpm build
```

## 下一步（P1）
WorkerW 嵌入 PoC：Electron 壳 + `electron-as-wallpaper` 包，桌面层显示静态三联画。
主战场在 Windows 验证机；Mac 上先建 `desktop-platform` 接口 + mock 实现跑业务逻辑。
