# DSV4.1 全链路产品实验报告（v5：新增脸/主体保留率，渲染原生分辨率）

- 时间：2026-10-02T18:23:47.610Z（总耗时 547695 ms）
- dev server：`pnpm dev --port 3111`（pid 19400，日志 `/Users/v/Documents/wallpaper-ai/temp/experiment-server.log`）
- env 覆盖：`VISION_ENABLED=true VISION_PLANNING_ENABLED=true VISION_MODEL=cn:glm-5v-turbo VISION_TIMEOUT_MS=60000 LLM_STREAMING=true LLM_TIMEOUT_MS=110000 ONE_TOUCH_STORAGE_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-assets ONE_TOUCH_COMPOSITION_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-compositions`（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 由仓库 .env 自动加载）
- visionPlanningGateRequested：`true`（false 时该轮以退出码 4 中止）
- 图片目录：`/Users/v/Downloads/wallpaper`（3 张 jpg）
- 评分实现：`scripts/evalScoring.mjs`（与 `scripts/eval-compositions.mjs` 共用，提取行为由其 `--check` 基线守护）

## 素材上传（POST /api/assets）

| 图片 | 尺寸 | analysisSource | contentType | 主色(average) | styleTags | bestUse | cropSafety | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 007gmkkdly1i36m19jlxhj32f51m1nln.jpg | 3137×2089 | basic | unknown | #412f31 | — | hero, background, triptych | medium | 60292 ms |
| aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg | 7680×4320 | basic | unknown | #afaccd | — | hero, background, triptych | medium | 60994 ms |
| wallhaven-p9vyge.jpg | 7680×4320 | vision | portrait | #434c6f | fantasy, digital art, magical, blue, ethereal, character art, dynamic, glowing | hero, background | medium | 14692 ms |

视觉补丁字段（subjectBox / saliencyCenter）明细：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：subjectBox=null；saliencyCenter=null；analysisWarnings=["Semantic vision analysis was unavailable; basic image analysis was used.. Reason: Request timed out."]
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：subjectBox=null；saliencyCenter=null；analysisWarnings=["Semantic vision analysis was unavailable; basic image analysis was used.. Reason: Request timed out."]
- **wallhaven-p9vyge.jpg**：subjectBox={"x":0.148,"y":0.093,"width":0.61,"height":0.907}；saliencyCenter={"x":0.498,"y":0.556}；analysisWarnings=[]

v5 检出观察（faces / subjectContour，保留率输入）：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：faces=0; subjectContour=none
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：faces=0; subjectContour=none
- **wallhaven-p9vyge.jpg**：faces=1 [{"x":0.492,"y":0.206,"width":0.07299999999999995,"height":0.141}]; subjectContour=grid-only, areaRatio 0.380

## E1：16:9 desktop single-hero（中文 prompt）

