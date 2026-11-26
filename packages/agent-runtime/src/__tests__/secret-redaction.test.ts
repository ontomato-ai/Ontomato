import { describe, expect, it } from "vitest";
import { redactSecrets } from "../code";

describe("runtime secret redaction", () => {
  it("removes every configured secret before outputs are persisted", () => {
    const output = "token=caller-token query=query-token caller-token";

    expect(redactSecrets(output, ["caller-token", "query-token"])).toBe(
      "token=[REDACTED] query=[REDACTED] [REDACTED]",
    );
  });

  it("redacts longer overlapping secrets first", () => {
    expect(redactSecrets("prefix-long-secret-suffix", ["long", "long-secret"])).toBe(
      "prefix-[REDACTED]-suffix",
    );
  });
});
