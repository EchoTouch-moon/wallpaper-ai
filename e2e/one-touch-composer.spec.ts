import { expect, test } from "@playwright/test";
import sharp from "sharp";

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

test("uploads, composes, refines, downloads, and restores a session", async ({
  page,
}) => {
  await enterStudio(page);
  const first = await imageFixture("blue-horizon.png", {
    r: 58,
    g: 96,
    b: 210,
  });
  const second = await imageFixture("warm-portrait.png", {
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
  await page.getByRole("button", { name: "TOUCH" }).click();

  await expect(page.getByRole("button", { name: /Safe Structure/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Editorial Rhythm/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dynamic Depth/ })).toBeVisible();
  await expect(page.getByText("Composition ready")).toBeVisible();

  const refine = page.getByLabel("Refine with language");
  await refine.fill("主图更大，整体更有层次，放在右侧");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(
    page.getByRole("button", { name: /Safe Structure layered-collage/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("hero-grid")).toBeVisible();
  await refine.fill("主图更大，整体更有层次，放在右侧");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(
    page.getByRole("button", { name: /Safe Structure layered-collage/ }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "one-touch-3840x2160.png",
  );

  await page.reload();
  const gateway = page.getByRole("button", { name: "一触开启网站" });
  if (await gateway.isVisible()) {
    await gateway.click();
  }
  await expect(
    page.getByText("Restored your 24-hour composition session."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Safe Structure layered-collage/ }),
  ).toBeVisible();
});

test("supports custom target validation and narrow responsive layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterStudio(page);
  await page.getByRole("button", { name: /Custom/ }).click();
  const width = page.getByLabel("Width");
  const height = page.getByLabel("Height");
  await width.fill("9000");
  await height.fill("900");
  await expect(page.getByText(/Use 720–7680 px/)).toBeVisible();
  await expect(page.getByRole("button", { name: "TOUCH" })).toBeDisabled();
});
