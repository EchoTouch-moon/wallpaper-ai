// Deterministic composition evaluation harness (multimodal planning protocol v2,
// implementation step 1 — see plan/multimodal-planning-protocol-design.md §2.7).
//
// Runs every eval/briefs/*.json fixture through the synchronous deterministic
// composition generator (`generateCompositionCandidates` — the recipe-fallback
// path, zero model calls) and scores each response with three heuristics, each
// normalized to [0, 1]:
//
//   1. focusFidelity     — does each slot's crop cover the subject the slot
//                          points at (saliencyCenter / subjectBox / faces)?
//   2. safeAreaAdherence — how much do slot rectangles overlap reserved
//                          safe areas (clock strip, dock, icon column)?
//   3. colorHarmony      — average-color distance between spatially adjacent
//                          slots (lower distance → higher score).
//
// The per-fixture score is the equal-weight mean of the three metrics.
//
// CLI (run with `node --experimental-strip-types`):
//
//   scripts/eval-compositions.mjs --out <file>
//       Score all fixtures, write the JSON baseline to <file>, and write a
//       human-readable report next to it (<file> without the .json suffix,
//       with a .md suffix). For `--out eval/reports/baseline.json` the report
//       lands at eval/reports/baseline.md.
//
//   scripts/eval-compositions.mjs --check <file>
//       Re-score everything and compare against the recorded baseline.
//       Exit code 1 if any fixture's (or the aggregate's) metric drops by
//       more than 2% relative to the baseline. Exit code 0 otherwise.
//
// Scoring is intentionally simple and conservative where the brief left room
// for interpretation; each trade-off is documented in the metric functions
// below and summarized in the generated markdown report.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  compositionGenerationRequestSchema,
  generateCompositionCandidates,
} from "@wallpaper/core/layout-generation";
import {
  candidateColorScore,
  candidateFocusScore,
  candidateSafeAreaScore,
  mean,
  round6,
} from "./evalScoring.mjs";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const BRIEFS_DIR = join(REPO_ROOT, "eval", "briefs");

const BASELINE_SCHEMA_ID = "composition-eval-baseline/1";
const METRICS = [
  { key: "focusFidelity", label: "焦点保真度" },
  { key: "safeAreaAdherence", label: "safe-area 遵守" },
  { key: "colorHarmony", label: "色彩和谐" },
  { key: "total", label: "总分（等权平均）" },
];
const RELATIVE_DROP_TOLERANCE = 0.02; // >2% relative drop fails --check

// ---------------------------------------------------------------------------
// Metric functions live in scripts/evalScoring.mjs (imported above) so
// external experiment harnesses reuse the exact scoring implementation;
// this harness's `--check` baseline guards the extraction for behavior drift.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fixture evaluation
// ---------------------------------------------------------------------------

function fixtureCoverageSummary(fixture) {
  const brief = fixture.brief;
  return [
    brief.target.ratioId,
    brief.target.usage,
    brief.intent.hierarchy,
    brief.intent.density,
    brief.intent.rhythm,
  ].join(" · ");
}

function evaluateFixture(file, fixture) {
  const parsed = compositionGenerationRequestSchema.safeParse(fixture);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(
        (issue) =>
          `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`fixture ${file} fails the request schema — ${issues}`);
  }

  let response;
  try {
    response = generateCompositionCandidates(fixture);
  } catch (error) {
    throw new Error(
      `generator failed on fixture ${file}: ${error.message}`,
    );
  }

  const analysisById = new Map(
    parsed.data.assets.map((analysis) => [analysis.assetId, analysis]),
  );

  const perCandidate = response.candidates.map((candidate) => ({
    focusFidelity: candidateFocusScore(candidate, analysisById),
    safeAreaAdherence: candidateSafeAreaScore(candidate),
    colorHarmony: candidateColorScore(candidate, analysisById),
  }));

  // Equal-weight average across the three deterministic candidates, then
  // equal-weight across the three metrics for the fixture total.
  function aggregateMetric(key) {
    return round6(mean(perCandidate.map((scores) => scores[key])));
  }

  const metrics = {
    focusFidelity: aggregateMetric("focusFidelity"),
    safeAreaAdherence: aggregateMetric("safeAreaAdherence"),
    colorHarmony: aggregateMetric("colorHarmony"),
  };
  metrics.total = round6(
    (metrics.focusFidelity +
      metrics.safeAreaAdherence +
      metrics.colorHarmony) /
      3,
  );

  return {
    file,
    coverage: fixtureCoverageSummary(fixture),
    candidateCount: response.candidates.length,
    metrics,
  };
}

function loadFixtureFiles() {
  const files = readdirSync(BRIEFS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no fixture files found under ${BRIEFS_DIR}`);
  }
  return files;
}

