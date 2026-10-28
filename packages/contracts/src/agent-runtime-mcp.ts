import { z } from "zod";
import { runtimeIdSchema } from "./agent-runtime-values";
import { mcpToolDescSchema } from "./mcp";

export const MCP_HEADER_MASK = "********";
export const runtimeMcpRefSchema = z.object({ id: runtimeIdSchema }).strict();
const nameSchema = z.string().trim().min(1).max(100);
const urlSchema = z
  .string()
  .trim()
  .url()
  .refine((url) => /^https?:\/\//i.test(url));
const headersSchema = z
  .record(
    z
      .string()
      .refine((value) => value !== MCP_HEADER_MASK)
      .nullable(),
  )
  .superRefine((headers, ctx) => {
    const names = new Set<string>();
    for (const [name, value] of Object.entries(headers)) {
      try {
        new Headers({ [name]: value ?? "" });
        if (names.has(name.toLowerCase())) throw new Error();
        names.add(name.toLowerCase());
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid or duplicate HTTP header",
        });
      }
    }
  })
  .transform((headers) =>
    Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    ),
  );

export const mcpServiceWriteSchema = z
  .object({
    name: nameSchema,
    url: urlSchema,
    headers: headersSchema.optional(),
  })
  .strict();
export const mcpServiceViewSchema = runtimeMcpRefSchema.extend({
  name: nameSchema,
  url: urlSchema,
  headers: z.record(z.literal(MCP_HEADER_MASK)),
});
export const mcpServiceOptionsSchema = z.array(
  mcpServiceViewSchema.pick({ id: true, name: true }),
);
export const mcpServiceListSchema = z
  .object({ services: z.array(mcpServiceViewSchema) })
  .strict();
export const mcpServiceResponseSchema = z
  .object({ service: mcpServiceViewSchema })
  .strict();
export const mcpServiceToolsSchema = z
  .object({ tools: z.array(mcpToolDescSchema) })
  .strict();
export type McpServiceWrite = z.infer<typeof mcpServiceWriteSchema>;
export type McpServiceView = z.infer<typeof mcpServiceViewSchema>;
export type McpServiceOption = z.infer<typeof mcpServiceOptionsSchema>[number];
