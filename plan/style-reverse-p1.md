# 风格逆向 P1 端到端验收（2026-10-04）

运行：`node --experimental-strip-types --env-file=.env temp/style-reverse-run.mjs`（原始数据：`temp/style-reverse-run-data.json`）。
链路：参考图 → `lib/server/styleReverse.ts` 反推（VLM 语义 + 本地几何自检）→ `packages/core` 确定性编译 → `temp/render-layouts.mjs` 原生分辨率渲染。

## 1. 协议改动（本轮 uncommitted diff 涉及）

- `packages/core/src/layout/templateRecipe.ts`：family 新增 `diagonal-collage`；`slotIntentSchema.treatment`（`full|crop|cutout`，默认 `crop`）；`diagonalCollageParamsSchema`（`backgroundColor/axis(bl-tr|tl-br)/heroShare/supportShare/overlap`，默认 0.46/0.24/0.3）。
- `packages/core/src/layout/layoutSchema.ts`：`wallpaperItemSchema.treatment` 透传（默认 `crop`）；`canvas.backgroundColor` 默认 `transparent`。
- `packages/core/src/layout/compileTemplateRecipe.ts`：diagonal-collage 分支接 `planDiagonalCollageSlots`；短素材按序丢次图槽；overlap-by-design 族不做避让式重排。
- `packages/core/src/layout/planTemplate.ts`：`planDiagonalCollageSlots` + `createLayoutItem` 透传 treatment + diagonal 族 canvas 纯色底来自配方。
- `lib/server/styleReverse.ts`（新）：反推引擎 —— VLM（moonpulse，默认 `cn:glm-5v-turbo`）出 recipe/styleNotes/confidence（zod 校验失败带错误重试一次），本地 sharp 层做前景块检测 + 编译槽位平均最优匹配 IoU 自检；`hint`（上轮配方+检测块+IoU）支持定向重推。

## 2. 逆向流程

1. `detectReferenceBlocks`：参考图缩到 256 工作分辨率 → 边框主导色为底 → RGB 距离 >48 的像素为前景 → 4-连通块（归一化 bbox，最大 8 块）。
2. VLM 单次调用（图 + 结构化 prompt）→ `{recipe, styleNotes, confidence}`，zod 校验（含 `templateRecipeSchema`）。
3. `compileRecipeSlotRects`：配方用假方形灰图编译出槽位框（排除 layered 背景），`averageBestMatchIoU` 对检测块取平均最优匹配 IoU（`boxIoU` 与 localVision 同源）。
4. IoU < 0.5 时可带 hint 重推（本轮 xhs 用到 1 次，每图额外重推 ≤ 1 次）。

## 3. 五张种子表

