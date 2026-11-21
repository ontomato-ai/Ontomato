import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentHostRunSnapshotSchema } from "@ontomato/contracts/agent-host";

const fixture = process.env.ONTOLOGY_HOST_CONTRACT_OUTPUT;
// The Java contract test writes the HTTP response to this fixture before this check runs.
if (!fixture)
  throw new Error(
    "Set ONTOLOGY_HOST_CONTRACT_OUTPUT to the file OntologyRetrievalContractTest writes",
  );
describe("Java ontology host to shared shell contract", () => {
  it("accepts the actual Java HTTP projection with admitted skill metadata", () => {
    const value: unknown = JSON.parse(readFileSync(fixture, "utf8"));
    const snapshot = agentHostRunSnapshotSchema.parse(value);
    expect(snapshot.run.resolvedSkills[0].skill.namespace).toEqual({ kind: "provider", provider: "ontology" });
    expect(snapshot.run.resolvedSkills[0].digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
