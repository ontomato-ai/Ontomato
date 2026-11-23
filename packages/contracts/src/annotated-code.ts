import { z } from "zod";

/*
 * Generic annotated-code presentation contract shared by read owners (such as executable code explanations, formula
 * breakdowns, or script walkthroughs) and the official `AnnotatedCode` SDK component. Owners supply localized labels,
 * structured detail fragments with optional reference keys, and optional summary sections; the component renders them
 * without embedding business rules or parsing business syntax.
 */

/** One-based inclusive line range in the annotated code text. */
export const annotatedCodeLineRangeSchema = z.object({
  start: z.number().int().min(1),
  end: z.number().int().min(1),
}).strict().refine((range) => range.end >= range.start, {
  message: "lineRange.end must be greater than or equal to lineRange.start",
  path: ["end"],
});
export type AnnotatedCodeLineRange = z.infer<typeof annotatedCodeLineRangeSchema>;

/** Optional semantic tone for a segment card and its legend entry. */
export const annotatedCodeToneSchema = z.enum([
  "info",
  "success",
  "warning",
  "danger",
  "neutral",
  "accent",
]);
export type AnnotatedCodeTone = z.infer<typeof annotatedCodeToneSchema>;

/** One inline text fragment in a segment detail value; fragments with `refKey` render as clickable references. */
export const annotatedCodeDetailPartSchema = z.object({
  text: z.string(),
  refKey: z.string().min(1).optional(),
}).strict();
export type AnnotatedCodeDetailPart = z.infer<typeof annotatedCodeDetailPartSchema>;

/** One labeled detail row revealed when the reader expands a segment card. */
export const annotatedCodeDetailSchema = z.object({
  label: z.string().min(1),
  parts: z.array(annotatedCodeDetailPartSchema).min(1),
}).strict();
export type AnnotatedCodeDetail = z.infer<typeof annotatedCodeDetailSchema>;

/** One hierarchical annotated segment covering a line range; nested child segments sit at any depth. */
export type AnnotatedCodeSegment = {
  id: string;
  kind: string;
  /** Owner-supplied kind label in the reader's language. */
  kindLabel: string;
  title: string;
  lineRange: AnnotatedCodeLineRange;
  tone?: AnnotatedCodeTone;
  note?: string;
  details?: AnnotatedCodeDetail[];
  children?: AnnotatedCodeSegment[];
};

export const annotatedCodeSegmentSchema: z.ZodType<AnnotatedCodeSegment> = z.lazy(() => z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  kindLabel: z.string().min(1),
  title: z.string().min(1),
  lineRange: annotatedCodeLineRangeSchema,
  tone: annotatedCodeToneSchema.optional(),
  note: z.string().optional(),
  details: z.array(annotatedCodeDetailSchema).optional(),
  children: z.array(annotatedCodeSegmentSchema).optional(),
}).strict());

/** Visual tone for a bottom summary section. */
export const annotatedCodeSummaryToneSchema = z.enum(["default", "warning"]);
export type AnnotatedCodeSummaryTone = z.infer<typeof annotatedCodeSummaryToneSchema>;

/** One summary block displayed below the code and segment panes. */
export const annotatedCodeSummarySectionSchema = z.object({
  title: z.string().min(1),
  kind: z.enum(["list", "text"]),
  items: z.array(z.string()).optional(),
  text: z.string().optional(),
  tone: annotatedCodeSummaryToneSchema.optional(),
}).strict();
export type AnnotatedCodeSummarySection = z.infer<typeof annotatedCodeSummarySectionSchema>;

/** Complete annotated-code payload returned by an owner read for the `AnnotatedCode` component. */
export const annotatedCodeSchema = z.object({
  code: z.string().optional(),
  segments: z.array(annotatedCodeSegmentSchema),
  summary: z.array(annotatedCodeSummarySectionSchema).optional(),
}).strict();
export type AnnotatedCode = z.infer<typeof annotatedCodeSchema>;
