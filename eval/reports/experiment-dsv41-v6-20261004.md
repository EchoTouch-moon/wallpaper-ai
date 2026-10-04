# DSV4.1 全链路产品实验报告（v6：本地视觉层上线，脸/主体保留率，渲染原生分辨率）

- 时间：2026-10-04T08:13:04.337Z（总耗时 665367 ms）
- dev server：`pnpm dev --port 3111`（pid 64440，日志 `/Users/v/Documents/wallpaper-ai/temp/experiment-server.log`）
- env 覆盖：`VISION_ENABLED=true VISION_PLANNING_ENABLED=true VISION_MODEL=cn:glm-5v-turbo VISION_TIMEOUT_MS=180000 LLM_STREAMING=true LLM_TIMEOUT_MS=110000 ONE_TOUCH_STORAGE_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-assets ONE_TOUCH_COMPOSITION_DIR=/Users/v/Documents/wallpaper-ai/temp/experiment-compositions`（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 由仓库 .env 自动加载）
- visionPlanningGateRequested：`true`（false 时该轮以退出码 4 中止）
- 图片目录：`/Users/v/Downloads/wallpaper`（3 张 jpg）
- 评分实现：`scripts/evalScoring.mjs`（与 `scripts/eval-compositions.mjs` 共用，提取行为由其 `--check` 基线守护）

## 素材上传（POST /api/assets）

| 图片 | 尺寸 | analysisSource | contentType | 主色(average) | styleTags | bestUse | cropSafety | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 007gmkkdly1i36m19jlxhj32f51m1nln.jpg | 3137×2089 | vision | portrait | #412f31 | automotive, fashion, moody, low-angle, vibrant-red, night-photography, urban-lifestyle | hero | medium | 6298 ms |
| aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg | 7680×4320 | vision | unknown | #afaccd | fantasy, digital art, pastel, ethereal, dynamic, whimsical, gaming, bright | hero, background | low | 6170 ms |
| wallhaven-p9vyge.jpg | 7680×4320 | vision | unknown | #434c6f | digital art, fantasy, ethereal, blue tones, dynamic, magical, gaming, high contrast | hero, background | medium | 10076 ms |

视觉补丁字段（subjectBox / saliencyCenter）明细：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：subjectBox={"x":0.0849609375,"y":0.0625,"width":0.7841796875,"height":0.9375}；saliencyCenter={"x":0.45278940821248015,"y":0.5898915605412567}；analysisWarnings=["Local face detection returned 1 face(s) in 313ms.","Local subject segmentation returned a subject contour in 1765ms."]
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：subjectBox={"x":0.2138671875,"y":0.072265625,"width":0.7158203125,"height":0.783203125}；saliencyCenter={"x":0.512239526314378,"y":0.3986007445037707}；analysisWarnings=["Local face detection found no faces in 441ms.","Local subject segmentation returned a subject contour in 2162ms."]
- **wallhaven-p9vyge.jpg**：subjectBox={"x":0.42578125,"y":0.0576171875,"width":0.38671875,"height":0.861328125}；saliencyCenter={"x":0.5514676617144005,"y":0.36946949216605895}；analysisWarnings=["Local face detection returned 1 face(s) in 331ms.","Local subject segmentation returned a subject contour in 1767ms."]

v5 检出观察（faces / subjectContour，保留率输入）：

- **007gmkkdly1i36m19jlxhj32f51m1nln.jpg**：faces=1 [{"x":0.4390357812286211,"y":0.14143624277389852,"width":0.09161475796683771,"height":0.15801656851330462}]; subjectContour=polygon(43 pts), areaRatio 0.287
- **aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg**：faces=0; subjectContour=polygon(34 pts), areaRatio 0.162
- **wallhaven-p9vyge.jpg**：faces=1 [{"x":0.5071536792754779,"y":0.2210656496732961,"width":0.058495314729283265,"height":0.12660613864338446}]; subjectContour=polygon(30 pts), areaRatio 0.061

v6 分层观测（本地 ONNX 几何层 / VLM 语义层）：

| 图片 | 本地覆盖 | faces 数 | face 层耗时 | contour 占比 | polygon 点数 | contour 层耗时 | VLM 语义 | VLM 耗时(approx) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 007gmkkdly1i36m19jlxhj32f51m1nln.jpg | true | 1 | 313 ms | 0.287107 | 43 | 1765 ms | true（portrait, tags 7） | 4533 ms |
| aurora-summer-party-skin-lol-wild-rift-splash-art-8k-wallpaper-uhdpaper.com-732@5@g.jpg | true | 0 | 441 ms | 0.162247 | 34 | 2162 ms | true（unknown, tags 8） | 4008 ms |
| wallhaven-p9vyge.jpg | true | 1 | 331 ms | 0.060811 | 30 | 1767 ms | true（unknown, tags 8） | 8309 ms |

- 本地层覆盖：`3/3`（exit 3 门：必须 3/3）；VLM 语义层覆盖：`3/3`（仅报告，不作失败条件）。

