import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/editor",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // e2e runs the full three-tier degradation chain (plan/multimodal-
    // planning-protocol-design.md §2.4) end to end: the vision planning gate
    // is ON while every model credential is stripped, so multimodal →
    // text-only → deterministic fallback resolves without any network or
    // real API key. The env only applies when Playwright launches the server
    // itself; a dev server already listening on 3100 is still reused as
    // before (reuseExistingServer semantics are unchanged).
    env: {
      ...process.env,
      LLM_API_KEY: "",
      LLM_MODEL: "",
      VISION_API_KEY: "",
      VISION_MODEL: "",
      VISION_PLANNING_ENABLED: "true",
      // The local ONNX geometry layer stays off in e2e: this suite exercises
      // the UI orchestration and the planning degradation chain, not local
      // model inference (that contract is covered by the lib/server unit
      // tests). It also keeps the suite machine-independent — with models
      // present each upload spends seconds in ISNet inference and blows the
      // upload assertions' timeout, and without them the layer degrades with
      // warnings instead.
      LOCAL_VISION_ENABLED: "false",
    },
  },
});
