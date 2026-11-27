import { expect, it } from "vitest";
import { inputLinkDescriptions, operationInputSuffix } from "../page-description-format";

it("keeps dynamic member input links without dumping fixed input configuration", () => {
  expect(inputLinkDescriptions({
    target: { state: "selectedOrg" },
    parentId: { state: "selectedOrg", field: "primaryKey" },
    currentCode: { output: { member: "form", name: "draft", path: "/function/code" } },
    fixed: { literal: "implementation-detail" },
  })).toEqual([
    "target←selectedOrg",
    "parentId←selectedOrg.primaryKey",
    "currentCode←form.draft[/function/code]",
  ]);
});

it("omits empty operation input objects and compacts nested schemas", () => {
  expect(operationInputSuffix({ type: "object", properties: {}, additionalProperties: false })).toBe("");
  expect(operationInputSuffix({
    type: "object",
    properties: {
      name: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      nested: { type: "object", properties: { child: { type: "object", properties: { leaf: { type: "string" } }, required: ["leaf"] } }, required: ["child"] },
    },
    required: ["name"],
  })).toBe(" Input {name:string,tags?:string[],nested?:{child:{leaf:string}}}.");
});
