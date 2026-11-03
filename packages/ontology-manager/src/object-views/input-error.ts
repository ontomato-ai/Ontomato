import { ObjectViewInputError } from "@ontomato/contracts/object-views";
import type { MessageKey, TextParams } from "../i18n";

export function viewInputErrorMessage(reason: unknown, text: (key: MessageKey, params?: TextParams) => string): string {
  if (reason instanceof ObjectViewInputError) {
    const key = { unknown: "ovUnknownInput", missing: "ovMissingInput", invalid: "ovInvalidInput" } as const;
    return text(key[reason.reason], { name: reason.inputName });
  }
  return reason instanceof Error ? reason.message : String(reason);
}