function evaluateAllFixtures() {
  const files = loadFixtureFiles();
  return files.map((file) => {
    const fixture = JSON.parse(
      readFileSync(join(BRIEFS_DIR, file), "utf8"),
    );
    return evaluateFixture(file, fixture);
  });
}

function aggregateScores(fixtures) {
  const aggregate = {};
  for (const metric of METRICS) {
    aggregate[metric.key] = round6(
      mean(fixtures.map((fixture) => fixture.metrics[metric.key])),
    );
  }
  return aggregate;
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

function gitCommitShort() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .trim()
      .split("\n")[0];
  } catch {
    return "unknown";
  }
}

// Prefer repo-relative paths in the human-readable report so the command
// examples stay portable across checkouts.
function displayPath(targetPath) {
  const repoRelative = relative(REPO_ROOT, targetPath);
  return repoRelative.startsWith("..") ? targetPath : repoRelative;
}

function renderMarkdown(baseline) {
  const lines = [];
  const outPath = displayPath(baseline.outPath);

  lines.push("# 构图评估基线（composition eval baseline）");
  lines.push("");
  lines.push(
    `- 生成命令：\`node --experimental-strip-types scripts/eval-compositions.mjs --out ${outPath}\``,
  );
  lines.push(
    `- 被测引擎：\`generateCompositionCandidates\`（确定性 recipe-fallback，零模型调用）`,
  );
  lines.push(`- node 版本：\`${baseline.node}\`；源码 commit：\`${baseline.gitCommit}\``);
  lines.push(
    "- 本报告与 JSON 基线均不含时间戳——同一 commit 下可逐字节复现。",
  );
  lines.push("");
  lines.push("## 指标定义（均归一化到 0-1，越高越好）");
  lines.push("");
  lines.push("1. **焦点保真度（focusFidelity）**：每个槽位的 `crop` 框是否覆盖所指素材的参照焦点。参照焦点优先级与编译器 `calculateCoverCrop` 一致：人脸均值中心 > `subjectBox` 中心 > `saliencyCenter` > 图片中心。焦点在框内记 1 分；框外按轴归一化欧氏距离线性衰减到 0。主槽位（`role === \"hero\"`）占 0.5 权重，其余槽位合计占 0.5。");
  lines.push("2. **safe-area 遵守（safeAreaAdherence）**：布局安全区被槽位（轴对齐包围盒，忽略 ±1.4° 旋转）占用的面积比例（不去重、不按 opacity/zIndex 折算），每个安全区求占用率后取均值，1 − 均占用率即得分；无安全区时直接记 1。");
  lines.push("3. **色彩和谐（colorHarmony）**：空间上相邻（包围盒有正面积交集，叠压布局成立、clean-gap 布局不成立）槽位对的 `averageColor` HSL 距离（复用 `@wallpaper/core/image` 的 `colorDistance`，距离越小越和谐），1 − 平均距离；无相邻对时保守回退为全对平均。");
  lines.push("");
  lines.push("每项 fixture 分数先在 3 个确定性候选间取等权平均，总分（`total`）为三项指标等权平均。");
  lines.push("");
  lines.push("## 汇总（aggregate，全部 fixture 等权平均）");
  lines.push("");
  lines.push("| 指标 | 基线值 |");
  lines.push("| --- | --- |");
  for (const metric of METRICS) {
    lines.push(`| ${metric.label}（\`${metric.key}\`） | ${baseline.aggregate[metric.key].toFixed(4)} |`);
  }
  lines.push("");
  lines.push("## 逐 fixture 分数");
  lines.push("");
  lines.push("| Fixture | 覆盖面 | focusFidelity | safeAreaAdherence | colorHarmony | total |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const fixture of baseline.fixtures) {
    lines.push(
      `| \`${fixture.file}\` | ${fixture.coverage} | ${fixture.metrics.focusFidelity.toFixed(4)} | ${fixture.metrics.safeAreaAdherence.toFixed(4)} | ${fixture.metrics.colorHarmony.toFixed(4)} | ${fixture.metrics.total.toFixed(4)} |`,
    );
  }
  lines.push("");
  lines.push("## 复跑与回归对比");
  lines.push("");
  lines.push("```bash");
  lines.push(
    `node --experimental-strip-types scripts/eval-compositions.mjs --check ${outPath}`,
  );
  lines.push("```");
  lines.push("");
  lines.push(
    `任一 fixture 或汇总的任一指标相对下降超过 ${(RELATIVE_DROP_TOLERANCE * 100).toFixed(0)}% 时退出码为 1。`,
  );
  lines.push("");
  return lines.join("\n");
}

