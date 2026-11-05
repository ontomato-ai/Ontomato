import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYSIS_SYSTEM_PROMPTS, REGULAR_SYSTEM_PROMPTS } from "../defaults";
import { migrateAssistantDefaultPrompts } from "../migration";
import type { QueryableClient } from "../../helpers";

const query = vi.fn();

vi.mock("../../../postgres", () => ({
  qualifiedTable: (name: string) => `"${name}"`,
}));

describe("assistant default prompt migration", () => {
  beforeEach(() => query.mockReset());

  it("clears only shipped defaults and keeps custom text", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "a",
            kind: "regular",
            system_prompt: `  ${REGULAR_SYSTEM_PROMPTS[1]}  `,
          },
          { id: "b", kind: "regular", system_prompt: "my custom prompt" },
          {
            id: "c",
            kind: "analysis",
            system_prompt: ANALYSIS_SYSTEM_PROMPTS[1],
          },
          {
            id: "d",
            kind: "custom",
            system_prompt: REGULAR_SYSTEM_PROMPTS[1],
          },
          { id: "e", kind: "regular", system_prompt: null },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 2 });

    const result = await migrateAssistantDefaultPrompts({
      query,
    } as unknown as QueryableClient);

    expect(result.cleared).toBe(2);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("SET system_prompt=NULL"),
      [["a", "c"]],
    );
  });

  it("does not write when every default row is already custom", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "a", kind: "regular", system_prompt: "custom" }],
    });

    expect(
      await migrateAssistantDefaultPrompts({ query } as unknown as QueryableClient),
    ).toEqual({ cleared: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
