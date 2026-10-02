# DSV4.1 全链路产品实验报告

- 时间：2026-10-02T13:38:00.582Z（总耗时 392753 ms）
- dev server：`pnpm dev --port 3111`（pid 78688，日志 `/Users/v/Documents/wallpaper-ai/temp/experiment-server.log`）
- env 覆盖：`VISION_ENABLED=true VISION_PLANNING_ENABLED=true VISION_MODEL=cn:glm-5v-turbo VISION_TIMEOUT_MS=60000 LLM_STREAMING=true LLM_TIMEOUT_MS=110000 ONE_TOUCH_STORAGE_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-assets ONE_TOUCH_COMPOSITION_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-compositions`（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 由仓库 .env 自动加载）
- visionPlanningGateRequested：`true`（false 时该轮以退出码 4 中止）
- 图片目录：`/Users/v/Downloads/wallpaper`（3 张 jpg）
- 评分实现：`scripts/evalScoring.mjs`（与 `scripts/eval-compositions.mjs` 共用，提取行为由其 `--check` 基线守护）

## 素材上传（POST /api/assets）

| 图片 | 尺寸 | analysisSource | contentType | 主色(average) | styleTags | bestUse | cropSafety | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 007gmkkdly1i36m19jlxhj32f51m1nln.jpg | 3137×2089 | vision | unknown | #412f31 | — | hero, background | medium | 3077 ms |
| aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg | 7680×4320 | vision | unknown | #afaccd | — | hero, background | medium | 6365 ms |
| wallhaven-p9vyge.jpg | 7680×4320 | basic | unknown | #434c6f | — | hero, background, triptych | medium | 5032 ms |

视觉补丁字段（subjectBox / saliencyCenter）明细：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：subjectBox={"x":0.07,"y":0,"width":0.8,"height":0.99}；saliencyCenter={"x":0.47000000000000003,"y":0.495}；analysisWarnings=[]
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：subjectBox={"x":0.265,"y":0.01,"width":0.58,"height":0.865}；saliencyCenter={"x":0.5549999999999999,"y":0.4425}；analysisWarnings=[]
- **wallhaven-p9vyge.jpg**：subjectBox=null；saliencyCenter=null；analysisWarnings=["Semantic vision analysis was unavailable; basic image analysis was used.. Reason: Vision model returned an array without usable box_2d detection entries"]

## E1：16:9 desktop single-hero（中文 prompt）

