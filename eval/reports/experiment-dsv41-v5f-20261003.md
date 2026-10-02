# DSV4.1 全链路产品实验报告（v5：新增脸/主体保留率，渲染原生分辨率）

- 时间：2026-10-02T19:04:06.756Z（总耗时 658662 ms）
- dev server：`pnpm dev --port 3111`（pid 28905，日志 `/Users/v/Documents/wallpaper-ai/temp/experiment-server.log`）
- env 覆盖：`VISION_ENABLED=true VISION_PLANNING_ENABLED=true VISION_MODEL=cn:glm-5v-turbo VISION_TIMEOUT_MS=180000 LLM_STREAMING=true LLM_TIMEOUT_MS=110000 ONE_TOUCH_STORAGE_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-assets ONE_TOUCH_COMPOSITION_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-compositions`（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 由仓库 .env 自动加载）
- visionPlanningGateRequested：`true`（false 时该轮以退出码 4 中止）
- 图片目录：`/Users/v/Downloads/wallpaper`（3 张 jpg）
- 评分实现：`scripts/evalScoring.mjs`（与 `scripts/eval-compositions.mjs` 共用，提取行为由其 `--check` 基线守护）

## 素材上传（POST /api/assets）

| 图片 | 尺寸 | analysisSource | contentType | 主色(average) | styleTags | bestUse | cropSafety | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 007gmkkdly1i36m19jlxhj32f51m1nln.jpg | 3137×2089 | basic | unknown | #412f31 | — | hero, background, triptych | medium | 120554 ms |
| aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg | 7680×4320 | vision | portrait | #afaccd | fantasy, anime, vibrant, ethereal, action, digital art, pastel, magical | hero, background | medium | 14771 ms |
| wallhaven-p9vyge.jpg | 7680×4320 | basic | unknown | #434c6f | — | hero, background, triptych | medium | 121073 ms |

视觉补丁字段（subjectBox / saliencyCenter）明细：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：subjectBox=null；saliencyCenter=null；analysisWarnings=["Semantic vision analysis was unavailable; basic image analysis was used.. Reason: 502 上游不可用:"]
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：subjectBox={"x":0.265,"y":0,"width":0.58,"height":0.875}；saliencyCenter={"x":0.525,"y":0.45}；analysisWarnings=[]
- **wallhaven-p9vyge.jpg**：subjectBox=null；saliencyCenter=null；analysisWarnings=["Semantic vision analysis was unavailable; basic image analysis was used.. Reason: 502 上游不可用:"]

v5 检出观察（faces / subjectContour，保留率输入）：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：faces=0; subjectContour=none
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：faces=0; subjectContour=grid-only, areaRatio 0.350
- **wallhaven-p9vyge.jpg**：faces=0; subjectContour=none

## E1：16:9 desktop single-hero（中文 prompt）