// The baseline body deliberately carries no timestamp, so the file is
// byte-reproducible for a given commit. (Markdown report metadata lives in
// the report path + commit fingerprint instead.)
function buildBaselineBody(fixtures) {
  return {
    schema: BASELINE_SCHEMA_ID,
    generator: relative(REPO_ROOT, fileURLToPath(import.meta.url)) ||
      "scripts/eval-compositions.mjs",
    node: process.version,
    gitCommit: gitCommitShort(),
    fixtureCount: fixtures.length,
    fixtures: fixtures.map((fixture) => ({
      file: fixture.file,
      coverage: fixture.coverage,
      metrics: fixture.metrics,
    })),
    aggregate: aggregateScores(fixtures),
  };
}

function printScoreTable(fixtures, aggregate) {
  const width = Math.max(
    ...fixtures.map((fixture) => fixture.file.length),
    "aggregate".length,
  );
  const header =
    "Fixture".padEnd(width) +
    "focusFidelity  safeAreaAdherence  colorHarmony  total";
  const rule = "-".repeat(header.length);
  console.log(rule);
  console.log(header);
  console.log(rule);
  const rows = [
    ...fixtures.map((fixture) => ({
      label: fixture.file,
      metrics: fixture.metrics,
    })),
    { label: "aggregate", metrics: aggregate },
  ];
  for (const row of rows) {
    console.log(
      row.label.padEnd(width) +
        row.metrics.focusFidelity.toFixed(4).padStart(14) +
        row.metrics.safeAreaAdherence.toFixed(4).padStart(19) +
        row.metrics.colorHarmony.toFixed(4).padStart(14) +
        row.metrics.total.toFixed(4).padStart(9),
    );
  }
  console.log(rule);
}

// ---------------------------------------------------------------------------
// --out mode
// ---------------------------------------------------------------------------

function reportPathFor(outPath) {
  // eval/reports/baseline.json -> eval/reports/baseline.md
  if (outPath.endsWith(".json")) {
    return `${outPath.slice(0, -".json".length)}.md`;
  }
  return `${outPath}.md`;
}

