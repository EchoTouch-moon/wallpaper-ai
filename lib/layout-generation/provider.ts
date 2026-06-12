import type {
  AiLayoutOperation,
  AiLayoutPlanResponse,
} from "./aiPlanSchema.ts";
import type { GenerateLayoutRequest } from "@/types/generateLayout";

export interface LayoutModelRequest {
  operation: AiLayoutOperation;
  request: GenerateLayoutRequest;
}

export interface LayoutModelProvider {
  generatePlan(request: LayoutModelRequest): Promise<AiLayoutPlanResponse>;
}