## E1：16:9 desktop single-hero（中文 prompt）

- HTTP：201（160533 ms）
- source：`ai`
- warnings：

  - Vision planning returned invalid plan JSON; one identical retry recovered the multimodal plan.

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe: Minimal Triptych with Icon Space | false | triptych_desktop_equal (triptych_desktop_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 1.0000 / mean 1.0000 |
| candidate-editorial-2 | Editorial: Asymmetric Hero with Right Supports | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9977 / mean 0.9992 |
| candidate-dynamic-3 | Dynamic: Layered Moodboard with Depth | false | layered_moodboard_desktop (layered_moodboard_desktop) | 0.7600 | 1.0000 | 1.0000 | 0.7344 | 0.9115 | min 1.0000 / mean 1.0000 | min 0.9793 / mean 0.9926 |

- **Safe: Minimal Triptych with Icon Space**（candidate-safe-1）：Ordered triptych layout with generous left margin for desktop icons and clear dock zone. Hero (woman with car) centered with balanced supports on either side, maintaining quiet minimal aesthetic.
[compiled] hero crop x=0.09 w=0.78; 3 slots
- **Editorial: Asymmetric Hero with Right Supports**（candidate-editorial-2）：Magazine-style layout with hero occupying left 62% for strong presence, two supports stacked on right creating editorial rhythm. Left margin preserves icon area; hero share capped at 0.60 keeps dock clear.
[compiled] hero crop x=0.09 w=0.78; 3 slots
- **Dynamic: Layered Moodboard with Depth**（candidate-dynamic-3）：Layered collage with background fill, rotated hero at 54% share, and two overlapping supports. Slight layering creates depth while margin of 0.08 keeps icon/dock zones clear. Blue-toned fantasy assets frame the warm hero.
[compiled] hero crop x=0.09 w=0.77; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6754 · **total 0.8918**
v5 保留率均分（候选级聚合）：脸保留 min 1.0000 / mean 1.0000 · 主体保留 min 0.9923 / mean 0.9973

渲染：`temp/renders-v6/E1-1-candidate-safe-1.jpg` `temp/renders-v6/E1-2-candidate-editorial-2.jpg` `temp/renders-v6/E1-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-v6/strip-E1.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E2：16:9 desktop balanced（无 prompt，纯自动）

- HTTP：201（209400 ms）
- source：`ai`
- warnings：

  - Vision planning retry failed; falling back to text-only planning. (Layout model returned invalid plan JSON)

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Ordered Hero Grid | false | hero-grid (generated_safe_hero-grid_16_9_3) | 0.7800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9753 / mean 0.9916 |
| candidate-editorial-1 | Editorial Asymmetric Mosaic | false | balanced-mosaic (generated_editorial_balanced-mosaic_16_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9753 / mean 0.9916 |
| candidate-dynamic-1 | Dynamic Layered Collage | false | layered-collage (generated_dynamic_layered-collage_16_9_3) | 0.8600 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9753 / mean 0.9918 |

- **Safe Ordered Hero Grid**（candidate-safe-1）：Balanced left-to-right hero grid with generous margins and safe-area avoidance; keeps faces intact and dock strip clear.
[compiled] hero crop x=0.10 w=0.80; 3 slots
- **Editorial Asymmetric Mosaic**（candidate-editorial-1）：Asymmetric hero-led mosaic with magazine whitespace, left-to-right flow, and conservative face-preserving crops.
[compiled] hero crop x=0.10 w=0.80; 3 slots
- **Dynamic Layered Collage**（candidate-dynamic-1）：Layered collage with strong depth, controlled overlap, and left-to-right hero dominance while respecting desktop safe areas.
[compiled] hero crop x=0.10 w=0.80; 3 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**
v5 保留率均分（候选级聚合）：脸保留 min 1.0000 / mean 1.0000 · 主体保留 min 0.9753 / mean 0.9917

渲染：`temp/renders-v6/E2-1-candidate-safe-1.jpg` `temp/renders-v6/E2-2-candidate-editorial-1.jpg` `temp/renders-v6/E2-3-candidate-dynamic-1.jpg`；拼条 `temp/renders-v6/strip-E2.jpg`
渲染说明（忽略/跳过项）：12 条，见 results.json

## E3：9:16 mobile minimal（移动端 safeAreas）

- HTTP：201（88063 ms）
- source：`ai`
- warnings：（无）

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-safe-1 | Safe Equal Triptych | false | triptych_mobile_equal (triptych_mobile_equal) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 1.0000 / mean 1.0000 |
| candidate-editorial-2 | Editorial Hero + Split Supports | false | triptych_mobile_editorial (triptych_mobile_editorial) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 1.0000 / mean 1.0000 |
| candidate-dynamic-3 | Layered Moodboard with Depth | false | layered_moodboard_mobile (layered_moodboard_mobile) | 0.7900 | 1.0000 | 1.0000 | 0.7254 | 0.9085 | min 1.0000 / mean 1.0000 | min 0.9931 / mean 0.9980 |

- **Safe Equal Triptych**（candidate-safe-1）：Ordered equal triptych with generous margins keeps mobile clock and widget areas clear; portrait asset (9b78) anchors the middle hero slot with face-preserved subject focus.
[compiled] hero crop x=0.09 w=0.78; 3 slots
- **Editorial Hero + Split Supports**（candidate-editorial-2）：Asymmetric editorial layout with dominant upper hero (blue fantasy character) and two balanced supports below; rounded corners and whitespace create magazine rhythm while respecting safe areas.
[compiled] hero crop x=0.35 w=0.50; 3 slots
- **Layered Moodboard with Depth**（candidate-dynamic-3）：Dynamic layered collage using pastel fantasy art as background, portrait photo as rotated hero with slight overlap, and blue fantasy character as angled support; creates visual depth while keeping widget zone quiet.
[compiled] hero crop x=0.09 w=0.78; 4 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6724 · **total 0.8908**
v5 保留率均分（候选级聚合）：脸保留 min 1.0000 / mean 1.0000 · 主体保留 min 0.9977 / mean 0.9993

渲染：`temp/renders-v6/E3-1-candidate-safe-1.jpg` `temp/renders-v6/E3-2-candidate-editorial-2.jpg` `temp/renders-v6/E3-3-candidate-dynamic-3.jpg`；拼条 `temp/renders-v6/strip-E3.jpg`
渲染说明（忽略/跳过项）：17 条，见 results.json

## E4：21:9 ultrawide hero-support（英文 prompt）

- HTTP：201（164058 ms）
- source：`ai`
- warnings：

  - Vision planning returned invalid plan JSON; one identical retry recovered the multimodal plan.

| 候选 | label | usedFallback | 模板/配方族 | harmonyScore | focus | safeArea | color | total | 脸保留 | 主体保留 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate-1 | Safe Left-Heavy Triptych | false | triptych (generated_safe_triptych_21_9_3) | 0.8200 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9481 / mean 0.9748 |
| candidate-2 | Editorial Asymmetric Hero-Left | false | triptych_desktop_editorial (triptych_desktop_editorial) | 0.8800 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9794 / mean 0.9928 |
| candidate-3 | Dynamic Layered Collage Left | false | layered-collage (generated_dynamic_layered-collage_21_9_3) | 0.7900 | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9766 / mean 0.9858 |

- **Safe Left-Heavy Triptych**（candidate-1）：Conservative left-hero layout with generous right margin for desktop widgets and dock clearance. Hero share capped at 0.58 to keep the dock zone visible.
[compiled] hero crop x=0.09 w=0.78; 3 slots
- **Editorial Asymmetric Hero-Left**（candidate-2）：Magazine-style layout with strong left hero (0.62 share) and stacked supports on the right, creating intentional negative space for widgets while maintaining editorial rhythm.
[compiled] hero crop x=0.09 w=0.78; 3 slots
- **Dynamic Layered Collage Left**（candidate-3）：Layered composition with rotated hero on the left and overlapping supports, creating depth while preserving right-side quiet zone for desktop widgets.
[compiled] hero crop x=0.06 w=0.82; 3 slots

场景均分：focus 1.0000 · safeArea 1.0000 · color 0.6459 · **total 0.8820**
v5 保留率均分（候选级聚合）：脸保留 min 1.0000 / mean 1.0000 · 主体保留 min 0.9680 / mean 0.9845

渲染：`temp/renders-v6/E4-1-candidate-1.jpg` `temp/renders-v6/E4-2-candidate-2.jpg` `temp/renders-v6/E4-3-candidate-3.jpg`；拼条 `temp/renders-v6/strip-E4.jpg`
渲染说明（忽略/跳过项）：12 条，见 results.json

## 汇总

| 场景 | 耗时 | source | focus | safeArea | color | total | 脸保留(min/mean) | 主体保留(min/mean) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 16:9 desktop single-hero（中文 prompt） | 160533 ms | ai | 1.0000 | 1.0000 | 0.6754 | 0.8918 | min 1.0000 / mean 1.0000 | min 0.9923 / mean 0.9973 |
| E2 16:9 desktop balanced（无 prompt，纯自动） | 209400 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9753 / mean 0.9917 |
| E3 9:16 mobile minimal（移动端 safeAreas） | 88063 ms | ai | 1.0000 | 1.0000 | 0.6724 | 0.8908 | min 1.0000 / mean 1.0000 | min 0.9977 / mean 0.9993 |
| E4 21:9 ultrawide hero-support（英文 prompt） | 164058 ms | ai | 1.0000 | 1.0000 | 0.6459 | 0.8820 | min 1.0000 / mean 1.0000 | min 0.9680 / mean 0.9845 |

source=ai 场景数：4/4；全体候选平均 total：0.8866；本地层覆盖：3/3（exit 3 门）；VLM 语义覆盖：3/3（仅报告）；退出码：0。
