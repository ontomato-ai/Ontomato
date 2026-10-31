import { z } from "zod";

/** JSON-only values cross the process boundary; undefined and non-finite numbers do not. */
export type RuntimeJsonValue =
  | null
  | boolean
  | number
  | string
  | RuntimeJsonValue[]
  | {
      [key: string]: RuntimeJsonValue;
    };
export const runtimeJsonValueSchema: z.ZodType<RuntimeJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(runtimeJsonValueSchema),
    z.record(runtimeJsonValueSchema),
  ]),
);
export const runtimeJsonObjectSchema = z.record(runtimeJsonValueSchema);
export const runtimeIdSchema = z.string().uuid();
export const runtimeKeySchema = z.string().min(1);
export const runtimeSequenceSchema = z.number().int().nonnegative().safe();
export const runtimeTimestampSchema = z.string().datetime({ offset: true });
export const runtimeHttpUrlSchema = z
  .string()
  .url()
  .regex(/^https?:\/\//)
  .pipe(
    z.string().refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.hash;
    }, "Credentials and fragments do not belong in a service URL"),
  );
export const runtimeRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.includes("\\") &&
      !path.includes("\0") &&
      !path.includes(":") &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Expected a relative path without empty, dot or parent segments",
  );

export const runtimeRunStatusSchema = z.enum(["running", "stopped"]);
export const runtimeStopReasonSchema = z.enum([
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
]);
export type RuntimeRunStatus = z.infer<typeof runtimeRunStatusSchema>;
export type RuntimeStopReason = z.infer<typeof runtimeStopReasonSchema>;
