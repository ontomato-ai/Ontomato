import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java" } } }));
import { tmpdir } from "node:os";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";

configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
installContentLayout({ runtimeRoot: tmpdir(), prompts: [], publicSkillsRoot: tmpdir(), runtimeResources: [] });
const { createAgentOptionReadAdapters } = await import("../panel-reads");
const { describeAgentDefinitionForm } = await import("../definition-form");

/*
 * The agent form as the original agent settings page asked for it (原页面对照《智能体设置》, panelisation lead
 * 2026-11-22): only the name must be filled in; the model and whose permissions the agent runs with each offer their
 * empty choice by name — the domain's default model, the reader's own permissions — so a reader can go back to it and
 * reads what an empty field means.
 */

const viewer = { token: "reader", locale: "en" };
const owner = { domainId: "domain", userId: "alice" };
const answer = (url: string) => {
  if (url.includes("/model-options"))
    return Response.json({ success: true, data: {
      models: [{ ref: "local/dev-model", name: "Dev model", type: "chat" }, { ref: "local/embed", name: "Embedder", type: "embedding", dimensions: 8 }],
      defaultModelId: "local/dev-model", embeddingModelId: null,
    } });
  if (url.includes("/platform/agent-execution/options"))
    return Response.json({ canSetExecutionUser: true, users: [{ id: "u-1", name: "Wang" }] });
  throw new Error(`unexpected ${url}`);
};
afterEach(() => { vi.unstubAllGlobals(); });

it("offers the domain's default model and the reader's own permissions by name, first", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(String(url))));
  const options = createAgentOptionReadAdapters(viewer as never);
  const models = (await options.models.options()).options;
  expect(models[0]).toEqual({ primaryKey: "@default", value: null, label: "Domain default (Dev model)" });
  expect(models.slice(1).map(({ value }) => value)).toEqual(["local/dev-model"]);
  const users = (await options.users.options({})).options;
  expect(users[0]).toEqual({ primaryKey: "@default", value: null, label: "The reader's own permissions" });
  expect(users.slice(1).map(({ value }) => value)).toEqual(["u-1"]);
  // A held empty value reads as the same choice.
  expect((await options.models.resolve([null])).options[0]!.label).toBe("Domain default (Dev model)");
});

it("asks only for the agent's name before it is saved", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(String(url))));
  const form = await describeAgentDefinitionForm({ target: { kind: "draft" } } as never, owner as never, viewer as never);
  expect(form.fields.filter((field) => field.required).map((field) => field.path)).toEqual(["/name"]);
});
