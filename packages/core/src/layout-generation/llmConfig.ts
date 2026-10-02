export type LlmResponseFormat = "json_schema" | "json_object" | "text";

/**
 * Model identity for the multimodal planning call (plan/multimodal-planning-
 * protocol-design.md §2.4). Resolved from VISION_API_KEY / VISION_BASE_URL /
 * VISION_MODEL with fallback to the main LLM configuration; only present when
 * VISION_PLANNING_ENABLED resolves to a usable configuration.
 */
export interface VisionPlanningModelConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
}

export interface LayoutModelConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  responseFormat: LlmResponseFormat;
  timeoutMs: number;
  /**
   * Present only when LLM_STREAMING is exactly "true": planning calls stream
   * chat-completion deltas instead of waiting for a buffered response, which
   * keeps bytes flowing through relay gateways whose idle timeouts would
   * otherwise cut off long-thinking models. Omitted otherwise so zero-config
   * deployments keep the exact previous shape.
   */
  streaming?: boolean;
  /**
   * Present only when VISION_PLANNING_ENABLED=true resolves to an usable
   * vision model configuration. Omitted otherwise so zero-config deployments
   * keep the exact previous shape and the provider stays text-only.
   */
  visionPlanning?: VisionPlanningModelConfig;
}

export class LayoutModelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutModelConfigurationError";
  }
}

function parseResponseFormat(value: string | undefined): LlmResponseFormat {
  if (!value || value === "json_object") {
    return "json_object";
  }
  if (value === "json_schema" || value === "text") {
    return value;
  }
  throw new LayoutModelConfigurationError(
    `Unsupported LLM_RESPONSE_FORMAT: ${value}`,
  );
}

function parseTimeout(value: string | undefined) {
  if (!value) {
    return 30_000;
  }
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 300_000) {
    throw new LayoutModelConfigurationError(
      "LLM_TIMEOUT_MS must be an integer between 1000 and 300000",
    );
  }
  return timeout;
}

function parseStreaming(value: string | undefined): boolean {
  if (!value || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new LayoutModelConfigurationError(
    'LLM_STREAMING must be exactly "true" or "false"',
  );
}

export function loadLayoutModelConfig(
  environment: Record<string, string | undefined> = process.env,
): LayoutModelConfig {
  const apiKey = environment.LLM_API_KEY?.trim();
  const model = environment.LLM_MODEL?.trim();

  if (!apiKey) {
    throw new LayoutModelConfigurationError("LLM_API_KEY is not configured");
  }
  if (!model) {
    throw new LayoutModelConfigurationError("LLM_MODEL is not configured");
  }

  const visionPlanning = loadVisionPlanningConfig(environment);
  return {
    apiKey,
    baseURL:
      environment.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
    model,
    responseFormat: parseResponseFormat(environment.LLM_RESPONSE_FORMAT),
    timeoutMs: parseTimeout(environment.LLM_TIMEOUT_MS),
    // Conditional spread keeps the zero-config shape byte-identical.
    ...(parseStreaming(environment.LLM_STREAMING) ? { streaming: true } : {}),
    ...(visionPlanning ? { visionPlanning } : {}),
  };
}

/**
 * Multimodal planning gate (plan/multimodal-planning-protocol-design.md
 * §2.4). Disabled unless VISION_PLANNING_ENABLED is exactly "true" (same
 * strict pattern as VISION_ENABLED in lib/server/visionProvider.ts). When the
 * gate is on but VISION_API_KEY/VISION_MODEL (after falling back to the main
 * LLM configuration) cannot be resolved, this returns null and the caller
 * degrades to text-only planning instead of throwing.
 */
export function visionPlanningGateRequested(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.VISION_PLANNING_ENABLED === "true";
}

export function loadVisionPlanningConfig(
  environment: Record<string, string | undefined> = process.env,
): VisionPlanningModelConfig | null {
  if (!visionPlanningGateRequested(environment)) {
    return null;
  }
  const apiKey =
    environment.VISION_API_KEY?.trim() || environment.LLM_API_KEY?.trim();
  const model = environment.VISION_MODEL?.trim() || environment.LLM_MODEL?.trim();
  if (!apiKey || !model) {
    return null;
  }
  const timeout = Number(environment.VISION_TIMEOUT_MS ?? "20000");
  return {
    apiKey,
    baseURL:
      environment.VISION_BASE_URL?.trim() ||
      environment.LLM_BASE_URL?.trim() ||
      "https://api.openai.com/v1",
    model,
    timeoutMs:
      Number.isFinite(timeout) && timeout >= 1_000 ? timeout : 20_000,
  };
}
