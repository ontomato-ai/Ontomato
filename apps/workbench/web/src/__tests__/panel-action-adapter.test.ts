import { describe, expect, it } from "vitest";
import { actionAdapters } from "../../../../../packages/apps-sdk/src/panel/action";
import { PlatformObjectRefusal, type PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";

/*
 * The action resource adapter against a fake owner: its form description's errors pass the strict schema, and a save
 * the owner refuses at a field becomes a typed refusal with the same JSON Pointers.
 */

function fake(answer: (path: string, body: unknown) => unknown) {
  const sent: { path: string; body: unknown; service: string }[] = [];
  const requests: PlatformRequests = {
    async request(path, init, service) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      sent.push({ path, body, service });
      return Response.json(answer(path, body));
    },
  };
  return { requests, sent };
}

const formDescription = {
  fields: [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false }],
  values: { name: "Approve order" },
  errors: [{ field: "/name", code: "required", message: "name is required" }],
  save: { method: "POST", path: "/action/save", bodySchema: {}, draftOperation: "action.update" },
};

describe("action resource adapter", () => {
  it("parses the owner's form description with its field errors", async () => {
    const { requests, sent } = fake(() => ({ success: true, data: formDescription }));
    const [adapter] = actionAdapters(requests);

    expect(await adapter!.forms!.describe({ target: { kind: "draft" }, changedField: null })).toEqual(formDescription);
    expect(sent[0]).toMatchObject({ path: "/action/definitionForm", body: { target: { kind: "draft" }, changedField: null }, service: "/data-query" });
  });

  it("turns a save the owner refuses at a field into a typed refusal with its pointers", async () => {
    const message = "Action.publishedIsFrozen";
    const { requests } = fake(() => ({
      success: false, code: "ACTION_PUBLISHED_FROZEN", message,
      errors: [{ field: "/function/code", code: "invalid_object", message }],
    }));
    const [adapter] = actionAdapters(requests);

    await expect(adapter!.forms!.save({ kind: "draft" }, { values: { name: "Approve order" } }))
      .rejects.toMatchObject({ name: "PlatformObjectRefusal", message, fields: { "/function/code": message } });
    await expect(adapter!.forms!.save({ kind: "draft" }, { values: { name: "Approve order" } }))
      .rejects.toBeInstanceOf(PlatformObjectRefusal);
  });
});
