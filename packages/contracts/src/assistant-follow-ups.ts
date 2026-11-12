import { z } from "zod";

export const ASSISTANT_FOLLOW_UP_LABEL_MAX_LENGTH = 40;
export const ASSISTANT_FOLLOW_UP_MAX_SUGGESTIONS = 3;

export const assistantFollowUpsSchema = z.object({
  schema: z.literal("ontomato.follow-ups.v1"),
  suggestions: z.array(z.object({
    label: z.string().min(1).max(ASSISTANT_FOLLOW_UP_LABEL_MAX_LENGTH),
    question: z.string().min(1).max(2000),
    datasetPaths: z.array(z.string().startsWith("outputs/")).max(10),
  }).strict()).min(1).max(ASSISTANT_FOLLOW_UP_MAX_SUGGESTIONS),
}).strict();