function runOutMode(outPath) {
  const fixtures = evaluateAllFixtures();
  const aggregate = aggregateScores(fixtures);

  const baselineBody = buildBaselineBody(fixtures);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(baselineBody, null, 2)}\n`);

  const markdown = renderMarkdown({ ...baselineBody, outPath });
  const reportPath = reportPathFor(outPath);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, markdown);

  printScoreTable(fixtures, aggregate);
  console.log(`已写入基线 JSON：${outPath}`);
  console.log(`已写入人读报告：${reportPath}`);
}

// ---------------------------------------------------------------------------
// --check mode
// ---------------------------------------------------------------------------

function relativeDrop(baselineValue, currentValue) {
  if (baselineValue <= 0) {
    // A non-positive baseline cannot regress relatively (scores are >= 0);
    // report no drop rather than dividing by zero.
    return 0;
  }
  return (baselineValue - currentValue) / baselineValue;
}

function runCheckMode(checkPath) {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(checkPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read baseline ${checkPath}: ${error.message}`);
  }
  if (baseline.schema !== BASELINE_SCHEMA_ID) {
    throw new Error(
      `baseline ${checkPath} has schema ${JSON.stringify(baseline.schema)}, expected ${BASELINE_SCHEMA_ID} — regenerate with --out`,
    );
  }
  if (!Array.isArray(baseline.fixtures) || typeof baseline.aggregate !== "object") {
    throw new Error(
      `baseline ${checkPath} is missing fixtures/aggregate — regenerate with --out`,
    );
  }

  const current = evaluateAllFixtures();
  const currentAggregate = aggregateScores(current);
  const currentByFile = new Map(current.map((fixture) => [fixture.file, fixture]));

  const baselineFiles = baseline.fixtures.map((fixture) => fixture.file);
  const currentFiles = current.map((fixture) => fixture.file);
  const added = baselineFiles.filter((file) => !currentByFile.has(file));
  const removed = currentFiles.filter((file) => !baselineFiles.includes(file));
  if (added.length > 0 || removed.length > 0) {
    if (added.length > 0) {
      process.stderr.write(`基线缺少当前新增的 fixture：${added.join(", ")}\n`);
    }
    if (removed.length > 0) {
      process.stderr.write(`当前评估集缺少基线中的 fixture：${removed.join(", ")}\n`);
    }
    process.stderr.write(
      "评估集与基线不一致，无法对比——请先用 --out 重新生成基线。\n",
    );
    process.exitCode = 1;
    return;
  }

  const violations = [];
  const rows = [];
  for (const baselineFixture of baseline.fixtures) {
    const currentFixture = currentByFile.get(baselineFixture.file);
    for (const metric of METRICS) {
      const baselineValue = baselineFixture.metrics[metric.key];
      const currentValue = currentFixture.metrics[metric.key];
      const drop = relativeDrop(baselineValue, currentValue);
      const failed = drop > RELATIVE_DROP_TOLERANCE;
      if (failed) {
        violations.push(
          `${baselineFixture.file} ${metric.key}: 基线 ${baselineValue.toFixed(4)} → 当前 ${currentValue.toFixed(4)}（相对下降 ${(drop * 100).toFixed(2)}%）`,
        );
      }
      rows.push({
        file: baselineFixture.file,
        metric: metric.key,
        baselineValue,
        currentValue,
        drop,
        failed,
      });
    }
  }
  for (const metric of METRICS) {
    const baselineValue = baseline.aggregate[metric.key];
    const currentValue = currentAggregate[metric.key];
    const drop = relativeDrop(baselineValue, currentValue);
    const failed = drop > RELATIVE_DROP_TOLERANCE;
    if (failed) {
      violations.push(
        `aggregate ${metric.key}: 基线 ${baselineValue.toFixed(4)} → 当前 ${currentValue.toFixed(4)}（相对下降 ${(drop * 100).toFixed(2)}%）`,
      );
    }
    rows.push({
      file: "aggregate",
      metric: metric.key,
      baselineValue,
      currentValue,
      drop,
      failed,
    });
  }

  console.log("逐 fixture / 汇总指标对比（相对下降容差 2%）：");
  console.log("");
  const width = Math.max(...rows.map((row) => row.file.length));
  console.log(
    "Fixture".padEnd(width) +
      "指标".padEnd(22) +
      "基线".padStart(10) +
      "当前".padStart(10) +
      "Δ%".padStart(10) +
      "  结果",
  );
  for (const row of rows) {
    console.log(
      row.file.padEnd(width) +
        row.metric.padEnd(22) +
        row.baselineValue.toFixed(4).padStart(10) +
        row.currentValue.toFixed(4).padStart(10) +
        `${(row.drop * 100).toFixed(2)}%`.padStart(10) +
        (row.failed ? "  ✗ 回归" : "  OK"),
    );
  }
  console.log("");

  if (violations.length > 0) {
    console.log("检测到回归（超过 2% 相对下降）：");
    for (const violation of violations) {
      console.log(`  - ${violation}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("未检测到回归（对比基线：eval 内所有指标相对下降均 ≤ 2%）。");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`用法：
  node --experimental-strip-types scripts/eval-compositions.mjs --out <baseline.json>
      评估 eval/briefs/ 下全部 fixture，写出 JSON 基线与人读 markdown 报告。
  node --experimental-strip-types scripts/eval-compositions.mjs --check <baseline.json>
      重新评估并与基线对比；任一指标相对下降超过 2% 时退出码 1。`);
}

function main() {
  let args;
  try {
    args = parseArgs({
      options: {
        out: { type: "string" },
        check: { type: "string" },
      },
      strict: true,
    });
  } catch (error) {
    process.stderr.write(`参数解析失败：${error.message}\n\n`);
    printUsage();
    process.exitCode = 2;
    return;
  }

  const { out, check } = args.values;
  if (out && check) {
    process.stderr.write("--out 与 --check 互斥，请只传其一。\n\n");
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (!out && !check) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  try {
    if (out) {
      runOutMode(resolve(out));
    } else {
      runCheckMode(resolve(check));
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
