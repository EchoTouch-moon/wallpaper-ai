// Contract parity validator — used by the Python test suite
// (services/layout-orchestrator/tests/test_contract_parity.py) to drive the
// Zod side of cross-language contract checks.
//
// Reads a single JSON object from stdin:
//   { "kind": "request" | "response", "payload": <camelCase JSON> }
//
// Writes a JSON result to stdout:
//   { "ok": true }                      when the payload is valid
//   { "ok": false, "errors": [...] }    when validation fails
//
// Exit codes:
//   0  validation completed (regardless of pass/fail) — result is on stdout
//   1  unrecoverable error (bad stdin, missing module) — message on stderr
//
// This script must stay free of business logic: it only delegates to the
// canonical Zod schemas so that a drift between Zod and Pydantic surfaces as
// a test failure rather than silently diverging at runtime.

import process from "node:process";

import { generateLayoutRequestSchema } from "../lib/layout-generation/schema.ts";
import { aiLayoutPlanResponseSchema } from "../lib/layout-generation/aiPlanSchema.ts";

const SCHEMAS = {
  request: generateLayoutRequestSchema,
  response: aiLayoutPlanResponseSchema,
};

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const raw = await readStdin();
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`Invalid stdin JSON: ${error.message}\n`);
    process.exit(1);
  }

  const { kind, payload } = envelope ?? {};
  const schema = SCHEMAS[kind];
  if (!schema) {
    process.stderr.write(
      `Unknown contract kind: ${kind}. Expected "request" or "response".\n`,
    );
    process.exit(1);
  }

  const result = schema.safeParse(payload);
  if (result.success) {
    process.stdout.write(JSON.stringify({ ok: true }));
  } else {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }),
    );
  }
}

main().catch((error) => {
  process.stderr.write(`Contract validator crashed: ${error}\n`);
  process.exit(1);
});
