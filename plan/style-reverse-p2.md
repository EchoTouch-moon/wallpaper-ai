# 风格化拼壁纸 P2 端到端验收（2026-10-08）

运行：`node --experimental-strip-types --env-file=.env temp/style-compose-run.mjs`（原始数据：`temp/style-compose-run-data.json`，逐图缓存 `temp/style-compose-cache.json`，成果图 `temp/style-compose-out/`）。

链路：真实照片池 → 逐张本地视觉层（`lib/server/localVision.ts` YuNet 人脸 + ISNet 主体轮廓，合并 `analyzePixels` 基础分析，复刻 `temporaryAssetStore.enrichWithVision` 结构）+ VLM 瘦语义（moonpulse `cn:glm-5v-turbo`，接法复用 P1 `loadStyleReverseModelConfig` + OpenAI 兼容客户端 + ≤1536 dataURL，单图 ≤2 次调用）→ 确定性选题打分 → 风格库（`packages/core/src/layout/styleLibrary.ts`）locked / anchored 编排 → 脸部保留率确定性计算 → `temp/render-layouts.mjs` 画布原生分辨率渲染。

## 1. 照片池摘要

- 池：`/Users/v/Downloads/jjy/` 19 张 .jpg。**淘汰 3 张**（全部因 HEIF 解码失败，如实淘汰）：`2jelpa2hiu75xvho3cqy6k3sh.jpg`、`55vcqp13ic0e8763p0wyh7lgl.jpg`（heif 容器 corrupt header，metadata 即抛错）、`2zjg77s5l3v9jvxrhhsryb7vq.jpg`（metadata 可读 960×1283 但像素解码失败——本机 sharp 无 HEVC 插件；探测必须真解码，仅 metadata 会漏）。
- **可用 16 张**（jjy-01…jjy-16）：14 竖版（约 3:4，2132–4116px 长边）+ 2 横版（4116×3086、1270×960）。全部含人脸（YuNet 每张 ≥1，4 张 ≥2）；VLM 语义 16/16 成功（本轮无降级、无重试耗尽）。
- **可用主体率：11/16 = 68.8%**（subjectAreaRatio ≥ 0.05，ISNet-anime 掩码有效）。无主体的 5 张（jjy-06/08/11/13/15，多为昏暗室内/枫叶前景场景）cutout 不可用，crop 槽位仍可用。
- 限制项：jjy-01（960×1282）、jjy-16（1270×960）分辨率低，3840 宽桌面画布需放大 2–3×，仅用于竖版或小槽位（W3 实测小槽位可用，见 §4 备注）。

## 2. 选题矩阵（确定性打分，全部来自分析数据）

打分：heroFit = 0.32·resolutionScore + 0.24·人脸分(1–3 张=1) + 0.24·主体面积甜区(≈0.38) + 0.14·内容类型 + 0.06·contrast；cutoutFit 需 0.06≤主体面积≤0.6（甜区 0.3）；backgroundFit = 0.5·分辨率 + 0.5·(1−主体面积·1.6)；supportFit 弱化主体要求。