| 参考 | family | 主槽 treatment | confidence | selfCheckIoU | notes（风格描述 + 协议外元素） |
| --- | --- | --- | --- | --- | --- |
| xhs-diagonal-ref.jpg | diagonal-collage | crop | 0.85 | 0.3096 | diagonal-collage（dynamic/asymmetric/overlap）：双主图对角bl-tr两端 + 4 次图沿轴叠压(overlap 0.35)，纯色底 #5C6B4A；协议表达不了：The layout features a strong diagonal axis from bottom-left to top-right with significant overlapping elements. It includes decorative text banners (标题, 装饰文字), ornamental shapes (装饰), and circular accent stickers (点缀) that are not captured by the standard slot system. The background has a solid olive-green tone, and the composition uses a mix of rectangular and non-rectangular decorative overlays with varying opacities and soft edges. |
| canva-34c8dc8b0a16.jpg | layered-collage | crop | 0.85 | 0.4574 | layered-collage（editorial/layered/paper-edge）：center 主图 share 0.55 + 2 次图，检测底色 #ECE9E4；协议表达不了：The recipe captures the layered, scrapbook-style composition with a central hero image and two polaroid-style support photos, but cannot express the specific decorative text overlays (e.g., 'Only for you', Chinese typography, dates), the handwritten script background texture, the botanical line art illustrations, or the precise white border/polaroid frame styling and slight rotation angles of the support images. |
| canva-50687fae91bd.jpg | hero-grid | crop | 0.85 | 0.1704 | hero-grid（editorial/asymmetric/soft-shadow）：left 主图 share 0.48 + 4 次图，检测底色 #E7F9FD；协议表达不了：The layout mimics a digital desktop or social media interface with UI chrome (browser bars, window controls, close buttons) framing the images as 'windows'. It features heavy typographic overlays in mixed Chinese/English script, decorative starburst and sparkle graphics, soft gradient backgrounds, and drop shadows that give a floating card effect. The aesthetic is bright, airy, and journal-like with pastel blue tones. |
| canva-92133cbf73dd.jpg | hero-grid | crop | 0.85 | 0.3065 | hero-grid（editorial/ordered/soft-shadow）：center 主图 share 0.38 + 4 次图，检测底色 #F9F9F8；协议表达不了：The layout features a textured kraft paper background with torn edges and handwritten script overlays. Photos are styled as Polaroid prints with thick white borders, slight rotations, and realistic drop shadows. Decorative elements include a binder clip on the hero image, washi tape strips, paper stickers (butterfly, ginkgo leaf, flower, camera), and text banners ('SUNDAY', 'THIS WEEK') in mixed fonts. Handwritten dates and Chinese captions are placed at the bottom of specific frames. |
| canva-fbf87736e32b.jpg | layered-collage | crop | 0.75 | 0.177 | layered-collage（dynamic/asymmetric/overlap）：right 主图 share 0.35 + 4 次图，检测底色 #16120F；协议表达不了：The layout is heavily decorated with a scrapbook aesthetic, featuring a polka-dot background pattern, lace doily borders, decorative tape (washi), paper bows, star-shaped frames, and handwritten text banners in both Chinese and English. The central visual element is a metallic lunchbox/tin container that acts as a physical frame for two of the support images, while other photos are overlaid with whimsical stickers like teddy bears and headphones. |

（`detectedBackgroundColor` 为本地边框主导色检测：见 `temp/style-reverse-run-data.json`。）

## 4. xhs 验收数据

- 反推轮次：2（含 hint 重推）；第 1 轮 family=diagonal-collage supportCount=4 IoU=0.3096 → hint 重推（layered-collage supportCount=3）IoU=0.1941 反而更差，按"取 IoU 更优"保留第 1 轮；最终 family=diagonal-collage supportCount=4。
- selfCheckIoU=0.3096（阈值 0.5：不达标，如实记录）；confidence=0.85。
- 本地检测底色 #576B46；配方 diagonal={"backgroundColor":"#5C6B4A","axis":"bl-tr","heroShare":0.45,"supportShare":0.25,"overlap":0.35}。
- 底色近似说明：配方底色 #5C6B4A 与参考事实 #4A5D3A 的 RGB 距离 27.9（< 48 判定阈值，记近似不记严重不符）；参考 JPEG 本地边框主导色实测 #576B46（距 #4A5D3A 22.6），说明压缩后参考图自身底色已偏移。
- 事实核对（diagonal-collage / 5 槽 / #4A5D3A / 3:4）：family 与 3:4 相符；槽位数 6 ≠ 5（supportCount=4 vs 3，记 warning）；底色近似（见上）。
- 编译槽位（3:4 @1800×2400，assetCount=6，素材 3 张 → 确定性轮转复用（usedFallback=true））：
  - hero (hero): x=0.0338 y=0.5288 w=0.4374 h=0.4374 z=3
  - hero-2 (hero): x=0.5288 y=0.0338 w=0.4374 h=0.4374 z=4
  - support-1 (support): x=0.20075 y=0.62523 w=0.225 h=0.225 z=1
  - support-2 (support): x=0.28175 y=0.44227 w=0.225 h=0.225 z=2
  - support-3 (support): x=0.49325 y=0.33273 w=0.225 h=0.225 z=1
  - support-4 (support): x=0.58325 y=0.15877 w=0.207 h=0.207 z=2
  - canvas 底色：#5C6B4A

### 渲染清单

- /Users/v/Documents/wallpaper-ai/temp/style-reverse-out/xhs-34-1-reverse-diagonal-collage.jpg
- /Users/v/Documents/wallpaper-ai/temp/style-reverse-out/xhs-1610-1-reverse-diagonal-collage.jpg
- /Users/v/Documents/wallpaper-ai/temp/style-reverse-out/contact-sheet.png（参考图 vs 成果图左右对比）

