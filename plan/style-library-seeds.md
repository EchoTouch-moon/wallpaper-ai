# 风格库种子：参考图分解（2026-10-04）

逆向工程（风格反推）的参考图集。P1 目标：把「操作规则」反推成 TemplateRecipe；
P2 入库为可复用风格。原始大图在 `temp/style-refs/`（gitignored），
副本存于 `/Users/v/Downloads/wallpaper-styles/`。

## 1. xhs-diagonal-ref.jpg（用户提供，P1 验收目标）

小红书版式示意图（色块带「主图/次主图/装饰/标题」标注，信息密度高）。

- **画布**：3:4 竖版；纯色底 **橄榄绿 #4A5D3A**，无渐变无纹理
- **骨架**：一条左下 → 右上的**对角虚线轴**贯穿版面
- **图片槽 5 个**：2 张主图分踞对角两端（大），3 张次图沿轴交错叠压
  （各槽均带标注角色；无间距、硬叠压、矩形直角裁切）
- **装饰**：粉色标题条（撞色）、装饰文字块 ×1、椭圆点缀 ×3
- **风格**：杂志感扁平拼贴，无阴影无圆角

**协议缺口**（P1 要补）：
1. 槽位处理方式 `treatment: full | crop | cutout` 不存在
2. 五个配方族（hero-grid / balanced-mosaic / triptych / stacked-story /
   layered-collage）无一能表达「对角轴交错」→ 需新增 `diagonal-collage` 族
3. 文字/装饰槽位（标题条、椭圆）超出图片槽协议 → P1 不做，记入 styleNotes，
   P3 再议 decorSlots

## 2. canva-92133cbf73dd.jpg — 复古手帐拼贴（P2 种子）

- 1:1；牛皮纸/羊皮纸底 + 撕纸边缘异形纸片 + 格纹胶带（左下、右上）
- 图片块：拍立得式（白边留框）为主，小幅旋转错位，自由叠压非网格
- treatment 需求：`full`（带白边）——白边目前表达不了，记 styleNotes

## 3. canva-fbf87736e32b.jpg — 波点底 PLOG（P2 种子）

- 3:4；黑底 + 奶黄波点规则网格；上下白色蕾丝花边横带
- 图片块 7 个：横竖混合、大小错落、含手写标注与文字贴纸
- 族近似：layered-collage；波点/蕾丝为背景纹理，超表达力，记 styleNotes

## 4. canva-50687fae91bd.jpg — 浏览器窗口框中框（P2 种子）

- ~5:4；浅青纯色底；右侧 2/3 叠一个圆角「浏览器窗口」容器
  （macOS 三色圆点 + 搜索栏），图片以网页截图形式排布窗口内
- 族近似：hero-grid / layered-collage；窗口容器 = 容器嵌套，超表达力

## 5. canva-34c8dc8b0a16.jpg — 人物写真拼贴（P2 种子，分解待补）

人物写真多图拼贴（分解时 VLM 限流，P1 工作流内用 cn:glm-5v-turbo 补齐）。

## 汇总：P1 / P2 边界

| 参考 | 目标族 | treatment | 归属 |
| --- | --- | --- | --- |
| xhs-diagonal-ref | **diagonal-collage（新）** | crop + cutout 可选 | **P1 验收** |
| canva-92133cbf73dd | layered-collage 近似 | full（白边） | P2 库种子 |
| canva-fbf87736e32b | layered-collage 近似 | crop | P2 库种子 |
| canva-50687fae91bd | hero-grid 近似 | crop | P2 库种子 |
| canva-34c8dc8b0a16 | 待分解 | 待定 | P2 库种子 |
