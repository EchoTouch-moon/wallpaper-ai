import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(scriptDir, "..");
const rendererOutput = join(desktopRoot, "out", "renderer");
const manifestSource = join(desktopRoot, "octos", "octos.json");
const packageOutput = join(desktopRoot, "dist", "octos");

await access(join(rendererOutput, "index.html"));
await access(manifestSource);

await rm(packageOutput, { recursive: true, force: true });
await mkdir(packageOutput, { recursive: true });
await cp(rendererOutput, packageOutput, { recursive: true });
await copyFile(manifestSource, join(packageOutput, "octos.json"));

const packagedHtml = await readFile(
  join(packageOutput, "index.html"),
  "utf8",
);
const hasRootRelativeAsset =
  /\b(?:src|href)=["']\/(?!\/)/u.test(packagedHtml);
if (hasRootRelativeAsset) {
  throw new Error(
    "Octos package contains root-relative assets; renderer base must be './'",
  );
}

console.log(`Octos package ready: ${packageOutput}`);
