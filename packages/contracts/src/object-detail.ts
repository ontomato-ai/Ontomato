import { z } from "zod";
import { panelObjectRefSchema } from "./panel-manifest";
import { productCurrentIdParamsSchema } from "./product-panels";

const className = panelObjectRefSchema.shape.className;
const panelId = productCurrentIdParamsSchema.shape.id;

/** Path parameters for GET, PUT and DELETE /api/object-details/:className. */
export const objectDetailClassParamsSchema = z.object({ className }).strict();
export type ObjectDetailClassParams = z.infer<typeof objectDetailClassParamsSchema>;

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

/** GET with platform service authentication. The caller checks the reader's use grant separately. */
export const OBJECT_DETAIL_INTERNAL_PATH = "/internal/object-details/resolve";
export const objectDetailInternalQuerySchema = objectDetailClassParamsSchema.extend({
  domainId: z.string().min(1),
});
export type ObjectDetailInternalQuery = z.infer<typeof objectDetailInternalQuerySchema>;
