import { ZodError } from "zod";
import { useI18n } from "vue-i18n";
import { platformErrorCode } from "../api";
import { usePlatformHost } from "../context";

/** Error codes of the model settings endpoints that have a message of their own (contract.md, "接口"). */
const knownCodes = [
  "INVALID_REQUEST",
  "MODEL_NOT_CONFIGURED",
  "MODEL_TEST_FAILED",
  "MODEL_DISCOVERY_UNSUPPORTED",
  "MODEL_DISCOVERY_FAILED",
  "DEPENDENCY_UNAVAILABLE",
] as const;

/**
 * Readable text of a failed model settings request: the code's message with the service's detail after it. Other
 * failures keep the caller's fallback text before the detail.
 */
export function useModelErrors() {
  const { t } = useI18n();
  const { separators } = usePlatformHost();
  return (error: unknown, fallbackKey: string): string => {
    if (error instanceof ZodError) return t("admin.modelErrors.UNRECOGNIZED_RESPONSE");
    const code = platformErrorCode(error);
    const detail = error instanceof Error && error.message ? error.message : t("common.unknownError");
    const title = code && (knownCodes as readonly string[]).includes(code) ? t(`admin.modelErrors.${code}`) : t(fallbackKey);
    return `${title}${separators.detail}${detail}`;
  };
}
