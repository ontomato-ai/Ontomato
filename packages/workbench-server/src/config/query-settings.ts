import { getSystemModelConfig } from "./system-model";
export function getQueryTimeoutMs(): number {
  return getSystemModelConfig().queryTimeoutSeconds * 1000;
}