- HTTP：201（73526 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-1 | Safe Minimal Triptych | false | triptych (generated_safe_triptych_16_9_3) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.3372 / mean 0.3372 |
| candidate-2 | Editorial Hero + Stacked Supports | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.8500 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.8030 / mean 0.8030 |
| candidate-3 | Dynamic Layered Moodboard | false | layered-collage (generated_dynamic_layered-collage_16_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9993 / mean 0.9993 |

- **Safe Minimal Triptych**（candidate-1）：Ordered triptych with generous margins (0.06) and moderate hero share (0.55) to keep desktop-dock and icon areas clear; hero positioned left for left-to-right flow with safe-area-aware spacing.
[compiled] hero crop x=0.29 w=0.41; 3 slots
- **Editorial Hero + Stacked Supports**（candidate-2）：Asymmetric editorial layout using registered template; hero at 62% width on the left with two stacked supports on the right, creating magazine-style whitespace while respecting dock and icon safe zones.
[compiled] hero crop x=0.18 w=0.64; 3 slots
- **Dynamic Layered Moodboard**（candidate-3）：Layered collage with subtle depth and rotation contrast; hero at 54% share with slight -2° rotation, supports offset with opposing rotations, creating visual energy while maintaining quiet desktop usability.
[compiled] hero crop x=0.03 w=0.93; 3 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**
v5 保留率均分（候选级聚合）：脸保留 min 1.0000 / mean 1.0000 · 主体保留 min 0.7132 / mean 0.7132

渲染：`temp/renders-v5/E1-1-candidate-1.jpg` `temp/renders-v5/E1-2-candidate-2.jpg` `temp/renders-v5/E1-3-candidate-3.jpg`；拼条 `temp/renders-v5/strip-E1.jpg`
渲染说明（忽略/跳过项）：12 条，见 results.json

## E2：16:9 desktop balanced（无 prompt，纯自动）

- HTTP：201（74921 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Equal Triptych | false | triptych_desktop_equal (triptych_desktop_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.3155 / mean 0.3155 |
| candidate-editorial-2 | Editorial Hero with Side Stack | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.5639 / mean 0.5639 |
| candidate-dynamic-3 | Layered Moodboard with Depth | false | layered-collage (generated_dynamic_layered-collage_16_9_3) | 0.8500 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.7817 / mean 0.7817 |

- **Safe Equal Triptych**（candidate-safe-1）：Equal three-panel layout with generous margins keeps desktop icons and dock zones clear; balanced hierarchy respects the ordered rhythm and left-to-right flow.
[compiled] hero crop x=0.38 w=0.30; 3 slots
- **Editorial Hero with Side Stack**（candidate-editorial-2）：Asymmetric hero (60% width) on the left with two stacked supports on the right creates magazine-style hierarchy; heroShare capped at 0.6 to keep dock area clear, margin raised to 0.05 for safe zone compliance.
[compiled] hero crop x=0.26 w=0.54; 3 slots
- **Layered Moodboard with Depth**（candidate-dynamic-3）：Layered collage with rotated overlays and background fill creates visual depth; hero positioned left-of-center with subtle rotation, supports staggered on the right for dynamic flow while maintaining safe area clearance.
[compiled] hero crop x=0.14 w=0.77; 3 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**
v5 保留率均分（候选级聚合）：脸保留 min 1.0000 / mean 1.0000 · 主体保留 min 0.5537 / mean 0.5537

渲染：`temp/renders-v5/E2-1-candidate-safe-1.jpg` `temp/renders-v5/E2-2-candidate-editorial-2.jpg` `temp/renders-v5/E2-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-v5/strip-E2.jpg`
渲染说明（忽略/跳过项）：15 条，见 results.json

## E3：9:16 mobile minimal（移动端 safeAreas）

- HTTP：201（143400 ms）
- source：`ai`
- warnings：

  - Vision planning returned invalid plan JSON; one identical retry recovered the multimodal plan.

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Equal Triptych | false | triptych_mobile_equal (triptych_mobile_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.0927 / mean 0.0927 |
| candidate-editorial-2 | Editorial Hero + Split Supports | false | triptych_mobile_editorial (triptych_mobile_editorial) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.5793 / mean 0.5793 |
| candidate-dynamic-3 | Layered Moodboard with Depth | false | layered_moodboard_mobile (layered_moodboard_mobile) | 0.7600 | 1.0000 | 1.0000 | 0.6712 | 0.8904 | min 1.0000 / mean 1.0000 | min 0.5516 / mean 0.5516 |

- **Safe Equal Triptych**（candidate-safe-1）：Uses the registered triptych_mobile_equal template for a clean, ordered top-to-bottom flow with generous margins that keep the mobile clock and widget areas clear. Asset 3 (blue fantasy character with detected face) occupies the central hero slot with subject-focused cropping to preserve the face, while Assets 1 and 2 fill the support slots.
[compiled] hero crop x=0.00 w=1.00; 3 slots
- **Editorial Hero + Split Supports**（candidate-editorial-2）：Refines the triptych_mobile_editorial template with an asymmetric hierarchy: a large hero region (0.58 share) at the top for the fantasy character, and two side-by-side supports below creating magazine-style whitespace. Subject-focus crop on the hero preserves the detected face; safe area policy avoids the clock zone.
[compiled] hero crop x=0.00 w=1.00; 3 slots
- **Layered Moodboard with Depth**（candidate-dynamic-3）：Dynamic layered-collage recipe using the layered_moodboard_mobile template structure: Asset 2 (bright pastel fantasy) forms a soft background, Asset 3 (dark blue character) rotates slightly as the dominant hero overlay, and Asset 1 (red car portrait) anchors the bottom as a subtle support. Layering set to strong for pronounced stacking effect.
[compiled] hero crop x=0.26 w=0.53; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6543 · **total 0.8848**
v5 保留率均分（候选级聚合）：脸保留 min 1.0000 / mean 1.0000 · 主体保留 min 0.4079 / mean 0.4079

渲染：`temp/renders-v5/E3-1-candidate-safe-1.jpg` `temp/renders-v5/E3-2-candidate-editorial-2.jpg` `temp/renders-v5/E3-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-v5/strip-E3.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E4：21:9 ultrawide hero-support（英文 prompt）

- HTTP：201（96765 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-001 | Safe Left Hero with Clean Right Margin | false | triptych (generated_safe_triptych_21_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.4872 / mean 0.4872 |
| candidate-editorial-002 | Editorial Asymmetric Hero Left | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.7456 / mean 0.7456 |
| candidate-dynamic-003 | Dynamic Layered Collage with Left Anchor | false | layered-collage (generated_dynamic_layered-collage_21_9_3) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9530 / mean 0.9530 |

- **Safe Left Hero with Clean Right Margin**（candidate-safe-001）：Uses a structured triptych recipe with the hero anchored left at a conservative 0.55 share, leaving ample negative space on the right for desktop widgets and keeping the dock area clear with generous margins.
[compiled] hero crop x=0.29 w=0.47; 3 slots
- **Editorial Asymmetric Hero Left**（candidate-editorial-002）：Refines the editorial triptych template to place the hero on the left occupying ~60% width, with supports stacked vertically on the right creating intentional whitespace for widgets while maintaining magazine-style hierarchy.
[compiled] hero crop x=0.16 w=0.73; 3 slots
- **Dynamic Layered Collage with Left Anchor**（candidate-dynamic-003）：Uses a layered collage recipe with the hero positioned left at 0.58 share and slight rotation, supports layered with subtle depth on the right side, preserving negative space while adding visual energy through controlled overlap.
[compiled] hero crop x=0.00 w=1.00; 3 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**
v5 保留率均分（候选级聚合）：脸保留 min 1.0000 / mean 1.0000 · 主体保留 min 0.7286 / mean 0.7286

渲染：`temp/renders-v5/E4-1-candidate-safe-001.jpg` `temp/renders-v5/E4-2-candidate-editorial-002.jpg` `temp/renders-v5/E4-3-candidate-dynamic-003.jpg`；拼条 `temp/renders-v5/strip-E4.jpg`
渲染说明（忽略/跳过项）：12 条，见 results.json

## 汇总

| 场景 | 耗时 | source | focus | safeArea | color | total | 脸保留(min/mean) | 主体保留(min/mean) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 16:9 desktop single-hero（中文 prompt） | 73526 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.7132 / mean 0.7132 |
| E2 16:9 desktop balanced（无 prompt，纯自动） | 74921 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.5537 / mean 0.5537 |
| E3 9:16 mobile minimal（移动端 safeAreas） | 143400 ms | ai | 1.0000 | 1.0000 | 0.6543 | 0.8848 | min 1.0000 / mean 1.0000 | min 0.4079 / mean 0.4079 |
| E4 21:9 ultrawide hero-support（英文 prompt） | 96765 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.7286 / mean 0.7286 |

source=ai 场景数：4/4；全体候选平均 total：0.8827；退出码：0。
