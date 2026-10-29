import { z } from "zod";
import definition from "./service-logging-format.json";

export const serviceLogFormat = definition;
const enumeration = (values: string[]) => z.enum(values as [string, ...string[]]);
export const serviceLogLevelSchema = enumeration(definition.levels);
export const serviceLogServiceSchema = enumeration(definition.services);
export const serviceLogIdentitySchema = z.string().min(1).refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).length <= definition.limits.encodedIdentityBytes,
  "Log identity is too long",
);
export const serviceLogCorrelationSchema = z.string().regex(new RegExp(definition.correlationIdPattern));

export const serviceLogTimestampSchema = z.string().datetime({ precision: 3 });
export const serviceLogRecordSchema = z.object({
  id: z.string().uuid(),
  time: serviceLogTimestampSchema,
  level: serviceLogLevelSchema,
  module: z.string(),
  instanceId: z.string().nullable(),
  correlationId: z.string().nullable(),
  domainId: z.string().nullable(),
  userId: z.string().nullable(),
  runId: z.string().nullable(),
  sessionId: z.string().nullable(),
  line: z.string(),
}).strict();
export type ServiceLogRecord = z.infer<typeof serviceLogRecordSchema>;

export const serviceLogPageSchema = z.object({
  service: serviceLogServiceSchema,
  window: z.object({ from: serviceLogTimestampSchema, to: serviceLogTimestampSchema }).strict(),
  records: z.array(serviceLogRecordSchema),
  nextCursor: z.string().nullable(),
  storage: z.object({ mode: z.literal("best-effort"), retentionDays: z.number().int().positive() }).strict(),
}).strict();
export type ServiceLogPage = z.infer<typeof serviceLogPageSchema>;

export const serviceLogQuerySchema = z.object({
  correlationId: serviceLogIdentitySchema.optional(),
  runId: serviceLogIdentitySchema.optional(),
  sessionId: serviceLogIdentitySchema.optional(),
  domainId: serviceLogIdentitySchema.optional(),
  userId: serviceLogIdentitySchema.optional(),
  instanceId: serviceLogIdentitySchema.optional(),
  module: serviceLogIdentitySchema.optional(),
  minLevel: serviceLogLevelSchema.optional(),
  from: serviceLogTimestampSchema.optional(),
  to: serviceLogTimestampSchema.optional(),
  cursor: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.union([z.number(), z.string().regex(/^[0-9]+$/)]).transform(Number)
    .pipe(z.number().int().min(1).max(definition.defaults.query.maxLimit)).default(definition.defaults.query.defaultLimit),
}).strict();
export type ServiceLogQuery = z.input<typeof serviceLogQuerySchema>;

/** Only log attribution belongs here; credentials and business context stay with the host. */
export interface ServiceLogContext {
  correlationId?: string | null;
  domainId?: string | null;
  userId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
}

export interface ServiceLogEvent extends Omit<ServiceLogRecord, "line"> {
  service: string;
  kind: "app" | "http" | "downstream";
  message: string;
  method?: string;
  path?: string;
  status?: number | null;
  durationMs?: number;
  outcome?: "success" | "failure" | "cancelled";
  target?: string;
  errorName?: string | null;
  errorCode?: string | null;
  stack?: string | null;
}
