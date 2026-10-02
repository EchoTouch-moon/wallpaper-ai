# DSV4.1 全链路产品实验报告

- 时间：2026-10-02T15:49:02.808Z（总耗时 344145 ms）
- dev server：`pnpm dev --port 3111`（pid 97536，日志 `/Users/v/Documents/wallpaper-ai/temp/experiment-server.log`）
- env 覆盖：`VISION_ENABLED=true VISION_PLANNING_ENABLED=true VISION_MODEL=cn:glm-5v-turbo VISION_TIMEOUT_MS=60000 LLM_STREAMING=true LLM_TIMEOUT_MS=110000 ONE_TOUCH_STORAGE_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-assets ONE_TOUCH_COMPOSITION_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-compositions`（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 由仓库 .env 自动加载）
- visionPlanningGateRequested：`true`（false 时该轮以退出码 4 中止）
- 图片目录：`/Users/v/Downloads/wallpaper`（3 张 jpg）
- 评分实现：`scripts/evalScoring.mjs`（与 `scripts/eval-compositions.mjs` 共用，提取行为由其 `--check` 基线守护）

## 素材上传（POST /api/assets）

| 图片 | 尺寸 | analysisSource | contentType | 主色(average) | styleTags | bestUse | cropSafety | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 007gmkkdly1i36m19jlxhj32f51m1nln.jpg | 3137×2089 | basic | unknown | #412f31 | — | hero, background, triptych | medium | 4227 ms |
| aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg | 7680×4320 | basic | unknown | #afaccd | — | hero, background, triptych | medium | 5185 ms |
| wallhaven-p9vyge.jpg | 7680×4320 | basic | unknown | #434c6f | — | hero, background, triptych | medium | 6919 ms |

视觉补丁字段（subjectBox / saliencyCenter）明细：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：subjectBox=null；saliencyCenter=null；analysisWarnings=["Semantic vision analysis was unavailable; basic image analysis was used.. Reason: [ { \"expected\": \"object\", \"code\": \"invalid_type\", \"path\": [ \"subjectBox\" ], \"message\": \"Invalid input: expected object, received array\" }, { \"expected\": \"object\", \"code\": \"invalid_type\", \"path\": [ \"saliencyCenter\" ], \"message\": \"Invalid inp"]
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：subjectBox=null；saliencyCenter=null；analysisWarnings=["Semantic vision analysis was unavailable; basic image analysis was used.. Reason: [ { \"code\": \"invalid_value\", \"values\": [ \"portrait\", \"landscape\", \"anime\", \"pet\", \"architecture\", \"object\", \"text-heavy\", \"unknown\" ], \"path\": [ \"contentType\" ], \"message\": \"Invalid option: expected one of \\\"portrait\\\"|\\\"landscape\\\"|\\\"anime"]
- **wallhaven-p9vyge.jpg**：subjectBox=null；saliencyCenter=null；analysisWarnings=["Semantic vision analysis was unavailable; basic image analysis was used.. Reason: [ { \"code\": \"invalid_value\", \"values\": [ \"portrait\", \"landscape\", \"anime\", \"pet\", \"architecture\", \"object\", \"text-heavy\", \"unknown\" ], \"path\": [ \"contentType\" ], \"message\": \"Invalid option: expected one of \\\"portrait\\\"|\\\"landscape\\\"|\\\"anime"]

## E1：16:9 desktop single-hero（中文 prompt）

- HTTP：201（86885 ms）
- source：`ai`
- warnings：

  - Vision planning failed; fell back to text-only planning. (Layout model request timed out)
  - 1 deterministic candidate completed the model set.
  - Near-duplicate model candidates were replaced.

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-minimal | Safe Minimal Hero Grid | false | hero-grid (generated_safe_hero-grid_16_9_3) | 0.8700 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-editorial-minimal | Editorial Asymmetric Whitespace | false | balanced-mosaic (generated_editorial_balanced-mosaic_16_9_3) | 0.8400 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| composition_dynamic | Dynamic Depth | true | layered-collage (generated_dynamic_layered-collage_16_9_3) | 0.9630 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

- **Safe Minimal Hero Grid**（candidate-safe-minimal）：Ordered single-hero layout with conservative gaps and clear margins; hero anchored left, supports stacked right, dock and left icon zones kept quiet.
[compiled] hero crop x=0.22 w=0.56; 3 slots
- **Editorial Asymmetric Whitespace**（candidate-editorial-minimal）：Asymmetric hero-left composition with magazine-like whitespace; light support introduces contrast while dark support keeps the flow calm.
[compiled] hero crop x=0.21 w=0.59; 3 slots
- **Dynamic Depth**（composition_dynamic）：Controlled overlap and scale contrast create a deeper spatial composition.

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**

渲染：`temp/renders-dsv41/E1-1-candidate-safe-minimal.jpg` `temp/renders-dsv41/E1-2-candidate-editorial-minimal.jpg` `temp/renders-dsv41/E1-3-composition_dynamic.jpg`；拼条 `temp/renders-dsv41/strip-E1.jpg`
渲染说明（忽略/跳过项）：12 条，见 results.json

## E2：16:9 desktop balanced（无 prompt，纯自动）

