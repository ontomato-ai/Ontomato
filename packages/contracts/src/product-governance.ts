import { z } from "zod";

export const RETRIEVAL_AGENT_ID = "dd3b91b9-9214-4aa6-9937-fb07fd37b232";

export const changeProductDomainGrantRequestSchema = z.object({ shared: z.boolean() }).strict();
export const productGrantChangeResponseSchema = z.object({ success: z.literal(true) }).strict();
