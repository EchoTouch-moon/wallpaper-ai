import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The asset/composition stores resolve storage locations at runtime
  // (ONE_TOUCH_STORAGE_DIR / tmpdir() / cwd-relative models dir), which makes
  // Turbopack's file tracer conservatively pull next.config.ts into the
  // traced file list ("Encountered unexpected file in NFT list" warning).
  // The config file never belongs in a route's runtime output, so exclude it
  // from output file tracing.
  outputFileTracingExcludes: {
    "*": ["./next.config.ts"],
  },
};

export default nextConfig;
