import { expect, test } from "@playwright/test";

test("keeps the opening rays centered after returning from the editor", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "一触开启网站" }),
  ).toBeVisible();

  await page.goto("/editor");
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "一触开启网站" }),
  ).toBeVisible();

  const alignment = await page.evaluate(() => {
    const root = document.querySelector(
      'section[aria-label="One Touch opening experience"]',
    );
    const button = root?.querySelector<HTMLButtonElement>(
      'button[aria-label="一触开启网站"]',
    );
    const svg = root?.querySelector<SVGSVGElement>(":scope > svg");
    const buttonBounds = button?.getBoundingClientRect();
    const svgBounds = svg?.getBoundingClientRect();
    const viewBox = svg?.viewBox.baseVal;
    const viewportCut = Array.from(
      svg?.querySelectorAll<SVGPathElement>('path[pathLength="100"]') ?? [],
    ).find((path) => {
      const match = path
        .getAttribute("d")
        ?.match(/^M\s+([\d.]+)\s+([\d.]+)/);
      return match ? Number(match[1]) > 100 : false;
    });
    const cutStart = viewportCut
      ?.getAttribute("d")
      ?.match(/^M\s+([\d.]+)\s+([\d.]+)/);

    if (!buttonBounds || !svgBounds || !viewBox || !cutStart) {
      return null;
    }

    return {
      buttonX: buttonBounds.left + buttonBounds.width / 2,
      buttonY: buttonBounds.top + buttonBounds.height / 2,
      cutX:
        svgBounds.left +
        ((Number(cutStart[1]) - viewBox.x) / viewBox.width) * svgBounds.width,
      cutY:
        svgBounds.top +
        ((Number(cutStart[2]) - viewBox.y) / viewBox.height) * svgBounds.height,
    };
  });

  expect(alignment).not.toBeNull();
  expect(Math.abs(alignment!.buttonX - alignment!.cutX)).toBeLessThan(0.5);
  expect(Math.abs(alignment!.buttonY - alignment!.cutY)).toBeLessThan(0.5);
});
