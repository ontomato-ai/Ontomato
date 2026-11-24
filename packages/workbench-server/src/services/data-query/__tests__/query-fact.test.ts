import { describe, expect, it } from "vitest";
import { buildQueryRunInput } from "../query-fact";

const IDENTITY = {
  threadId: "thread-1",
  requestSeq: 0,
  sourceKind: "query_stage",
  sourceRef: "query",
};

describe("buildQueryRunInput", () => {
  it("sums dataCount across all datasets when fact.dataCount is omitted", () => {
    const input = buildQueryRunInput({
      identity: IDENTITY,
      question: "Compare papers and think tank",
      fact: {
        datasets: [
          { id: "d1", data: [{ paper_count: 347 }] },
          { id: "d2", data: [{ thinktank_count: 56 }, { thinktank_count: 12 }] },
        ],
      },
    });

    expect(input.dataCount).toBe(3);
  });

  it("keeps explicit fact.dataCount and returns undefined when no dataset carries rows", () => {
    const explicit = buildQueryRunInput({
      identity: IDENTITY,
      question: "Explicit count",
      fact: {
        dataCount: 10,
        datasets: [{ id: "d1", data: [{ a: 1 }] }],
      },
    });
    expect(explicit.dataCount).toBe(10);

    const noRows = buildQueryRunInput({
      identity: IDENTITY,
      question: "No rows",
      fact: { datasets: [] },
    });
    expect(noRows.dataCount).toBeUndefined();
  });
});
