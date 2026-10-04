# 本地视觉模型选型记录（local vision selection）

两轮真图实测裁决（三张素材：007gmkkdly 真人倚跑车 3137×2089、aurora 王者荣耀
splash art 7680×4320、wallhaven 奇幻角色立绘 7680×4320；指标为 mask 外接框
对参考主体框的 IoU 与 mask 面积占比）。

## 第一轮：基础家族对比（2026-10-04，工作流 G spike）

- **脸检测选定 YuNet**（opencv_zoo face_detection_yunet 2023mar，0.22MB，
  Apache-2.0）：有人图唯一过硬门槛方案（score 0.898，框住人脸；BlazeFace@0.5
  三图全漏检），且意外检出 wallhaven 动漫脸（0.887）；推理仅 5-9ms。
- 轮廓初选 isnet-general-use（170MB）：唯一过三图非退化门槛
  （IoU 0.737/0.662/0.438），U2Netp 在动漫图近乎失效（0.117/0.001）。
- 覆盖图：temp/spike/face-overlay.jpg、contour-u2netp.jpg、contour-isnet.jpg。

## 第二轮：特化模型对比（2026-10-04，同轮四模型实测）

用户提出寻找特化模型后补测。候选：`isnet-anime`（SkyTNT/anime-segmentation，
Apache-2.0，动漫角色专用训练，rembg release 直链 176,069,933B）与
`u2net_human_seg`（真人专用）。同轮四模型、同管线同口径：

| 模型 | img1 真人 IoU/占比 | img2 aurora IoU/占比 | img3 wallhaven IoU/占比 |
| --- | --- | --- | --- |
| **isnet-anime** | **0.997 / 0.232** | **0.855 / 0.366** | **0.849 / 0.203** |
| u2net_human_seg | 0.966 / 0.191 | 0.556 / 0.118 | 0.826 / 0.162 |
| isnet-general-use（原选型） | 0.737 / 0.287 | 0.662 / 0.162 | 0.438 / 0.061 |
| u2netp | 0.737 / 0.299 | 0.117 / 0.029 | 0.001 / 0.000 |

**裁决：轮廓模型换为 isnet-anime（三图全胜，无需按图类型路由）。**
关键发现：原 isnet-general-use 对 wallhaven 占比仅 0.061（漏掉大半主体），
isnet-anime 0.203 才接近真值；真人照也以 0.997 大幅反超（0.737）。
耗时 1.3-1.8s/张与原模型持平（同为 1024 输入 ISNet 家族）。
产品路径三图冒烟（lib/server/localVision.ts）：box 与参考框逐位吻合，
polygon 27-46 点。动覆盖图：temp/spike/contour-isnet-anime.jpg。
动漫脸检测特化（hysts/anime-face-detector，需手动 ONNX 导出）暂缓：
YuNet 已覆盖 1/2 动漫脸，其余由轮廓兜底。