| asset | 文件 | 尺寸/取向 | 主体面积 | 人脸 | res | heroFit | cutoutFit | bgFit | VLM 内容（一句话） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jjy-01 | 3eoi…8xu4w | 960×1282 竖 | 0.520 | 1 | 0.385 | 0.694 | 0.604 | 0.276 | 学院风制服女生坐窗边 |
| jjy-02 | 570d…cwj7 | 3024×4032 竖 | 0.508 | 1 | 1.0 | 0.896 | 0.626 | 0.594 | 阳光下砖墙建筑旁回眸 |
| jjy-03 | 6vr6…7384 | 3000×4518 竖 | 0.263 | 2 | 1.0 | 0.904 | 0.934 | 0.789 | 粉礼服持红掌，仙鹤竹子背景 |
| jjy-04 | 8eky…s2pz | 2132×2843 竖 | 0.225 | 1 | 0.855 | 0.834 | 0.865 | 0.747 | 白吊带浅牛仔站街道 |
| jjy-05 | IMG…3229 | 2903×4166 竖 | 0.138 | 1 | 1.0 | 0.838 | 0.709 | 0.890 | 黄蛋糕裙倚窗，城市夜景 |
| jjy-06 | IMG…3855 | 4116×3086 横 | 0.000 | 1 | 1.0 | 0.770 | 0.050 | 1.000 | 黑发红唇黑礼服特写 |
| jjy-07 | IMG…4105 | 2973×4032 竖 | 0.337 | 1 | 1.0 | **0.957** | 0.933 | 0.730 | 碎花裙户外举叶 |
| jjy-08 | IMG…4201_445 | 3024×4118 竖 | 0.007 | 2 | 1.0 | 0.766 | 0.050 | 0.995 | 暗黑羽毛服饰，迷雾森林 |
| jjy-09 | IMG…4201_569 | 2948×4032 竖 | 0.296 | 1 | 1.0 | 0.919 | **0.993** | 0.763 | 森林吃棒棒糖 |
| jjy-10 | IMG…4337 | 2809×3778 竖 | 0.760 | 1 | 1.0 | 0.766 | 0.050 | 0.500 | 蓝衬衫镜子自拍 |
| jjy-11 | IMG…4534 | 2173×3042 竖 | 0.000 | 1 | 0.893 | 0.733 | 0.050 | 0.946 | 红枫叶掩映少女 |
| jjy-12 | IMG…4829 | 2688×4038 竖 | 0.530 | 1 | 1.0 | 0.900 | 0.586 | 0.576 | 黑礼服皇冠肖像 |
| jjy-13 | IMG…4834_267 | 2715×4032 竖 | 0.000 | 1 | 1.0 | 0.766 | 0.050 | 1.000 | 昏暗室内低头看书 |
| jjy-14 | IMG…4834_544 | 2763×4026 竖 | 0.179 | 2 | 1.0 | 0.858 | 0.782 | 0.857 | 皇冠棋盘，石墙壁灯 |
| jjy-15 | IMG…4932 | 2688×4082 竖 | 0.000 | 1 | 1.0 | 0.768 | 0.050 | 1.000 | 木桌茶具西瓜 |
| jjy-16 | o5eh…fbmd | 1270×960 横 | 0.770 | 1 | 0.383 | 0.562 | 0.050 | 0.192 | 灰帽子室内自拍 |

选题与淘汰结论：
- **cutout 主体**只从"单人脸 + 主体面积 0.06–0.6"里选（jjy-09/jjy-07 顶配；首跑 jjy-03 双人照掩码出残边，目检证实后改单人脸规则）。
- **背景槽**优先主体面积低 + 竖版比例带 0.6–0.95（3:4 画布 contain 留边最小）。
- **桌面 16:10 主槽**只给 minSide≥2000 的素材；jjy-01/jjy-16 限竖版/小槽。
- 淘汰（池级）：3 张 HEIF 不可解码；无其他整池淘汰（无主体照片仅从 cutout 角色淘汰）。

## 3. 壁纸清单（7 张，硬性要求核对）

| # | 成果 | 风格库 id | 模式 | 画布 | 用图 | 脸部保留率（可见/裁切，min） | 目检 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W1 | 对角拼贴·桌面 | xhs-diagonal | **locked** | 16:10 3840×2400 | 6（jjy-07/12/09/14/02/03） | 0.00 / 0.00（avg 0.30） | 6.5/10 |
| W2 | 对角拼贴·锁定 | xhs-diagonal | **locked** | 3:4 1800×2400 | 6（jjy-05/06/13/15/04/10） | 0.00 / 1.00（avg 0.33） | 7/10 |
| W3 | 牛皮纸日志·桌面 | canva-kraft-polaroid | **locked** | 16:10 3840×2400 | 4（jjy-08/01/11/16） | **1.00 / 1.00** | 8/10 |
| W4 | 拼贴手帐·抠图 | canva-portrait-scrapbook（派生 cutout） | **locked** | 3:4 1800×2400 | 4（jjy-13 背景 + jjy-09/07 抠图 + jjy-12） | 0.33 / 1.00（avg 0.81；cutout 人脸 1.00/0.93） | 8.5/10 |
| W5 | 窗口日志·竖屏 | canva-browser-window | **locked** | 9:16 2160×3840 | 5（jjy-09 主图 + 02/03/12/07） | **1.00 / 1.00** | 8/10 |
| W6 | 对角拼贴·锚定 | xhs-diagonal | **anchored** | 3:4 1800×2400 | 6（jjy-07/12/14/03/09/02） | 0.00 / 1.00（avg 0.34） | 7.5/10 |
| W7 | 拼贴手帐·锚定 | canva-portrait-scrapbook | **anchored** | 16:10 3840×2400 | 4（jjy-09 背景 + 07/12/03） | 0.00 / 0.19（avg 0.64） | 8/10 |