## 5. 遗留问题（协议表达不了的元素，如实列出）

- xhs 参考的装饰元素（粉色标题条、装饰文字块、椭圆点缀）超出图片槽协议 —— 反推记入 styleNotes，decorSlots 留待 P3（plan/style-library-seeds.md 既定边界）。
- 3:4（1800×2400）不在 `WallpaperRatioId` 枚举内：编译按任意 ratioId 字符串可跑，`planTemplateCandidate` 的 usage/safeAreas 按 desktop 兜底（仅标注，不影响几何）。
- 素材 3 张 < 配方槽位 6 时 `planTemplateCandidate` 确定性复用素材（usedFallback=true；hero=photo-3、hero-2=photo-2、support-1=photo-2、support-2=photo-1、support-3=photo-3、support-4=photo-1）。
- 几何自检的检测块是像素级连通域：与参考图的标注文字/装饰共用底色时可能并块或漏块，IoU 噪声如实记录。
- xhs-diagonal-ref.jpg styleNotes（VLM 自述协议外）：The layout features a strong diagonal axis from bottom-left to top-right with significant overlapping elements. It includes decorative text banners (标题, 装饰文字), ornamental shapes (装饰), and circular accent stickers (点缀) that are not captured by the standard slot system. The background has a solid olive-green tone, and the composition uses a mix of rectangular and non-rectangular decorative overlays with varying opacities and soft edges.
- canva-34c8dc8b0a16.jpg styleNotes（VLM 自述协议外）：The recipe captures the layered, scrapbook-style composition with a central hero image and two polaroid-style support photos, but cannot express the specific decorative text overlays (e.g., 'Only for you', Chinese typography, dates), the handwritten script background texture, the botanical line art illustrations, or the precise white border/polaroid frame styling and slight rotation angles of the support images.
- canva-50687fae91bd.jpg styleNotes（VLM 自述协议外）：The layout mimics a digital desktop or social media interface with UI chrome (browser bars, window controls, close buttons) framing the images as 'windows'. It features heavy typographic overlays in mixed Chinese/English script, decorative starburst and sparkle graphics, soft gradient backgrounds, and drop shadows that give a floating card effect. The aesthetic is bright, airy, and journal-like with pastel blue tones.
- canva-92133cbf73dd.jpg styleNotes（VLM 自述协议外）：The layout features a textured kraft paper background with torn edges and handwritten script overlays. Photos are styled as Polaroid prints with thick white borders, slight rotations, and realistic drop shadows. Decorative elements include a binder clip on the hero image, washi tape strips, paper stickers (butterfly, ginkgo leaf, flower, camera), and text banners ('SUNDAY', 'THIS WEEK') in mixed fonts. Handwritten dates and Chinese captions are placed at the bottom of specific frames.
- canva-fbf87736e32b.jpg styleNotes（VLM 自述协议外）：The layout is heavily decorated with a scrapbook aesthetic, featuring a polka-dot background pattern, lace doily borders, decorative tape (washi), paper bows, star-shaped frames, and handwritten text banners in both Chinese and English. The central visual element is a metallic lunchbox/tin container that acts as a physical frame for two of the support images, while other photos are overlaid with whimsical stickers like teddy bears and headphones.

### 运行期 warnings

- xhs-diagonal-ref.jpg: Geometry self-check IoU 0.3096 is below the 0.5 target; pass this result as a hint to re-reverse the reference
- canva-34c8dc8b0a16.jpg: Geometry self-check IoU 0.4574 is below the 0.5 target; pass this result as a hint to re-reverse the reference
- canva-50687fae91bd.jpg: Geometry self-check IoU 0.1704 is below the 0.5 target; pass this result as a hint to re-reverse the reference
- canva-92133cbf73dd.jpg: Geometry self-check IoU 0.3065 is below the 0.5 target; pass this result as a hint to re-reverse the reference
- canva-fbf87736e32b.jpg: Geometry self-check IoU 0.177 is below the 0.5 target; pass this result as a hint to re-reverse the reference
- xhs 反推槽位数 6（supportCount=4），与参考事实 5 槽（2 主图 + 3 次图）不符
- xhs selfCheckIoU=0.3096 < 0.5（hint 重推后仍不达标），按实测记录
