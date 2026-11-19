import { expect, it, vi } from "vitest";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import { agentDefinitionAdapters } from "../../../../../packages/apps-sdk/src/panel/agent-definition";
import type { PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";

const id = "20d7f17e-b124-496c-b64e-a5665dae142b";
const record = { kind: "object", objectType: AGENT_DEFINITION, primaryKey: id } as const;
const values = {
  name: "Editor", description: "", icon: null, enabled: true, systemPrompt: "Brief",
  skills: [], classNames: [], enabledMcpServiceIds: [], modelSelection: { modelId: null },
};
function setup() {
  const request = vi.fn<Parameters<PlatformRequests["request"]>, ReturnType<PlatformRequests["request"]>>(
    async () => Response.json({ ...values, id, sortOrder: 0, executionUserId: null }),
  );
  return { request, forms: agentDefinitionAdapters({ request })[0]!.forms! };
}

it.each([
  { submittedFields: ["/systemPrompt"], sendsSkills: false },
  { submittedFields: ["/skills"], sendsSkills: true },
])("uses explicit skill intent rather than the form's displayed empty selection", async ({ submittedFields, sendsSkills }) => {
  const { request, forms } = setup();
  await forms.save(record, { values, submittedFields });
  const [path, init, service] = request.mock.calls[0]!;
  expect([path, init.method, service]).toEqual([`/assistant/agent-definitions/${id}`, "PUT", ""]);
  const sent = JSON.parse(String(init.body));
  if (sendsSkills) expect(sent.skills).toEqual([]);
  else expect(sent).not.toHaveProperty("skills");
  expect(sent).not.toHaveProperty("submittedFields");
});

it("refuses an update without a submitted field list before sending a request", async () => {
  const { request, forms } = setup();
  await expect(forms.save(record, { values })).rejects.toThrow("submittedFields");
  expect(request).not.toHaveBeenCalled();
});

it("creates through the original contract with the explicit skills array", async () => {
  const { request, forms } = setup();
  await forms.save({ kind: "draft" }, { values });
  expect(request.mock.calls[0]?.[1].method).toBe("POST");
  expect(JSON.parse(String(request.mock.calls[0]?.[1].body)).skills).toEqual([]);
});