- HTTP：201（84117 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe - Minimal Equal Triptych | false | triptych_desktop_equal (triptych_desktop_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.5394 / mean 0.5394 |
| candidate-editorial-2 | Editorial - Asymmetric Hero Left | false | triptych (generated_editorial_triptych_16_9_3) | 0.7900 | 0.9884 | 1.0000 | 0.6459 | 0.8781 | — | min 0.0000 / mean 0.0000 |
| candidate-dynamic-3 | Dynamic - Layered Moodboard | false | layered_moodboard_desktop (layered_moodboard_desktop) | 0.7600 | 0.9680 | 1.0000 | 0.6964 | 0.8882 | — | min 0.0057 / mean 0.2003 |

- **Safe - Minimal Equal Triptych**（candidate-safe-1）：Uses the registered triptych_desktop_equal template with equal vertical panels, generous margins (1.8%) keeping content clear of desktop-dock and icon safe areas, hero centered as the focal point, supporting the '极简安静' (minimalist quiet) intent with ordered rhythm.
[compiled] hero crop x=0.15 w=0.65; 3 slots
- **Editorial - Asymmetric Hero Left**（candidate-editorial-2）：Parameterized triptych recipe with hero positioned left at 58% width (capped under 0.6 to respect desktop-dock safe area), margin 5% ensuring dock clearance, asymmetric rhythm with two right-side supports stacked vertically, creating magazine-style whitespace on the right for icons.
[compiled] hero crop x=0.29 w=0.42; 3 slots
- **Dynamic - Layered Moodboard**（candidate-dynamic-3）：Uses the registered layered_moodboard_desktop template with background fill, hero slightly rotated (-2°) at 54% share with 8% margin keeping dock area clear, layered boundary with slight depth overlap between hero and supports, creating visual interest while maintaining the quiet desktop aesthetic.
[compiled] hero crop x=0.12 w=0.68; 4 slots

场景均分：focus 0.9855 · safeArea 1.0000 · color 0.6627 · **total 0.8827**
v5 保留率均分（候选级聚合）：脸保留 — · 主体保留 min 0.1817 / mean 0.2466

渲染：`temp/renders-v5/E1-1-candidate-safe-1.jpg` `temp/renders-v5/E1-2-candidate-editorial-2.jpg` `temp/renders-v5/E1-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-v5/strip-E1.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E2：16:9 desktop balanced（无 prompt，纯自动）

- HTTP：201（61888 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-1 | Safe Equal Triptych | false | triptych_desktop_equal (triptych_desktop_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.3135 / mean 0.3135 |
| candidate-2 | Editorial Hero + Stacked Supports | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.7142 / mean 0.7142 |
| candidate-3 | Dynamic Layered Moodboard | false | layered_moodboard_desktop (layered_moodboard_desktop) | 0.7600 | 1.0000 | 1.0000 | 0.7344 | 0.9115 | — | min 0.9452 / mean 0.9452 |

- **Safe Equal Triptych**（candidate-1）：Ordered three-column layout with generous margins keeps desktop icons and dock zones clear; balanced hierarchy suits the mixed photo/illustration set.
[compiled] hero crop x=0.40 w=0.30; 3 slots
- **Editorial Hero + Stacked Supports**（candidate-2）：Asymmetric hero-left composition with two stacked supports on the right creates magazine-style rhythm; left-to-right flow guides eye from photo through illustrations.
[compiled] hero crop x=0.18 w=0.64; 3 slots
- **Dynamic Layered Moodboard**（candidate-3）：Layered collage with rotated cards and slight overlap adds depth; dark blue background unifies the disparate color palettes while preserving face-safe cropping on all assets.
[compiled] hero crop x=0.15 w=0.70; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6754 · **total 0.8918**
v5 保留率均分（候选级聚合）：脸保留 — · 主体保留 min 0.6576 / mean 0.6576

渲染：`temp/renders-v5/E2-1-candidate-1.jpg` `temp/renders-v5/E2-2-candidate-2.jpg` `temp/renders-v5/E2-3-candidate-3.jpg`；拼条 `temp/renders-v5/strip-E2.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E3：9:16 mobile minimal（移动端 safeAreas）

- HTTP：201（160901 ms）
- source：`ai`
- warnings：

  - Vision planning returned invalid plan JSON; one identical retry recovered the multimodal plan.

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Equal Triptych | false | triptych_mobile_equal (triptych_mobile_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.5273 / mean 0.5273 |
| candidate-editorial-2 | Editorial Hero + Split Supports | false | triptych_mobile_editorial (triptych_mobile_editorial) | 0.7800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.5209 / mean 0.5209 |
| candidate-dynamic-3 | Layered Moodboard with Depth | false | layered_moodboard_mobile (layered_moodboard_mobile) | 0.7500 | 1.0000 | 1.0000 | 0.7254 | 0.9085 | — | min 0.4606 / mean 0.4606 |

- **Safe Equal Triptych**（candidate-safe-1）：Ordered top-to-bottom triptych with generous margins keeping mobile clock and widget areas clear; equal distribution suits minimal density.
[compiled] hero crop x=0.10 w=0.80; 3 slots
- **Editorial Hero + Split Supports**（candidate-editorial-2）：Asymmetric hero-dominant layout with magazine rhythm; large hero in upper zone, two supports split below with intentional whitespace.
[compiled] hero crop x=0.08 w=0.84; 3 slots
- **Layered Moodboard with Depth**（candidate-dynamic-3）：Layered collage with rotated hero and overlapping supports creating depth; background asset sets mood while foreground layers build visual hierarchy.
[compiled] hero crop x=0.08 w=0.84; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6724 · **total 0.8908**
v5 保留率均分（候选级聚合）：脸保留 — · 主体保留 min 0.5029 / mean 0.5029

渲染：`temp/renders-v5/E3-1-candidate-safe-1.jpg` `temp/renders-v5/E3-2-candidate-editorial-2.jpg` `temp/renders-v5/E3-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-v5/strip-E3.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E4：21:9 ultrawide hero-support（英文 prompt）

- HTTP：201（74613 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe: Left Hero with Clean Right Margin | false | triptych (generated_safe_triptych_21_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.2620 / mean 0.2620 |
| candidate-editorial-2 | Editorial: Asymmetric Left Hero with Intentional Whitespace | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.9352 / mean 0.9352 |
| candidate-dynamic-3 | Dynamic: Layered Collage with Left Hero Dominance | false | layered-collage (generated_dynamic_layered-collage_21_9_3) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.9452 / mean 0.9452 |

- **Safe: Left Hero with Clean Right Margin**（candidate-safe-1）：Uses a conservative triptych recipe with the hero anchored left at 55% share, leaving generous right-side negative space for desktop widgets and keeping the dock zone clear with a 0.06 margin.
[compiled] hero crop x=0.24 w=0.51; 3 slots
- **Editorial: Asymmetric Left Hero with Intentional Whitespace**（candidate-editorial-2）：Refines the editorial triptych template with hero on the left at 58% share, asymmetric rhythm, and stacked supports on the right creating magazine-style negative space for widgets while preserving faces.
[compiled] hero crop x=0.07 w=0.87; 3 slots
- **Dynamic: Layered Collage with Left Hero Dominance**（candidate-dynamic-3）：Uses a layered-collage recipe with strong left hero positioning at 52% share, slight layering depth, and compact right-side supports that leave the far-right quadrant quiet for widget placement.
[compiled] hero crop x=0.00 w=1.00; 3 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**
v5 保留率均分（候选级聚合）：脸保留 — · 主体保留 min 0.7141 / mean 0.7141

渲染：`temp/renders-v5/E4-1-candidate-safe-1.jpg` `temp/renders-v5/E4-2-candidate-editorial-2.jpg` `temp/renders-v5/E4-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-v5/strip-E4.jpg`
渲染说明（忽略/跳过项）：12 条，见 results.json

## 汇总

| 场景 | 耗时 | source | focus | safeArea | color | total | 脸保留(min/mean) | 主体保留(min/mean) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 16:9 desktop single-hero（中文 prompt） | 84117 ms | ai | 0.9855 | 1.0000 | 0.6627 | 0.8827 | — | min 0.1817 / mean 0.2466 |
| E2 16:9 desktop balanced（无 prompt，纯自动） | 61888 ms | ai | 1.0000 | 1.0000 | 0.6754 | 0.8918 | — | min 0.6576 / mean 0.6576 |
| E3 9:16 mobile minimal（移动端 safeAreas） | 160901 ms | ai | 1.0000 | 1.0000 | 0.6724 | 0.8908 | — | min 0.5029 / mean 0.5029 |
| E4 21:9 ultrawide hero-support（英文 prompt） | 74613 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 | — | min 0.7141 / mean 0.7141 |

source=ai 场景数：4/4；全体候选平均 total：0.8868；退出码：0。
