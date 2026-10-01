# 构图评估基线（composition eval baseline）

- 生成命令：`node --experimental-strip-types scripts/eval-compositions.mjs --out eval/reports/baseline.json`
- 被测引擎：`generateCompositionCandidates`（确定性 recipe-fallback，零模型调用）
- node 版本：`v22.23.2`；源码 commit：`9bfc33a`
- 本报告与 JSON 基线均不含时间戳——同一 commit 下可逐字节复现。

## 指标定义（均归一化到 0-1，越高越好）

1. **焦点保真度（focusFidelity）**：每个槽位的 `crop` 框是否覆盖所指素材的参照焦点。参照焦点优先级与编译器 `calculateCoverCrop` 一致：人脸均值中心 > `subjectBox` 中心 > `saliencyCenter` > 图片中心。焦点在框内记 1 分；框外按轴归一化欧氏距离线性衰减到 0。主槽位（`role === "hero"`）占 0.5 权重，其余槽位合计占 0.5。
2. **safe-area 遵守（safeAreaAdherence）**：布局安全区被槽位（轴对齐包围盒，忽略 ±1.4° 旋转）占用的面积比例（不去重、不按 opacity/zIndex 折算），每个安全区求占用率后取均值，1 − 均占用率即得分；无安全区时直接记 1。
3. **色彩和谐（colorHarmony）**：空间上相邻（包围盒有正面积交集，叠压布局成立、clean-gap 布局不成立）槽位对的 `averageColor` HSL 距离（复用 `@wallpaper/core/image` 的 `colorDistance`，距离越小越和谐），1 − 平均距离；无相邻对时保守回退为全对平均。

每项 fixture 分数先在 3 个确定性候选间取等权平均，总分（`total`）为三项指标等权平均。

## 汇总（aggregate，全部 fixture 等权平均）

| 指标 | 基线值 |
| --- | --- |
| 焦点保真度（`focusFidelity`） | 1.0000 |
| safe-area 遵守（`safeAreaAdherence`） | 0.1992 |
| 色彩和谐（`colorHarmony`） | 0.7670 |
| 总分（等权平均）（`total`） | 0.6554 |

## 逐 fixture 分数

| Fixture | 覆盖面 | focusFidelity | safeAreaAdherence | colorHarmony | total |
| --- | --- | --- | --- | --- | --- |
| `01-desktop-16x9-single-hero.json` | 16:9 · desktop · single-hero · balanced · ordered | 1.0000 | 0.1788 | 0.9582 | 0.7123 |
| `02-desktop-16x9-hero-support.json` | 16:9 · desktop · hero-support · balanced · asymmetric | 1.0000 | 0.1830 | 0.6358 | 0.6063 |
| `03-desktop-16x9-balanced-collage.json` | 16:9 · desktop · balanced · balanced · ordered | 1.0000 | 0.2444 | 0.8670 | 0.7038 |
| `04-mobile-9x16-widgets.json` | 9:16 · mobile · hero-support · balanced · ordered | 1.0000 | 0.0084 | 0.6384 | 0.5489 |
| `05-ultrawide-21x9-desktop.json` | 21:9 · ultrawide · balanced · balanced · ordered | 1.0000 | 0.1823 | 0.7115 | 0.6313 |
| `06-custom-2048x1280-laptop.json` | custom · laptop · hero-support · minimal · ordered | 1.0000 | 0.4707 | 0.9611 | 0.8106 |
| `07-lock-screen-9x19x5-clock.json` | 9:19.5 · lock-screen · hero-support · balanced · ordered | 1.0000 | 0.0083 | 0.5742 | 0.5275 |
| `08-desktop-16x9-dense.json` | 16:9 · desktop · balanced · dense · asymmetric | 1.0000 | 0.1748 | 0.7006 | 0.6251 |
| `09-desktop-16x9-minimal.json` | 16:9 · desktop · single-hero · minimal · ordered | 1.0000 | 0.3480 | 0.9762 | 0.7747 |
| `10-desktop-16x9-layered-cn.json` | 16:9 · desktop · hero-support · dense · layered | 1.0000 | 0.1930 | 0.6476 | 0.6135 |

## 复跑与回归对比

```bash
node --experimental-strip-types scripts/eval-compositions.mjs --check eval/reports/baseline.json
```

任一 fixture 或汇总的任一指标相对下降超过 2% 时退出码为 1。
