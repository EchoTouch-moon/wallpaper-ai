# DSV4.1 全链路产品实验报告

- 时间：2026-10-02T16:18:29.782Z（总耗时 416717 ms）
- dev server：`pnpm dev --port 3111`（pid 2204，日志 `/Users/v/Documents/wallpaper-ai/temp/experiment-server.log`）
- env 覆盖：`VISION_ENABLED=true VISION_PLANNING_ENABLED=true VISION_MODEL=cn:glm-5v-turbo VISION_TIMEOUT_MS=60000 LLM_STREAMING=true LLM_TIMEOUT_MS=110000 ONE_TOUCH_STORAGE_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-assets ONE_TOUCH_COMPOSITION_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-compositions`（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 由仓库 .env 自动加载）
- visionPlanningGateRequested：`true`（false 时该轮以退出码 4 中止）
- 图片目录：`/Users/v/Downloads/wallpaper`（3 张 jpg）
- 评分实现：`scripts/evalScoring.mjs`（与 `scripts/eval-compositions.mjs` 共用，提取行为由其 `--check` 基线守护）

## 素材上传（POST /api/assets）

| 图片 | 尺寸 | analysisSource | contentType | 主色(average) | styleTags | bestUse | cropSafety | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 007gmkkdly1i36m19jlxhj32f51m1nln.jpg | 3137×2089 | vision | portrait | #412f31 | automotive, fashion, night, vibrant, urban, editorial | hero | low | 4044 ms |
| aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg | 7680×4320 | vision | portrait | #afaccd | fantasy, anime, vibrant, ethereal, dynamic, pastel, magical, character-art | hero, background | medium | 5812 ms |
| wallhaven-p9vyge.jpg | 7680×4320 | vision | portrait | #434c6f | fantasy art, digital painting, magical, blue aesthetic, game character, dynamic pose | hero, background | medium | 5042 ms |

视觉补丁字段（subjectBox / saliencyCenter）明细：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：subjectBox={"x":0.203,"y":0.062,"width":0.5780000000000001,"height":0.938}；saliencyCenter={"x":0.5,"y":0.525}；analysisWarnings=[]
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：subjectBox={"x":0.265,"y":0,"width":0.58,"height":1}；saliencyCenter={"x":0.55,"y":0.45}；analysisWarnings=[]
- **wallhaven-p9vyge.jpg**：subjectBox={"x":0.152,"y":0.096,"width":0.596,"height":0.902}；saliencyCenter={"x":0.515,"y":0.525}；analysisWarnings=[]

## E1：16:9 desktop single-hero（中文 prompt）