- HTTP：201（59737 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Equal Triptych | false | triptych_desktop_equal (triptych_desktop_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-editorial-2 | Editorial Hero + Two Stacked | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.8600 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-dynamic-3 | Dynamic Layered Moodboard | false | layered_moodboard_desktop (layered_moodboard_desktop) | 0.7900 | 1.0000 | 1.0000 | 0.7344 | 0.9115 |

- **Safe Equal Triptych**（candidate-safe-1）：Ordered three-panel layout with generous margins keeps desktop icons and dock zones clear; equal distribution respects balanced hierarchy.
[compiled] hero crop x=0.32 w=0.36; 3 slots
- **Editorial Hero + Two Stacked**（candidate-editorial-2）：Asymmetric hero on left (62% share) with two supports stacked right creates magazine rhythm; rounded corners and whitespace deliver editorial feel while respecting dock safe area via margin.
[compiled] hero crop x=0.18 w=0.64; 3 slots
- **Dynamic Layered Moodboard**（candidate-dynamic-3）：Layered collage with rotated cards over dark background; hero at 54% share with slight overlap and controlled margins keeps dock clear while delivering depth and energy.
[compiled] hero crop x=0.15 w=0.70; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6754 · **total 0.8918**

渲染：`temp/renders-dsv41/E2-1-candidate-safe-1.jpg` `temp/renders-dsv41/E2-2-candidate-editorial-2.jpg` `temp/renders-dsv41/E2-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-dsv41/strip-E2.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E3：9:16 mobile minimal（移动端 safeAreas）

- HTTP：201（71834 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Equal Triptych | false | triptych_mobile_equal (triptych_mobile_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-editorial-2 | Editorial Hero + Split Supports | false | triptych_mobile_editorial (triptych_mobile_editorial) | 0.8600 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| candidate-dynamic-3 | Layered Moodboard with Depth | false | layered_moodboard_mobile (layered_moodboard_mobile) | 0.7900 | 1.0000 | 1.0000 | 0.7254 | 0.9085 |

- **Safe Equal Triptych**（candidate-safe-1）：Ordered vertical triptych with generous margins keeping mobile clock and widget zones clear; equal bands preserve all faces with standard cropping.
[compiled] hero crop x=0.00 w=1.00; 3 slots
- **Editorial Hero + Split Supports**（candidate-editorial-2）：Magazine-style layout with dominant hero in upper two-thirds and asymmetric split supports below; rounded corners and intentional whitespace create editorial rhythm while respecting safe areas.
[compiled] hero crop x=0.00 w=1.00; 3 slots
- **Layered Moodboard with Depth**（candidate-dynamic-3）：Layered collage with rotated hero and overlapping supports creating depth; background asset sets mood while foreground layers build visual hierarchy with controlled overlap.
[compiled] hero crop x=0.19 w=0.63; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6724 · **total 0.8908**

渲染：`temp/renders-dsv41/E3-1-candidate-safe-1.jpg` `temp/renders-dsv41/E3-2-candidate-editorial-2.jpg` `temp/renders-dsv41/E3-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-dsv41/strip-E3.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E4：21:9 ultrawide hero-support（英文 prompt）

- HTTP：201（93632 ms）
- source：`ai`
- warnings：

  - Vision planning failed; fell back to text-only planning. (Layout model request timed out)
  - 1 deterministic candidate completed the model set.
  - Near-duplicate model candidates were replaced.

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cand-safe-1 | Safe Ultrawide Hero Left | false | hero-grid (generated_safe_hero-grid_21_9_3) | 0.7800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| cand-editorial-1 | Editorial Asymmetric Ultrawide | false | balanced-mosaic (generated_editorial_balanced-mosaic_21_9_3) | 0.7400 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| composition_dynamic | Dynamic Depth | true | layered-collage (generated_dynamic_layered-collage_21_9_3) | 0.9630 | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

- **Safe Ultrawide Hero Left**（cand-safe-1）：Conservative hero-grid with a left-weighted hero, generous margins, and restrained supports to preserve quiet right-side breathing room for desktop widgets.
[compiled] hero crop x=0.18 w=0.63; 3 slots
- **Editorial Asymmetric Ultrawide**（cand-editorial-1）：Magazine-style asymmetry with a dark hero anchoring the left and two restrained supports, keeping the right side intentionally open for widgets.
[compiled] hero crop x=0.17 w=0.66; 3 slots
- **Dynamic Depth**（composition_dynamic）：Controlled overlap and scale contrast create a deeper spatial composition.

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**

渲染：`temp/renders-dsv41/E4-1-cand-safe-1.jpg` `temp/renders-dsv41/E4-2-cand-editorial-1.jpg` `temp/renders-dsv41/E4-3-composition_dynamic.jpg`；拼条 `temp/renders-dsv41/strip-E4.jpg`
渲染说明（忽略/跳过项）：12 条，见 results.json

## 汇总

| 场景 | 耗时 | source | focus | safeArea | color | total |
| --- | --- | --- | --- | --- | --- | --- |
| E1 16:9 desktop single-hero（中文 prompt） | 86885 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 |
| E2 16:9 desktop balanced（无 prompt，纯自动） | 59737 ms | ai | 1.0000 | 1.0000 | 0.6754 | 0.8918 |
| E3 9:16 mobile minimal（移动端 safeAreas） | 71834 ms | ai | 1.0000 | 1.0000 | 0.6724 | 0.8908 |
| E4 21:9 ultrawide hero-support（英文 prompt） | 93632 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 |

source=ai 场景数：4/4；全体候选平均 total：0.8866；退出码：3。
