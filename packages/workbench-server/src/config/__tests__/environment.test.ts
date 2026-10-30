import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { environment } from "../environment";
import { installRuntimeDefaults } from "../../runtime/defaults";

beforeEach(() => {
  for (const key of ["DATABASE_URL", "PG_CONNECTION_STRING", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD"])
    vi.stubEnv(key, "");
  installRuntimeDefaults({ postgresFallback: "postgresql://default:default@localhost:5432/workbench", systemMcpUrlFallback: "", requestLocaleFallback: "en" });
});
afterEach(() => { vi.unstubAllEnvs(); });

it("uses shared database inputs while retaining the workbench database and encoding credentials", () => {
  vi.stubEnv("POSTGRES_HOST", "postgres");
  vi.stubEnv("POSTGRES_PORT", "5433");
  vi.stubEnv("POSTGRES_USER", "a@b");
  vi.stubEnv("POSTGRES_PASSWORD", "p@ss%20word");
  const url = new URL(environment.pgConnection());
  expect(url.host).toBe("postgres:5433");
  expect(url.pathname).toBe("/workbench");
  expect(decodeURIComponent(url.username)).toBe("a@b");
  expect(decodeURIComponent(url.password)).toBe("p@ss%20word");
});

it("keeps an explicit connection override authoritative", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://custom:secret@external:6432/custom");
  vi.stubEnv("POSTGRES_PASSWORD", "shared");
  expect(environment.pgConnection()).toBe("postgresql://custom:secret@external:6432/custom");
});
