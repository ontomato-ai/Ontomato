import type { z } from "zod";
import { runtimeRegisterSkillRequestSchema } from "@ontomato/contracts/agent-runtime-skills";
import { HttpError } from "../../utils/errors";

/** A standard skill package: the identity plus the exact files the runtime receives. */
export type SkillPackage = z.infer<typeof runtimeRegisterSkillRequestSchema>;

/** A record failure with only the resource and structural field safe to disclose after admission. */
export class SkillSourceRecordError extends HttpError {
  constructor(readonly detail: { resourceId: string; title?: string; field?: string; reason: "record_missing" | "invalid_definition" | "component_missing" | "operation_unregistered" }) {
    super(502, [detail.resourceId, detail.field, detail.reason].filter(Boolean).join(": "), "SKILL_SOURCE_UNAVAILABLE");
  }
}
