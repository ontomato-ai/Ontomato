import { z } from "zod";

export const assistantFollowUpsSchema = z.object({
  schema: z.literal("ontomato.follow-ups.v1"),
  suggestions: z.array(z.object({
    label: z.string().min(1).max(40),
    question: z.string().min(1).max(2000),
    datasetPaths: z.array(z.string().startsWith("outputs/")).max(10),
  }).strict()).min(1).max(3),
}).strict();