硬性要求核对（全部实测）：
- ≥6 张：7 张 ✓；≥4 locked：W1–W5 共 5 张 ✓；≥1 xhs 对角：W1、W2（另 W6 anchored 同风格）✓；≥1 cutout 真正派上用场：W4 hero（jjy-09，人脸掩码覆盖 1.00）+ support-1（jjy-07，0.926），目检双主体悬浮、边缘干净 ✓；≥1 anchored：W6、W7 ✓；画布混合：16:10×3（W1/W3/W7）+ 竖版×4（W2/W4/W6 3:4，W5 9:16）✓。
- locked 路径：W1/W2/W3/W5 走生产入口 `generateCompositionCandidatesAsync(styleMode:"locked")`（候选 0 = 库配方确定性编译，无 LLM）；W4 为**实验层派生**——库内无 cutout 种子，克隆 `canva-portrait-scrapbook` 配方改 slotIntents treatment（hero/support-1=cutout、support-2=crop、background=full）后走同一确定性编译器（`compileTemplateRecipe` + `planTemplateCandidate`），并按 treatment 需求确定性重排槽位-素材绑定（cutout←cutoutFit 单人脸顺位、background←backgroundFit、crop←其余），重排与派生事实全部记录在 generationWarnings。

## 4. 脸部保留率（确定性计算，不用眼看）

口径：逐（槽，人脸）计算 cropRetention = area(人脸框 ∩ item.crop)/area(人脸框)；再映射到画布空间做遮挡修正 occlusionFactor（更高 zIndex 图层矩形扣除；cutout 遮挡层按 contain-fit 绘制区内 subjectBox 估算、full 层按 contain 绘制区，64×64 网格中心采样）；cutout 槽自身乘 ISNet 掩码在人脸框内的覆盖率 maskFactor（掩码与渲染器同源 `extractSubjectAlphaMask`）。壁纸取 min（最差单脸），另有 avg。原始逐行数据在 `temp/style-compose-run-data.json` → wallpapers[].faceRetention.perItem。

- **W3/W5 = 1.00**：hero-grid 无叠压 + 单人脸照片进横长 hero 槽时 face-union 滑窗保脸成功（W5 首跑 jjy-03 双人脸被整体裁出、cropRetention=0，钉单人脸 hero jjy-09 后 1.00——选题规则修正的实证）。
- **W4**：背景照人脸 0.328（被两张悬浮抠图主体盖住 2/3，layered 设计使然）；两个 cutout 主体人脸 1.00 / 0.926。
- **W1/W2/W6/W7 = 0.00（min）**：主因是叠压族设计——对角/layered 的次图槽人脸被更高 z 次图按设计盖住（occ=0），或双人脸照片在横长槽里保一丢一（W1 support-4/jjy-03 cropRetention=0.188、W7 support-2/jjy-03 cropRetention=0.19，同性质）。主槽（hero/hero-2）人脸全部保留（crop=1 且不被遮挡），avg 0.30–0.64。**这是叠压风格与"每张脸都可见"的结构性冲突，如实记录，不算渲染缺陷**；要每脸可见应选 W3/W5 类 gap 族。

## 5. anchored 锚定符合度

- 两张 anchored 的**模型候选（候选 0）family 全部等于锚 family**（diagonal-collage / layered-collage），无真锚发散；`source="ai"`。
- 候选 1/2 是确定性补位（3 候选集要求，`usedFallback=true`），family 为默认配方（hero-grid / balanced-mosaic），与锚不同属设计使然，已按"补位≠发散"区分记录 warning。
- **锚定差距 1（协议缺口）**：模型 recipe 输出 schema（`AI_LAYOUT_PLAN_JSON_SCHEMA`）表达不了 `diagonal.backgroundColor`，两轮 anchored 均 canvas="transparent"（渲染成深灰）。实验层在 family 匹配时按锚配方补 `#5C6B4A` 重渲（修复动作与原始值入 warning；像素采样证实角点 92,107,74 精确命中）。产品结论：模型输出协议应把锚配方的关键参数（底色/treatment）透传给模型或由编译器从锚回填。
- **锚定差距 2**：模型输出 schema 也表达不了 `slotIntents.treatment`——W7 的背景层被模型规划成 cover 裁切而非风格库的 full（渲染为"灰褐色纯底"观感，目检仍 8/10）。同样的协议缺口。
- 锚定插槽结构：W6 6 槽（2 hero + 4 support，符合对角锚）；W7 本轮 4 槽（背景+hero+2 support），锚 slotSummary 建议 supportCount=assets−2=2 ✓。
- 附：LLM 规划模型 `cn:deepseek-v4.1-flash` 单次 30–47s，默认 `LLM_TIMEOUT_MS=30s` 恰好截断成 invalid plan JSON（首轮 anchored 全灭，source=recipe-fallback）；实验层进程内覆写 180s 后恢复。探针：`temp/anchored-provider-probe.mjs`。

