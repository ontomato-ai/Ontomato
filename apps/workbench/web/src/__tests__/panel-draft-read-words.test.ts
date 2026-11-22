import { expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { draftRefusalText, unreadableDraft } from "../../../../../packages/apps-sdk/src/panel/draft-refusal";

/*
 * A draft the platform could not read (panelisation lead, 2026-11-22): the reader is told why in their own words, by the
 * platform's code — its run is gone, its file is not there, or they may not read it. A failure with no such code keeps
 * the platform's text, but beside the sentence, never as it; every one ends in the page opening without the draft.
 */

const { t } = createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }).global;
const translate = (key: string, params?: Readonly<Record<string, string>>) => t(key, params ?? {});
const FILE = "outputs/drafts/a.page-draft.json";
const answered = (code: string, message: string) => Object.assign(new Error(message), { payload: { error: { code, message } } });
const words = (failure: unknown) => draftRefusalText(unreadableDraft(FILE, failure), translate);

it("says a draft whose run is gone in words", () => {
  expect(words(answered("NOT_FOUND", "Run not found")))
    .toBe(`The draft ${FILE} cannot be used: the conversation that wrote this draft cannot be found. The page opens without it.`);
});

it("says a draft whose file is not there in words", () => {
  expect(words(answered("PAGE_DRAFT_NOT_FOUND", "Page draft not found")))
    .toBe(`The draft ${FILE} cannot be used because the linked run has no such file. The page opens without it.`);
});

it("tells the reader how to recover a draft found in a different run of this conversation", () => {
  const failure = answered("PAGE_DRAFT_NOT_FOUND", "Page draft not found");
  const payload = { ...failure.payload, details: { samePathInAnotherRun: true } };
  expect(words(Object.assign(failure, { payload })))
    .toBe(`The linked run has no draft ${FILE}. Another run in this conversation has the file. Ask the agent to send the link from that run. The page opens without the draft.`);
});

it("says a draft the reader may not read in words", () => {
  expect(words(answered("FORBIDDEN", "Forbidden")))
    .toBe(`The draft ${FILE} cannot be used: you are not allowed to read this draft. The page opens without it.`);
});

it("keeps the platform's own text beside the sentence when it gives no code the page knows", () => {
  expect(words(new Error("socket hang up")))
    .toBe(`The draft ${FILE} could not be read (socket hang up). The page opens without it.`);
  expect(words(answered("DEPENDENCY_UNAVAILABLE", "Runtime unavailable")))
    .toBe(`The draft ${FILE} could not be read (Runtime unavailable). The page opens without it.`);
});
