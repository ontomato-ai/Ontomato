import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantService } from "../service";
import { assistantStore, type TurnRow } from "../store";
import { OntologyRetrievalClient } from "../ontology-retrieval";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RetrievalSnapshot } from "@ontomato/contracts/data-retrieval";
import { HttpError } from "../../../utils/errors";

vi.mock("../skills", () => ({ prepareAssistantSkills: vi.fn() }));

const owner = { userId: "user-a", domainId: "domain-a" };
const source = { id: "source", sha256: "a".repeat(64) } as RuntimeArtifact;
function linkedDataset() {
  vi.spyOn(assistantService, "artifact").mockResolvedValue({ ...source, id: "copy" });
  vi.spyOn(assistantStore, "turns").mockResolvedValue([{ retrieval_scope_id: "caller" } as TurnRow]);
  vi.spyOn(OntologyRetrievalClient.prototype, "links").mockResolvedValue([{ retrievalId: "retrieval", runId: "round" }]);
  vi.spyOn(OntologyRetrievalClient.prototype, "evidence").mockResolvedValue({
    input: { question: "Sales?", userQuotes: [], previousDatasetIds: [], interaction: "resumable" },
    snapshot: { runtimeSessionId: "source-session", datasetArtifactIds: [source.id] } as RetrievalSnapshot,
  });
  vi.spyOn(OntologyRetrievalClient.prototype, "artifact").mockResolvedValue(source);
  return vi.spyOn(OntologyRetrievalClient.prototype, "dataset");
}
afterEach(() => { vi.restoreAllMocks(); });

describe("assistant ontology provenance", () => {
  it("accepts an identical copy only after ontology verifies the linked receipt", async () => {
    const verify = linkedDataset().mockResolvedValue({} as Awaited<ReturnType<OntologyRetrievalClient["dataset"]>>);
    expect(await assistantService.datasetSource("session", "copy", owner)).toEqual({ retrievalId: "retrieval", sourceArtifactId: "source" });
    expect(verify).toHaveBeenCalledWith("retrieval", "source");
  });
  it("rejects changed bytes even when the file has a dataset extension", async () => {
    const verify = linkedDataset();
    vi.mocked(assistantService.artifact).mockResolvedValue({ ...source, sha256: "b".repeat(64), path: "outputs/result.dataset.json" });
    await expect(assistantService.datasetSource("session", "copy", owner)).rejects.toMatchObject({ status: 404 });
    expect(verify).not.toHaveBeenCalled();
  });
  it("does not treat matching hashes as proof of an accepted receipt", async () => {
    linkedDataset().mockRejectedValue(new HttpError(404, "Unaccepted dataset"));
    await expect(assistantService.datasetSource("session", "copy", owner)).rejects.toThrow("Unaccepted dataset");
  });
  it("closes the parent's ontology scope with its user credential", async () => {
    const close = vi.spyOn(OntologyRetrievalClient.prototype, "close").mockImplementation(async function (this: OntologyRetrievalClient, credentials) {
      expect(this.scopeId).toBe("parent-run");
      expect(this.owner).toEqual(owner);
      expect(credentials).toEqual({ token: "user-token" });
    });
    await assistantService.stopChildren("parent-run", owner, { token: "user-token" });
    expect(close).toHaveBeenCalledOnce();
  });
});