- HTTP：201（118371 ms）
- source：`ai`
- warnings：

  - Vision planning failed; fell back to text-only planning. (Layout model returned invalid plan JSON)
  - 1 deterministic candidate completed the model set.
  - Near-duplicate model candidates were replaced.

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Minimal Hero | false | hero-grid (generated_safe_hero-grid_16_9_3) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-editorial-1 | Editorial Quiet Asymmetry | false | balanced-mosaic (generated_editorial_balanced-mosaic_16_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| composition_dynamic | Dynamic Depth | true | layered-collage (generated_dynamic_layered-collage_16_9_3) | 0.9630 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

- **Safe Minimal Hero**（candidate-safe-1）：Ordered hero-grid keeps the hero prominent on the left with generous margin, leaving desktop icon and dock safe areas clear.
[compiled] hero crop x=0.19 w=0.55; 3 slots
- **Editorial Quiet Asymmetry**（candidate-editorial-1）：Asymmetric mosaic gives the hero a strong left anchor while the right supports breathe, preserving icon and dock safe areas.
[compiled] hero crop x=0.18 w=0.58; 3 slots
- **Dynamic Depth**（composition_dynamic）：Controlled overlap and scale contrast create a deeper spatial composition.

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**

## E2：16:9 desktop balanced（无 prompt，纯自动）

- HTTP：201（98542 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Equal Triptych | false | triptych_desktop_equal (triptych_desktop_equal) | 0.8200 | 1.0000 | 0.2315 | 0.6459 | 0.6258 |
| candidate-editorial-2 | Editorial Hero Left + Stacked Supports | false | hero-grid (generated_editorial_hero-grid_16_9_3) | 0.7800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-dynamic-3 | Dynamic Layered Collage | false | layered-collage (generated_dynamic_layered-collage_16_9_3) | 0.7500 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

- **Safe Equal Triptych**（candidate-safe-1）：Uses the registered triptych_desktop_equal template for a clean, ordered three-panel layout with generous margins that keep the desktop-dock and icon areas clear. Asset 2 (bright, high-contrast) anchors the center as hero, flanked by the darker assets for visual balance.
[compiled] hero crop x=0.27 w=0.58; 3 slots
- **Editorial Hero Left + Stacked Supports**（candidate-editorial-2）：Recipe-based editorial layout with the hero (Asset 3, dark blue magical theme) occupying the left 58% with rounded corners, and two support images stacked on the right creating magazine-style whitespace and asymmetric rhythm.
[compiled] hero crop x=0.26 w=0.48; 3 slots
- **Dynamic Layered Collage**（candidate-dynamic-3）：Layered-collage recipe using Asset 1 as full-bleed background, with Asset 2 as the rotated hero overlay (bright pop against dark base) and Asset 3 as a smaller angled support, creating depth through slight overlap and rotation.
[compiled] hero crop x=0.27 w=0.58; 3 slots

场景均分：focus 1.0000 · safeArea 0.7438 · color 0.6459 · **total 0.7966**

## E3：9:16 mobile minimal（移动端 safeAreas）

- HTTP：201（85013 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Equal Triptych | false | triptych_mobile_equal (triptych_mobile_equal) | 0.8200 | 1.0000 | 0.0550 | 0.6459 | 0.5670 |
| candidate-editorial-2 | Editorial Hero + Dual Support | false | triptych_mobile_editorial (triptych_mobile_editorial) | 0.8800 | 1.0000 | 0.0000 | 0.6459 | 0.5486 |
| candidate-dynamic-3 | Layered Moodboard Collage | false | layered-collage (generated_dynamic_layered-collage_9_16_3) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

- **Safe Equal Triptych**（candidate-safe-1）：Uses the registered triptych_mobile_equal template with generous margins (3.5%) that keep the mobile-clock and widget-center safe areas clear. The hero occupies the middle third with equal support strips above and below, providing an ordered, conservative layout suitable for minimal density.
[compiled] hero crop x=0.07 w=0.80; 3 slots
- **Editorial Hero + Dual Support**（candidate-editorial-2）：Uses the registered triptych_mobile_editorial template with asymmetric hierarchy: a dominant hero occupying the upper 63% of canvas, and two side-by-side supports below. Rounded corners (radius 0.025) and intentional whitespace create magazine-style rhythm while respecting safe areas.
[compiled] hero crop x=0.10 w=0.75; 3 slots
- **Layered Moodboard Collage**（candidate-dynamic-3）：Parameterized layered-collage recipe with strong layering, rotated slots creating depth overlap, and a background fill layer. Hero positioned upper-center at 50% share with two angled supports below. The dynamic arrangement creates visual energy while keeping clock/widget zones relatively quiet.
[compiled] hero crop x=0.22 w=0.62; 3 slots

场景均分：focus 1.0000 · safeArea 0.3517 · color 0.6459 · **total 0.6658**

## E4：21:9 ultrawide hero-support（英文 prompt）

- HTTP：201（74041 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe: Left Hero with Clean Right Margin | false | triptych (generated_safe_triptych_21_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-editorial-2 | Editorial: Asymmetric Hero Left with Intentional Whitespace | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.8800 | 1.0000 | 0.3098 | 0.6459 | 0.6519 |
| candidate-dynamic-3 | Dynamic: Layered Left Hero with Depth and Right Openness | false | layered-collage (generated_dynamic_layered-collage_21_9_3) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

- **Safe: Left Hero with Clean Right Margin**（candidate-safe-1）：Uses a structured triptych recipe with the hero anchored left (heroShare 0.55) and generous right margin (0.08) to keep the desktop-dock and icon areas clear, providing ample quiet negative space on the right for widgets.
[compiled] hero crop x=0.21 w=0.51; 3 slots
- **Editorial: Asymmetric Hero Left with Intentional Whitespace**（candidate-editorial-2）：Applies an editorial asymmetric rhythm with a dominant left hero (heroShare 0.62) and a single slim support strip, leaving over 30% of the canvas as calm negative space on the right—ideal for desktop widget visibility.
[compiled] hero crop x=0.08 w=0.92; 3 slots
- **Dynamic: Layered Left Hero with Depth and Right Openness**（candidate-dynamic-3）：Employs a layered-collage approach with strong left hero placement (heroShare 0.58), slight rotational layering for depth, and substantial right-side negative space preserved for widgets while maintaining visual energy.
[compiled] hero crop x=0.00 w=1.00; 3 slots

场景均分：focus 1.0000 · safeArea 0.7699 · color 0.6459 · **total 0.8053**

## 汇总

| 场景 | 耗时 | source | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- |
| E1 16:9 desktop single-hero（中文 prompt） | 118371 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| E2 16:9 desktop balanced（无 prompt，纯自动） | 98542 ms | ai | 1.0000 | 0.7438 | 0.6459 | 0.7966 |
| E3 9:16 mobile minimal（移动端 safeAreas） | 85013 ms | ai | 1.0000 | 0.3517 | 0.6459 | 0.6658 |
| E4 21:9 ultrawide hero-support（英文 prompt） | 74041 ms | ai | 1.0000 | 0.7699 | 0.6459 | 0.8053 |

source=ai 场景数：4/4；全体候选平均 total：0.7874；退出码：0。
