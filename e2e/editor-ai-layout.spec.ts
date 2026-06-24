import { expect, test } from "@playwright/test";

const RED_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl8sAAAAASUVORK5CYII=",
  "base64",
);

test("uploads, generates, applies, restores and exports a layout", async ({
  page,
}) => {
  await page.goto("/editor");

  await page.getByRole("button", { name: "素材" }).click();

  await page.locator('input[type="file"]').setInputFiles(
    ["one.png", "two.png", "three.png"].map((name) => ({
      name,
      mimeType: "image/png",
      buffer: RED_PIXEL_PNG,
    })),
  );
  await expect(page.getByText("3 个项目")).toBeVisible();

  await page.getByRole("button", { name: "排版" }).click();
  await page.getByRole("button", { name: "本地规则" }).click();
  await page.getByRole("button", { name: "生成本地排版" }).click();

  const candidates = page.locator('button[aria-label^="应用排版:"]');
  await expect(candidates).toHaveCount(3);
  await candidates.first().click();
  await expect(page.getByText("已应用方案")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toBeEnabled();

  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByText("已应用方案")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出图片" }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe("wallpaper-1920x1080.png");
});

test("keeps the canvas primary and reveals tools progressively", async ({ page }) => {
  await page.goto("/editor");

  await expect(page.getByRole("application", { name: "Wallpaper canvas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "素材库" })).not.toBeVisible();

  await page.getByRole("button", { name: "素材" }).click();
  await expect(page.getByRole("heading", { name: "素材库" })).toBeVisible();
  await page.getByRole("button", { name: "关闭素材面板" }).click();
  await expect(page.getByRole("heading", { name: "素材库" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "素材" })).toBeFocused();

  await page.getByRole("button", { name: "检查器" }).click();
  await expect(page.getByRole("heading", { name: "参数面板" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭检查器" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "参数面板" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "检查器" })).toBeFocused();

  await page.getByRole("button", { name: "更多" }).click();
  await expect(page.getByText("安全区域")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("安全区域")).not.toBeVisible();
});
