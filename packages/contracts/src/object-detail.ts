import { z } from "zod";
import { panelObjectRefSchema } from "./panel-manifest";
import { productCurrentIdParamsSchema } from "./product-record-id";

const className = panelObjectRefSchema.shape.className;
const panelId = productCurrentIdParamsSchema.shape.id;

/** Path parameters for GET, PUT and DELETE /api/object-details/:className. */
export const objectDetailClassParamsSchema = z.object({ className }).strict();
export type ObjectDetailClassParams = z.infer<typeof objectDetailClassParamsSchema>;

/** A detail binding form clears the mapping with an empty panel ID. */
export const saveObjectDetailValuesSchema = z.object({ panelId: z.union([panelId, z.literal(""), z.null()]) }).strict();

export const setObjectDetailRequestSchema = z.object({ panelId }).strict();
export const setObjectDetailResponseSchema = setObjectDetailRequestSchema;
export type SetObjectDetailRequest = z.infer<typeof setObjectDetailRequestSchema>;
export type SetObjectDetailResponse = z.infer<typeof setObjectDetailResponseSchema>;

/** Shared GET response. Only a class with no mapping returns null. */
export const objectDetailResponseSchema = z.object({ panelId: panelId.nullable() }).strict();
export type ObjectDetailResponse = z.infer<typeof objectDetailResponseSchema>;

/** DELETE takes no body and returns the cleared mapping. */
export const clearObjectDetailResponseSchema = objectDetailResponseSchema.extend({ panelId: z.null() });
export type ClearObjectDetailResponse = z.infer<typeof clearObjectDetailResponseSchema>;

/** GET /api/object-details/by-panel/:panelId. */
export const objectDetailPanelParamsSchema = z.object({ panelId }).strict();
export const objectDetailUsedByResponseSchema = z.object({ classNames: z.array(className) }).strict();
export type ObjectDetailPanelParams = z.infer<typeof objectDetailPanelParamsSchema>;
export type ObjectDetailUsedByResponse = z.infer<typeof objectDetailUsedByResponseSchema>;
