export type LlmResponseFormat = "json_schema" | "json_object" | "text";

export interface LayoutModelConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  responseFormat: LlmResponseFormat;
  timeoutMs: number;
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
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new LayoutModelConfigurationError(
      "LLM_TIMEOUT_MS must be an integer between 1000 and 120000",
    );
  }
  return timeout;
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

  return {
    apiKey,
    baseURL:
      environment.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
    model,
    responseFormat: parseResponseFormat(environment.LLM_RESPONSE_FORMAT),
    timeoutMs: parseTimeout(environment.LLM_TIMEOUT_MS),
  };
}
