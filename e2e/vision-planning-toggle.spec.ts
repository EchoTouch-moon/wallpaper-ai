import { expect, test } from "@playwright/test";
import sharp from "sharp";

/**
 * Vision planning gate acceptance (plan/multimodal-planning-protocol-design.md
 * §2.4, implementation step 5). playwright.config.ts boots the dev server with
 * VISION_PLANNING_ENABLED=true and every model credential stripped, so this
 * spec exercises the full three-tier degradation chain end to end without any
 * network access:
 *
 *   multimodal planning (gate on, but no usable key/model)
 *     → text-only planning (no LLM_API_KEY)
 *       → deterministic fallback recipes
 *
 * The degradation must stay observable through the deterministic warnings in
 * the API responses while the upload → TOUCH → three candidates → refine flow
 * still completes.
 */

const VISION_GATE_UNCONFIGURED_WARNING =
  "Vision planning is enabled but no usable model configuration was found; using text-only planning.";
const TEXT_ONLY_PLANNER_UNAVAILABLE_PATTERN =
  /AI planner unavailable: LLM_API_KEY is not configured/;
const TEXT_ONLY_REFINER_UNAVAILABLE_PATTERN =
  /AI refinement unavailable: LLM_API_KEY is not configured/;

async function imageFixture(
  name: string,
  color: { r: number; g: number; b: number },
) {
  const buffer = await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 4,
      background: { ...color, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return { name, mimeType: "image/png", buffer };
}

async function enterStudio(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const gateway = page.getByRole("button", { name: "一触开启网站" });
  await expect(gateway).toBeVisible();
  await expect(gateway).toBeEnabled();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await gateway.click();
    const revealed = await page
      .getByRole("heading", {
        name: "Describe the feeling. We compose the space.",
      })
      .waitFor({ state: "visible", timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (revealed || !(await gateway.isVisible().catch(() => false))) {
      break;
    }
  }
  await expect(
    page.getByRole("heading", {
      name: "Describe the feeling. We compose the space.",
    }),
  ).toBeVisible();
}

test("composes and refines with the vision gate on, no key, and observable degradation warnings", async ({
  page,
}) => {
  await enterStudio(page);
  const first = await imageFixture("vision-blue.png", {
    r: 58,
    g: 96,
    b: 210,
  });
  const second = await imageFixture("vision-warm.png", {
    r: 205,
    g: 92,
    b: 126,
  });
  await page.locator('input[type="file"]').setInputFiles([first, second]);

  await expect(page.getByText("2 / 6 assets")).toBeVisible();
  const heroButtons = page.getByRole("button", { name: "Set hero" });
  await expect(heroButtons).toHaveCount(2);
  await heroButtons.nth(1).click();

  await page
    .getByPlaceholder(/Keep the person intact/)
    .fill("Leave quiet space for desktop icons and keep the hero intact.");

  const compositionResponsePromise = page.waitForResponse((response) => {
    return (
      response.url().endsWith("/api/compositions") &&
      response.request().method() === "POST"
    );
  });
  await page.getByRole("button", { name: "TOUCH" }).click();

  await expect(page.getByRole("button", { name: /Safe Structure/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Editorial Rhythm/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dynamic Depth/ })).toBeVisible();
  await expect(page.getByText("Composition ready")).toBeVisible();

  const compositionResponse = await compositionResponsePromise;
  expect(compositionResponse.status()).toBe(201);
  const composition = (await compositionResponse.json()) as {
    composition: { source: string; warnings: string[] };
  };
  // Tier 3 proof: the deterministic fallback completed the composition…
  expect(composition.composition.source).toBe("recipe-fallback");
  // …and every degradation tier stayed observable in the response warnings.
  expect(composition.composition.warnings).toContainEqual(
    VISION_GATE_UNCONFIGURED_WARNING,
  );
  expect(composition.composition.warnings).toContainEqual(
    expect.stringMatching(TEXT_ONLY_PLANNER_UNAVAILABLE_PATTERN),
  );

  const refine = page.getByLabel("Refine with language");
  await refine.fill("主图更大，整体更有层次，放在右侧");
  const refineResponsePromise = page.waitForResponse((response) => {
    return (
      response.url().includes("/refine") &&
      response.request().method() === "POST"
    );
  });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(
    page.getByRole("button", { name: /Safe Structure layered-collage/ }),
  ).toBeVisible();

  const refineResponse = await refineResponsePromise;
  expect(refineResponse.status()).toBe(200);
  const refined = (await refineResponse.json()) as {
    composition: { warnings: string[] };
  };
  expect(refined.composition.warnings).toContainEqual(
    VISION_GATE_UNCONFIGURED_WARNING,
  );
  expect(refined.composition.warnings).toContainEqual(
    expect.stringMatching(TEXT_ONLY_REFINER_UNAVAILABLE_PATTERN),
  );
});
