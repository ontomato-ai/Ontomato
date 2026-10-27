import { z } from "zod";

// Deployment owns the connection. Component fields avoid URI escaping in Compose.
export function databaseUrl(env: Record<string, string | undefined>): string {
  if (env.AGENT_RUNTIME_DATABASE_URL)
    return z.string().url().parse(env.AGENT_RUNTIME_DATABASE_URL);
  const fields = z.object({
    POSTGRES_HOST: z.string().min(1),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65535),
    POSTGRES_USER: z.string().min(1),
    POSTGRES_PASSWORD: z.string().min(1),
    AGENT_RUNTIME_DATABASE: z.string().min(1),
  }).parse(env);
  const url = new URL("postgresql://localhost");
  url.hostname = fields.POSTGRES_HOST;
  url.port = String(fields.POSTGRES_PORT);
  url.username = encodeURIComponent(fields.POSTGRES_USER);
  url.password = encodeURIComponent(fields.POSTGRES_PASSWORD);
  url.pathname = "/" + encodeURIComponent(fields.AGENT_RUNTIME_DATABASE);
  return url.href;
}
