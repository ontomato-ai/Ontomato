import { z } from "zod";

export const productCurrentIdParamsSchema = z.object({ id: z.string().min(1).max(200) }).strict();