## 6. 目检记录（VLM 4.5v 逐张，附确定性交叉验证）

- W1 6.5/10：对角成立、橄榄底正确、主图人脸清晰；右上-左下对角"呼应不均衡"、右下留白（dock 避让）。VLM 称 4/6 张可见（叠压遮蔽与保留率数据一致）。
- W2 7/10：对角成立、无破损人脸；次图叠压重（保留率 occ=0 一致）、右上主图偏大。
- W3 8/10：4 卡网格、人脸全部完整（faceMin=1 交叉一致）。注：jjy-01/jjy-16 低分辨率在 3840 画布小槽放大 ~2×，目检"清晰可辨"，实测可用。
- W4 8.5/10（重建后）：双 cutout 主体悬浮、边缘干净、人脸可辨；背景 jjy-13 基本铺满（窄边 #3b3027 融合）。首跑双人照 jjy-03 掩码残边 6/10 → 改单人脸规则后重建。
- W5 8/10（钉 hero 后）：主图人脸完整居中、时钟区留白干净、圆角卡片无瑕疵。
- W6 7.5/10：橄榄底（像素采样证实 #5C6B4A；VLM 两次描述不一致——一次"深橄榄绿"一次"深灰"，以确定性数据为准）、人脸无完全遮挡；右下留白偏大。
- W7 8/10：层次叠放成立、左侧图标区与底部干净、主图人脸完整；缺手帐装饰元素（协议外，styleNotes 已声明）。
- 目检为辅证：脸部保留率全部来自分析数据确定性计算（§4）。

## 7. 遗留问题

1. **协议缺口（anchored 最大发现）**：模型 recipe 无法输出 `diagonal.backgroundColor` 与 `slotIntents.treatment`，锚定风格的关键视觉参数在 LLM 规划环丢失（§5 差距 1/2）。建议：锚配方参数由编译器回填，或扩展 `AI_LAYOUT_PLAN_JSON_SCHEMA`。
2. **叠压族与全脸可见的结构冲突**：diagonal/layered 按设计叠压，min 脸部保留率必然到 0（W1/W2/W6/W7）；产品上应把"每脸可见"导向 gap 族（W3/W5 实测 1.00）。
3. **双人脸照片在横长槽的保一丢一**：face-union 装不下时按面积加权滑窗，jjy-03 在 W1 support-4 cropRetention=0.188、W7 support-2 cropRetention=0.19、首跑 W5 hero crop=0。选题规则已把横长主槽钉给单人脸照片；更优解是裁切求解器按"每脸最低保留"约束。
4. **cutout 素材规则**：双人照 ISNet 掩码常出残边（jjy-03 实证），已用"单人脸 + 主体面积带"选题规则规避；库内尚无 cutout 种子，W4 的 treatment 是实验层派生，待 P3 入库。
5. **照片池 3/19 HEIF 不可解码**（2 corrupt header + 1 无 HEVC 插件）；解码探测必须真解码像素，仅 metadata 会漏（jjy-16 之外的 2zjg 教训）。
6. **LLM 超时**：planning 默认 30s 截断 cn:deepseek-v4.1-flash 的合法输出（首轮 anchored 全灭降级）；建议默认超时或流式（`LLM_STREAMING=true`）对慢中继更稳。
7. **渲染器能力边界**（rendererNotes 如实记录）：style.shadow/border/filter 未渲染；W7 模型给的 canvas "#99928c" 有效已渲染，无 note；W4 背景 contain 留边靠画布底色融合（#3b3027）——风格库 full 背景 + 深色底可接受，纯亮底会露边。
8. VLM 目检自身不可靠处已交叉验证：w6 底色两次描述矛盾，以像素采样为准；w1"4/6 张可见"与确定性遮挡数据一致，可信。

## 8. 运行期 warnings（如实）

- 3 张 HEIF 解码失败淘汰（见 §1）。
- w6/w7：确定性补位候选 family≠锚（补位默认配方，非模型发散）×4 条。
- w6：anchored 模型 recipe 无法表达底色（canvas="transparent" 会渲染深灰）；实验层按锚配方补 #5C6B4A。
