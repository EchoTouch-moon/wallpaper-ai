import type {
  AiLayoutOperation,
  AiLayoutPlanResponse,
} from "./aiPlanSchema.ts";
import type { PlanningRequest } from "./planningProtocol.ts";
import type { GenerateLayoutRequest } from "../types/generateLayout.ts";

/**
 * The v2 planning protocol port (see plan/multimodal-planning-protocol-design.md §2.5):
 * the single stable seam every execution engine implements. It consumes a native
 * CompositionBrief planning request and returns the constrained AI plan response.
 */
export interface LayoutModelProvider {
  generatePlan(planning: PlanningRequest): Promise<AiLayoutPlanResponse>;
}

/**
 * Frozen port for the legacy GenerateLayoutRequest protocol used by the Editor
 * and LangGraph paths. Kept behavior-identical to the pre-v2
 * LayoutModelProvider; remove it once those paths migrate to the v2 protocol.
 */
export interface LegacyLayoutModelProvider {
  generateLegacyPlan(input: LayoutModelRequest): Promise<AiLayoutPlanResponse>;
}

export interface LayoutModelRequest {
  operation: AiLayoutOperation;
  request: GenerateLayoutRequest;
}
