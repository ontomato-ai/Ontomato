import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "element-plus/es/locale/lang/en";
import { installWorkbenchI18n } from "../../../i18n";
import { installAuthHost } from "../../../utils/auth";
import { installErrorPunctuation } from "../../../utils/error-punctuation";
import { createPanelOperationSettings } from "../assistant-host";

/*
 * The assistant's conversations keep whether agents ask before a panel operation at the owner-only settings route of
 * their provider, `workbench`. Only the owner reads it; the host refuses anyone else, which the shell takes as not
 * offering the choice. Any other failure is the reader's to see.
 */

const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const path = `/api/panel-operation-settings/workbench/${sessionId}`;
const requests: { method: string; url: string; body: unknown }[] = [];
let answer: { status: number; body: unknown };

beforeEach(() => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
    messages: { en: { admin: { requestFailed: "Request failed" } } },
    elementLocale: () => en,
  });
  installAuthHost({
    getToken: () => "token", getApiKey: () => null, responseStatusError: () => null, getUserInfo: () => null,
    verifySessionOnce: async () => "valid", handleAuthExpired: () => {},
  });
  installErrorPunctuation({ detailSeparator: " — ", listSeparator: " | " });
  requests.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({ method: init.method!, url, body: init.body === undefined ? undefined : JSON.parse(init.body as string) });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const held = (confirmBeforeExecute: boolean) => ({ rootSession: { providerId: "workbench", sessionId }, confirmBeforeExecute });

it("reads and writes the owner's choice for the conversation", async () => {
  const settings = createPanelOperationSettings();
  answer = { status: 200, body: held(true) };
  expect(await settings.read(sessionId)).toBe(true);
  answer = { status: 200, body: held(false) };
  expect(await settings.write(sessionId, false)).toBe(false);
  expect(requests).toEqual([
    { method: "GET", url: path, body: undefined },
    { method: "PUT", url: path, body: { confirmBeforeExecute: false } },
  ]);
});

it("offers nothing to a reader the host refuses, and lets other failures through", async () => {
  const settings = createPanelOperationSettings();
  answer = { status: 403, body: { error: { code: "FORBIDDEN", message: "Only the session owner may change confirmation" } } };
  expect(await settings.read(sessionId)).toBeNull();
  await expect(settings.write(sessionId, false)).rejects.toMatchObject({ status: 403 });
  answer = { status: 500, body: { error: { code: "INTERNAL", message: "Broken" } } };
  await expect(settings.read(sessionId)).rejects.toMatchObject({ status: 500 });
});