- HTTP：201（146391 ms）
- source：`ai`
- warnings：

  - Vision planning returned invalid plan JSON; one identical retry recovered the multimodal plan.

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe: Minimal Triptych with Icon Space | false | triptych (generated_safe_triptych_16_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-editorial-2 | Editorial: Asymmetric Hero with Right Supports | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-dynamic-3 | Dynamic: Layered Moodboard with Depth | false | layered_moodboard_desktop (layered_moodboard_desktop) | 0.7600 | 1.0000 | 1.0000 | 0.7344 | 0.9115 |

- **Safe: Minimal Triptych with Icon Space**（candidate-safe-1）：Uses a clean triptych layout with generous margins (0.06) to keep the left icon area and bottom dock clear. Hero share capped at 0.55 ensures the dock zone remains visible. Ordered rhythm and clean-gap boundaries match the quiet, minimal aesthetic.
[compiled] hero crop x=0.15 w=0.70; 3 slots
- **Editorial: Asymmetric Hero with Right Supports**（candidate-editorial-2）：Magazine-style asymmetric layout with hero on the left (62% width) and two supports stacked on the right, creating intentional whitespace. Margin of 0.05 keeps the dock clear while heroShare at 0.6 is the maximum allowed for desktop-dock safety. Asymmetric rhythm with soft-shadow boundaries for editorial polish.
[compiled] hero crop x=0.12 w=0.66; 3 slots
- **Dynamic: Layered Moodboard with Depth**（candidate-dynamic-3）：Layered collage using the blue-toned fantasy art as a muted background, with the hero photo and pastel support overlaid with slight rotation (-2°/+3°). Layering set to 'slight' for subtle depth without clutter. Margin 0.08 and heroShare 0.54 ensure ample dock and icon clearance. The cool background (#282840) unifies the disparate image styles into a cohesive quiet mood.
[compiled] hero crop x=0.18 w=0.64; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6754 · **total 0.8918**

渲染：`temp/renders-dsv41/E1-1-candidate-safe-1.jpg` `temp/renders-dsv41/E1-2-candidate-editorial-2.jpg` `temp/renders-dsv41/E1-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-dsv41/strip-E1.jpg`
渲染说明（忽略/跳过项）：14 条，见 results.json

## E2：16:9 desktop balanced（无 prompt，纯自动）

- HTTP：201（82377 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-1 | Safe: Equal Triptych with Balanced Spacing | false | triptych_desktop_equal (triptych_desktop_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-2 | Editorial: Asymmetric Hero with Stacked Supports | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.7800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-3 | Dynamic: Layered Collage with Depth Overlap | false | layered-collage (generated_dynamic_layered-collage_16_9_3) | 0.7500 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

- **Safe: Equal Triptych with Balanced Spacing**（candidate-1）：Uses the registered triptych_desktop_equal template for a clean, ordered three-panel layout. Equal column widths (30.9%) and generous 3.6% margins keep the desktop-dock and icon areas clear. The automotive portrait (Asset 1) anchors the center hero position, flanked by the two fantasy character arts in supporting roles.
[compiled] hero crop x=0.15 w=0.70; 3 slots
- **Editorial: Asymmetric Hero with Stacked Supports**（candidate-2）：Refines the triptych_desktop_editorial template for magazine-style hierarchy. The hero (Asset 2, pastel fantasy) occupies 62% of the canvas on the left with rounded corners, while the remaining 30% on the right is split into two stacked support slots for the dark fantasy (Asset 3) and automotive (Asset 1) images. Hero share capped at 0.62 to respect the desktop-dock safe area.
[compiled] hero crop x=0.18 w=0.64; 3 slots
- **Dynamic: Layered Collage with Depth Overlap**（candidate-3）：Parameterized layered-collage recipe with strong layering and slight overlap boundary. The dark blue fantasy art (Asset 3) serves as an immersive background. The automotive portrait (Asset 1) rotates -2° as the dominant hero at 54% share, while the pastel fantasy character (Asset 2) sits as a smaller rotated support. Margin raised to 0.06 to keep dock area clear despite the dynamic composition.
[compiled] hero crop x=0.12 w=0.72; 3 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**

渲染：`temp/renders-dsv41/E2-1-candidate-1.jpg` `temp/renders-dsv41/E2-2-candidate-2.jpg` `temp/renders-dsv41/E2-3-candidate-3.jpg`；拼条 `temp/renders-dsv41/strip-E2.jpg`
渲染说明（忽略/跳过项）：15 条，见 results.json

## E3：9:16 mobile minimal（移动端 safeAreas）

- HTTP：201（75634 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-1 | Safe - Equal Triptych | false | triptych_mobile_equal (triptych_mobile_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-2 | Editorial - Hero + Split Supports | false | triptych_mobile_editorial (triptych_mobile_editorial) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-3 | Dynamic - Layered Moodboard | false | layered_moodboard_mobile (layered_moodboard_mobile) | 0.7900 | 1.0000 | 1.0000 | 0.6712 | 0.8904 |

- **Safe - Equal Triptych**（candidate-1）：Ordered equal triptych with generous margins keeping mobile clock and widget areas clear; conservative cropping respects all faces and text.
[compiled] hero crop x=0.15 w=0.70; 3 slots
- **Editorial - Hero + Split Supports**（candidate-2）：Asymmetric editorial layout with dominant hero in upper two-thirds and split supports below; magazine-style whitespace with rounded corners.
[compiled] hero crop x=0.12 w=0.70; 3 slots
- **Dynamic - Layered Moodboard**（candidate-3）：Layered collage with rotated overlapping elements creating depth; pastel fantasy asset as background anchors the moody blue palette.
[compiled] hero crop x=0.12 w=0.72; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6543 · **total 0.8848**

渲染：`temp/renders-dsv41/E3-1-candidate-1.jpg` `temp/renders-dsv41/E3-2-candidate-2.jpg` `temp/renders-dsv41/E3-3-candidate-3.jpg`；拼条 `temp/renders-dsv41/strip-E3.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E4：21:9 ultrawide hero-support（英文 prompt）

- HTTP：201（83485 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-1 | Safe: Left Hero with Right Negative Space | false | triptych (generated_safe_triptych_21_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-2 | Editorial: Asymmetric Left Hero with Generous Right Whitespace | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-3 | Dynamic: Layered Collage with Left Hero and Depth Overlap | false | layered-collage (generated_dynamic_layered-collage_21_9_3) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

- **Safe: Left Hero with Right Negative Space**（candidate-1）：Uses a clean triptych recipe with the hero anchored left at 55% share, leaving the right 30% as quiet negative space for desktop widgets. Conservative margin of 0.05 keeps content clear of dock and icon safe areas. Asset 1 (automotive portrait) serves as a strong left-side focal point with subject-focused cropping.
[compiled] hero crop x=0.15 w=0.70; 3 slots
- **Editorial: Asymmetric Left Hero with Generous Right Whitespace**（candidate-2）：Refines the editorial triptych template with hero on the left at 60% width, creating magazine-style asymmetric rhythm. The right column stacks two supports vertically, leaving substantial negative space on the far right for widgets. Margin raised to 0.06 to respect the desktop-dock safe area.
[compiled] hero crop x=0.12 w=0.72; 3 slots
- **Dynamic: Layered Collage with Left Hero and Depth Overlap**（candidate-3）：Uses a layered-collage recipe with the hero positioned left at 52% share and slight -2° rotation for energy. The background asset (blue fantasy character) fills the canvas with moody atmosphere while two supports overlap subtly on the right, preserving negative space for widgets. Layering set to 'slight' for controlled depth.
[compiled] hero crop x=0.18 w=0.64; 3 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**

渲染：`temp/renders-dsv41/E4-1-candidate-1.jpg` `temp/renders-dsv41/E4-2-candidate-2.jpg` `temp/renders-dsv41/E4-3-candidate-3.jpg`；拼条 `temp/renders-dsv41/strip-E4.jpg`
渲染说明（忽略/跳过项）：12 条，见 results.json

## 汇总

| 场景 | 耗时 | source | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- |
| E1 16:9 desktop single-hero（中文 prompt） | 146391 ms | ai | 1.0000 | 1.0000 | 0.6754 | 0.8918 |
| E2 16:9 desktop balanced（无 prompt，纯自动） | 82377 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| E3 9:16 mobile minimal（移动端 safeAreas） | 75634 ms | ai | 1.0000 | 1.0000 | 0.6543 | 0.8848 |
| E4 21:9 ultrawide hero-support（英文 prompt） | 83485 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

source=ai 场景数：4/4；全体候选平均 total：0.8851；退出码：0。
