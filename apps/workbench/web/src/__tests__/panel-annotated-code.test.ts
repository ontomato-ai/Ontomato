import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { AnnotatedCode } from "@ontomato/contracts/annotated-code";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";

vi.mock("@ontomato/contracts/panel-projection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/contracts/panel-projection")>();
  return {
    ...actual,
    directReadDeclaration(
      projection: Parameters<typeof actual.directReadDeclaration>[0],
      data: Parameters<typeof actual.directReadDeclaration>[1],
    ) {
      if (data.read === "annotatedContent") {
        return { source: "object", parameterMode: "fixed", params: {}, result: "annotatedCode" } as const;
      }
      return actual.directReadDeclaration(projection, data);
    },
  };
});

import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

const base = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const sampleRef = { className: "Script", primaryKey: "script-1" };

const samplePayload: AnnotatedCode = {
  code: [
    "const rows = query(paramA);",
    "if (rows.length > 0) {",
    "  update(rows[0], paramB);",
    "}",
    "return rows.length;",
  ].join("\n"),
  segments: [
    {
      id: "seg-read",
      kind: "READ",
      kindLabel: "Read",
      title: "Query rows",
      lineRange: { start: 1, end: 1 },
      tone: "info",
      note: "Loads input rows",
      details: [
        {
          label: "Filter",
          parts: [
            { text: "id = " },
            { text: "paramA", refKey: "paramA" },
          ],
        },
      ],
    },
    {
      id: "seg-branch",
      kind: "BRANCH",
      kindLabel: "Branch",
      title: "Check non-empty",
      lineRange: { start: 2, end: 4 },
      tone: "warning",
      children: [
        {
          id: "seg-write",
          kind: "WRITE",
          kindLabel: "Write",
          title: "Update first row",
          lineRange: { start: 3, end: 3 },
          tone: "success",
          details: [
            {
              label: "Payload",
              parts: [
                { text: "value ← " },
                { text: "paramB", refKey: "paramB" },
              ],
            },
          ],
          children: [
            {
              id: "seg-write-inner",
              kind: "WRITE",
              kindLabel: "Write",
              title: "Assign target field",
              lineRange: { start: 3, end: 3 },
              note: "Innermost write step",
            },
          ],
        },
      ],
    },
    {
      id: "seg-return",
      kind: "CUSTOM_RETURN",
      kindLabel: "Return",
      title: "Return count",
      lineRange: { start: 5, end: 5 },
    },
  ],
  summary: [
    {
      title: "Operations",
      kind: "list",
      items: ["Reads matching rows", "Updates the first row when found"],
    },
    {
      title: "Side effects",
      kind: "text",
      text: "Mutates the first matching record in place.",
      tone: "warning",
    },
  ],
};

interface MountOptions {
  config?: Record<string, RuntimeJsonValue>;
  state?: Parameters<typeof definePanel>[0]["state"];
  initial?: Record<string, RuntimeJsonValue>;
  memberInputs?: Record<string, { state: string } | { literal: RuntimeJsonValue }>;
  memberOutputs?: Record<string, { state: string }>;
  messages?: Record<string, Record<string, string>>;
  onSelectRef?: (refKey: string) => void;
  onSelectSegment?: (segmentId: string | null) => void;
  answer: (request: PanelMemberReadRequest) => Promise<ProductPanelReadResponse> | ProductPanelReadResponse;
}

function mountAnnotatedCode(options: MountOptions) {
  const projection: DirectProjection = {
    ...base,
    id: "annotated-code-proj",
    name: "Annotated code",
    componentId: "@ontomato/sdk:AnnotatedCode",
    inputs: {
      target: { kind: "object", objectType: "Script" },
      ...(options.memberInputs?.currentCode ? { currentCode: { kind: "scalar", type: "string" } } : {}),
      ...(options.memberInputs?.activeSegmentId ? { activeSegmentId: { kind: "scalar", type: "string" } } : {}),
    },
    outputs: options.memberOutputs?.activeSegmentId ? { activeSegmentId: { kind: "scalar", type: "string" } } : {},
    config: options.config ?? {},
    data: {
      content: { source: { object: { input: "target" } }, read: "annotatedContent", params: {} },
    },
  };

  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(definePanel({
    state: options.state ?? {},
    members: {
      code: {
        target: { projectionId: projection.id },
        inputs: {
          target: { literal: sampleRef },
          ...(options.memberInputs ?? {}),
        },
        ...(options.memberOutputs ? { outputs: options.memberOutputs } : {}),
      },
    },
  }), {
    pageKey: "p",
    url: () => "/p",
    label: () => "P",
    initial: options.initial ?? {},
    text: createPanelText(options.messages ?? {}, ref("en"), "en"),
    ...noOperations,
    readProjection: async () => projection,
    read: async (request) => {
      reads.push(request);
      if (request.operations) return { status: "ready", value: {} as never };
      return await options.answer(request);
    },
  });

  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({
    render: () => h(PanelMember, {
      instance,
      member: "code",
      ...(options.onSelectRef ? { onSelectRef: options.onSelectRef } : {}),
      ...(options.onSelectSegment ? { onSelectSegment: options.onSelectSegment } : {}),
    }),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return {
    element,
    instance,
    reads: () => reads.filter((request) => request.dataName === "content"),
    unmount: () => app.unmount(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AnnotatedCode", () => {
  it("handles loading, error retry, forbidden, and empty states through DataState", async () => {
    let resolvePending!: (value: ProductPanelReadResponse) => void;
    let attempt = 0;
    const { element, instance, reads } = mountAnnotatedCode({
      answer: () => {
        attempt++;
        if (attempt === 1) {
          return new Promise<ProductPanelReadResponse>((resolve) => {
            resolvePending = resolve;
          });
        }
        return { status: "ready", value: samplePayload as never };
      },
    });

    await vi.waitFor(() => expect(element.querySelector(".sdk-annotated-code[data-status='loading']")).not.toBeNull());
    expect(element.querySelector(".sdk-annotated-code [aria-busy='true']")).not.toBeNull();
    expect(instance.outputs.code?.status).toBe("loading");

    resolvePending({ status: "error", message: "Backend temporarily unavailable" });
    await vi.waitFor(() => expect(element.querySelector("[role='alert']")?.textContent).toContain("Backend temporarily unavailable"));
    expect(instance.outputs.code?.status).toBe("error");

    const retryButton = element.querySelector<HTMLButtonElement>(".fui-data-state-error button");
    expect(retryButton).not.toBeNull();
    retryButton!.click();

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-annotated-code-line")).toHaveLength(5));
    expect(reads()).toHaveLength(2);
    expect(instance.outputs.code?.status).toBe("ready");

    // Forbidden state.
    const forbidden = mountAnnotatedCode({
      answer: () => ({ status: "forbidden", reason: "No read access" }),
    });
    await vi.waitFor(() => expect(forbidden.element.querySelector("[data-state='forbidden']")?.textContent).toContain("No read access"));
    expect(forbidden.instance.outputs.code?.status).toBe("forbidden");

    // Empty content (ready with neither code nor segments) uses configured emptyText key.
    const empty = mountAnnotatedCode({
      config: { emptyText: "customEmpty" },
      messages: { en: { customEmpty: "No explanation has been generated yet." } },
      answer: () => ({ status: "ready", value: { segments: [] } as never }),
    });
    await vi.waitFor(() => expect(empty.element.querySelector("[data-state='empty']")?.textContent).toContain("No explanation has been generated yet."));

    // Awaiting state when the required target object is not selected yet.
    const awaiting = mountAnnotatedCode({
      state: { targetObj: { type: { kind: "object", objectType: "Script" } } },
      memberInputs: { target: { state: "targetObj" } },
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });
    await vi.waitFor(() => expect(awaiting.element.querySelector("[data-state='awaiting']")).not.toBeNull());
    expect(awaiting.instance.outputs.code?.status).toBe("awaiting");
  });

  it("renders nested segments with deduplicated legend, bidirectional highlighting, and keyboard activation", async () => {
    const selectedSegments: Array<string | null> = [];
    const { element, instance } = mountAnnotatedCode({
      state: { activeSeg: { type: { kind: "scalar", type: "string" } } },
      memberInputs: { activeSegmentId: { state: "activeSeg" } },
      memberOutputs: { activeSegmentId: { state: "activeSeg" } },
      onSelectSegment: (id) => selectedSegments.push(id),
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-annotated-code-seg")).toHaveLength(5));

    // Deduplicated legend preserves first-appearance order (WRITE appears twice in segments, once in legend).
    const legendKinds = [...element.querySelectorAll(".sdk-annotated-code-legend-item")].map((el) => ({
      kind: el.getAttribute("data-kind"),
      label: el.textContent?.trim(),
      tone: el.getAttribute("data-tone"),
    }));
    expect(legendKinds).toEqual([
      { kind: "READ", label: "Read", tone: "info" },
      { kind: "BRANCH", label: "Branch", tone: "warning" },
      { kind: "WRITE", label: "Write", tone: "success" },
      { kind: "CUSTOM_RETURN", label: "Return", tone: expect.stringMatching(/^(info|success|warning|danger|neutral|accent)$/u) },
    ]);

    // Depths reflect recursive nesting.
    const depths = [...element.querySelectorAll(".sdk-annotated-code-seg")].map((el) => [
      el.getAttribute("data-segment-id"),
      el.getAttribute("data-depth"),
    ]);
    expect(depths).toEqual([
      ["seg-read", "0"],
      ["seg-branch", "0"],
      ["seg-write", "1"],
      ["seg-write-inner", "2"],
      ["seg-return", "0"],
    ]);

    // Clicking line 3 locates the innermost (deepest) segment covering line 3 (`seg-write-inner` over `seg-write` and `seg-branch`).
    element.querySelector<HTMLElement>("[data-line='3']")!.click();
    await vi.waitFor(() => expect(instance.outputs.code?.activeSegmentId).toBe("seg-write-inner"));
    expect(instance.state.values.value.activeSeg).toBe("seg-write-inner");
    expect(element.querySelector("[data-segment-id='seg-write-inner']")?.getAttribute("aria-current")).toBe("true");
    expect(element.querySelector("[data-line='3']")?.getAttribute("data-hit")).toBe("true");
    expect(element.querySelector("[data-line='2']")?.getAttribute("data-hit")).toBe("false");

    // Clicking a parent segment (`seg-branch`) highlights lines 2..4.
    element.querySelector<HTMLElement>("[data-segment-id='seg-branch']")!.click();
    await vi.waitFor(() => expect(instance.outputs.code?.activeSegmentId).toBe("seg-branch"));
    expect(element.querySelector("[data-line='1']")?.getAttribute("data-hit")).toBe("false");
    expect(element.querySelector("[data-line='2']")?.getAttribute("data-hit")).toBe("true");
    expect(element.querySelector("[data-line='3']")?.getAttribute("data-hit")).toBe("true");
    expect(element.querySelector("[data-line='4']")?.getAttribute("data-hit")).toBe("true");
    expect(element.querySelector("[data-line='5']")?.getAttribute("data-hit")).toBe("false");

    // Keyboard Enter and Space activate segment cards.
    const returnCard = element.querySelector<HTMLElement>("[data-segment-id='seg-return']")!;
    returnCard.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(instance.outputs.code?.activeSegmentId).toBe("seg-return"));
    expect(element.querySelector("[data-line='5']")?.getAttribute("data-hit")).toBe("true");

    const readCard = element.querySelector<HTMLElement>("[data-segment-id='seg-read']")!;
    readCard.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await vi.waitFor(() => expect(instance.outputs.code?.activeSegmentId).toBe("seg-read"));
    expect(element.querySelector("[data-line='1']")?.getAttribute("data-hit")).toBe("true");
    expect(selectedSegments).toEqual(["seg-write-inner", "seg-branch", "seg-return", "seg-read"]);
  });

  it("expands and collapses segment details and emits select-ref with selectedRef output on refKey click", async () => {
    const clickedRefs: string[] = [];
    const { element, instance } = mountAnnotatedCode({
      config: { refActionLabel: "Jump to parameter" },
      onSelectRef: (refKey) => clickedRefs.push(refKey),
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-annotated-code-seg")).toHaveLength(5));

    const writeCard = element.querySelector<HTMLElement>("[data-segment-id='seg-write']")!;
    const toggle = writeCard.querySelector<HTMLButtonElement>(".sdk-annotated-code-seg-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(writeCard.querySelector(".sdk-annotated-code-seg-details")).toBeNull();

    // Expand details.
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
    const details = writeCard.querySelector(".sdk-annotated-code-seg-details")!;
    expect(details.textContent).toContain("Payload");
    expect(details.textContent).toContain("value ← ");

    const refButton = details.querySelector<HTMLButtonElement>(".sdk-annotated-code-ref")!;
    expect(refButton.textContent?.trim()).toBe("paramB");
    expect(refButton.getAttribute("title")).toBe("Jump to parameter");
    refButton.click();

    await vi.waitFor(() => expect(instance.outputs.code?.selectedRef).toBe("paramB"));
    expect(clickedRefs).toEqual(["paramB"]);

    // Collapse details.
    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("false"));
    expect(writeCard.querySelector(".sdk-annotated-code-seg-details")).toBeNull();
  });

  it("shows stale warning badge and hint when currentCode differs from annotated code", async () => {
    const { element, instance } = mountAnnotatedCode({
      state: { draftCode: { type: { kind: "scalar", type: "string" } } },
      initial: { draftCode: samplePayload.code! },
      memberInputs: { currentCode: { state: "draftCode" } },
      config: {
        staleLabel: "Draft modified",
        staleHint: "Save the draft to refresh annotations.",
      },
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-annotated-code-line")).toHaveLength(5));
    expect(element.querySelector(".sdk-annotated-code-stale-badge")).toBeNull();
    expect(element.querySelector(".sdk-annotated-code-stale-hint")).toBeNull();

    // Mutate currentCode so it differs from data.code.
    instance.state.set("draftCode", `${samplePayload.code}\n// edited`);
    await vi.waitFor(() => expect(element.querySelector(".sdk-annotated-code-stale-badge")?.textContent?.trim()).toBe("Draft modified"));
    expect(element.querySelector(".sdk-annotated-code-stale-hint")?.textContent?.trim()).toBe("Save the draft to refresh annotations.");

    // Restoring exact equality clears the stale warning.
    instance.state.set("draftCode", samplePayload.code!);
    await vi.waitFor(() => expect(element.querySelector(".sdk-annotated-code-stale-badge")).toBeNull());
  });

  it("renders summary list and warning blocks and respects emptySummaryText", async () => {
    const { element } = mountAnnotatedCode({
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-annotated-code-summary-block")).toHaveLength(2));
    const blocks = [...element.querySelectorAll(".sdk-annotated-code-summary-block")];
    expect(blocks[0]!.getAttribute("data-tone")).toBe("default");
    expect([...blocks[0]!.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Reads matching rows",
      "Updates the first row when found",
    ]);
    expect(blocks[1]!.getAttribute("data-tone")).toBe("warning");
    expect(blocks[1]!.querySelector(".sdk-annotated-code-summary-text")?.textContent).toBe(
      "Mutates the first matching record in place.",
    );

    // Without summary and without emptySummaryText, no empty summary block is rendered.
    const noSummary = mountAnnotatedCode({
      answer: () => ({
        status: "ready",
        value: { code: "x = 1", segments: [samplePayload.segments[0]!] } as never,
      }),
    });
    await vi.waitFor(() => expect(noSummary.element.querySelectorAll(".sdk-annotated-code-line")).toHaveLength(1));
    expect(noSummary.element.querySelector(".sdk-annotated-code-summary")).toBeNull();

    // With emptySummaryText configured, shows the hint when summary is absent.
    const withEmptySummary = mountAnnotatedCode({
      config: { emptySummaryText: "No summary provided yet." },
      answer: () => ({
        status: "ready",
        value: { code: "x = 1", segments: [samplePayload.segments[0]!] } as never,
      }),
    });
    await vi.waitFor(() =>
      expect(withEmptySummary.element.querySelector(".sdk-annotated-code-summary-empty")?.textContent?.trim()).toBe(
        "No summary provided yet.",
      ),
    );
  });

  it("clears highlight and read-only output when bound activeSegmentId is externally cleared to null or empty", async () => {
    const { element, instance } = mountAnnotatedCode({
      state: { activeSeg: { type: { kind: "scalar", type: "string" } } },
      memberInputs: { activeSegmentId: { state: "activeSeg" } },
      memberOutputs: { activeSegmentId: { state: "activeSeg" } },
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-annotated-code-seg")).toHaveLength(5));

    // Click a segment to activate it via the component.
    element.querySelector<HTMLElement>("[data-segment-id='seg-branch']")!.click();
    await vi.waitFor(() => expect(instance.outputs.code?.activeSegmentId).toBe("seg-branch"));
    expect(element.querySelector("[data-segment-id='seg-branch']")?.getAttribute("aria-current")).toBe("true");
    expect(element.querySelector("[data-line='2']")?.getAttribute("data-hit")).toBe("true");

    // External state cleared to null must clear highlight and read-only output without falling back to a local copy.
    instance.state.set("activeSeg", null);
    await vi.waitFor(() => expect(instance.outputs.code?.activeSegmentId).toBeNull());
    expect(element.querySelector("[aria-current='true']")).toBeNull();
    expect(element.querySelector("[data-line][data-hit='true']")).toBeNull();

    // Activate again via line click, then externally clear to empty string.
    element.querySelector<HTMLElement>("[data-line='1']")!.click();
    await vi.waitFor(() => expect(instance.outputs.code?.activeSegmentId).toBe("seg-read"));
    expect(element.querySelector("[data-line='1']")?.getAttribute("data-hit")).toBe("true");

    instance.state.set("activeSeg", "");
    await vi.waitFor(() => expect(instance.outputs.code?.activeSegmentId).toBeNull());
    expect(element.querySelector("[aria-current='true']")).toBeNull();
    expect(element.querySelector("[data-line][data-hit='true']")).toBeNull();
  });

  it("supports unbound local segment selection and respects fixed literal activeSegmentId without stale fallback", async () => {
    // Unbound: clicking lines and segments works via member's own param store.
    const unbound = mountAnnotatedCode({
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });
    await vi.waitFor(() => expect(unbound.element.querySelectorAll(".sdk-annotated-code-seg")).toHaveLength(5));

    unbound.element.querySelector<HTMLElement>("[data-line='5']")!.click();
    await vi.waitFor(() => expect(unbound.instance.outputs.code?.activeSegmentId).toBe("seg-return"));
    expect(unbound.element.querySelector("[data-segment-id='seg-return']")?.getAttribute("aria-current")).toBe("true");
    expect(unbound.element.querySelector("[data-line='5']")?.getAttribute("data-hit")).toBe("true");

    // Fixed literal input: clicking another segment neither overwrites the literal nor creates a stale fallback.
    const fixed = mountAnnotatedCode({
      memberInputs: { activeSegmentId: { literal: "seg-read" } },
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });
    await vi.waitFor(() => expect(fixed.element.querySelectorAll(".sdk-annotated-code-seg")).toHaveLength(5));
    expect(fixed.instance.outputs.code?.activeSegmentId).toBe("seg-read");

    fixed.element.querySelector<HTMLElement>("[data-segment-id='seg-return']")!.click();
    await vi.waitFor(() => expect(fixed.instance.outputs.code?.activeSegmentId).toBe("seg-read"));
    expect(fixed.element.querySelector("[data-segment-id='seg-read']")?.getAttribute("aria-current")).toBe("true");
    expect(fixed.element.querySelector("[data-segment-id='seg-return']")?.getAttribute("aria-current")).toBeNull();
  });

  it("auto-scrolls both codeBox and segmentsBox on external activeSegmentId changes without breaking single-pane manual clicks", async () => {
    const { element, instance } = mountAnnotatedCode({
      state: { activeSeg: { type: { kind: "scalar", type: "string" } } },
      memberInputs: { activeSegmentId: { state: "activeSeg" } },
      memberOutputs: { activeSegmentId: { state: "activeSeg" } },
      answer: () => ({ status: "ready", value: samplePayload as never }),
    });

    await vi.waitFor(() => expect(element.querySelectorAll(".sdk-annotated-code-seg")).toHaveLength(5));

    const codeBox = element.querySelector<HTMLElement>(".sdk-annotated-code-lines")!;
    const segmentsBox = element.querySelector<HTMLElement>(".sdk-annotated-code-segments")!;
    const line5 = element.querySelector<HTMLElement>("[data-line='5']")!;
    const line2 = element.querySelector<HTMLElement>("[data-line='2']")!;
    const segReturn = element.querySelector<HTMLElement>("[data-segment-id='seg-return']")!;
    const segBranch = element.querySelector<HTMLElement>("[data-segment-id='seg-branch']")!;

    const makeRect = (top: number, height: number): DOMRect =>
      ({ top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

    Object.defineProperty(codeBox, "clientHeight", { value: 120, configurable: true });
    Object.defineProperty(segmentsBox, "clientHeight", { value: 150, configurable: true });
    codeBox.getBoundingClientRect = () => makeRect(0, 120);
    segmentsBox.getBoundingClientRect = () => makeRect(0, 150);
    line5.getBoundingClientRect = () => makeRect(240, 20);
    line2.getBoundingClientRect = () => makeRect(100, 20);
    segReturn.getBoundingClientRect = () => makeRect(300, 40);
    segBranch.getBoundingClientRect = () => makeRect(180, 40);

    // 1. External change to activeSeg scrolls BOTH codeBox (to line 5) and segmentsBox (to seg-return).
    codeBox.scrollTop = 0;
    segmentsBox.scrollTop = 0;
    instance.state.set("activeSeg", "seg-return");

    await vi.waitFor(() => {
      // targetRect.top (240) - boxRect.top (0) - clientHeight/3 (40) = 200
      expect(codeBox.scrollTop).toBe(200);
      // targetRect.top (300) - boxRect.top (0) - clientHeight/3 (50) = 250
      expect(segmentsBox.scrollTop).toBe(250);
    });

    // 2. Manual segment card click scrolls ONLY codeBox (segmentsBox remains where user clicked).
    codeBox.scrollTop = 0;
    segmentsBox.scrollTop = 42;
    segBranch.click();
    await vi.waitFor(() => {
      expect(instance.outputs.code?.activeSegmentId).toBe("seg-branch");
      // line2: 100 - 0 - 40 = 60
      expect(codeBox.scrollTop).toBe(60);
    });
    expect(segmentsBox.scrollTop).toBe(42);

    // 3. Manual code line click scrolls ONLY segmentsBox (codeBox remains where user clicked).
    codeBox.scrollTop = 77;
    segmentsBox.scrollTop = 0;
    line5.click();
    await vi.waitFor(() => {
      expect(instance.outputs.code?.activeSegmentId).toBe("seg-return");
      // segReturn: 300 - 0 - 50 = 250
      expect(segmentsBox.scrollTop).toBe(250);
    });
    expect(codeBox.scrollTop).toBe(77);
  });

  it("auto-scrolls both panes once content loads when activeSegmentId is pre-set externally", async () => {
    let resolveContent!: (value: ProductPanelReadResponse) => void;
    const scrollIntoViewCalls: string[] = [];
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoViewSpy() {
      const line = this.getAttribute("data-line");
      const seg = this.getAttribute("data-segment-id");
      if (line) scrollIntoViewCalls.push(`line:${line}`);
      if (seg) scrollIntoViewCalls.push(`seg:${seg}`);
    };

    try {
      const { element, instance } = mountAnnotatedCode({
        state: { activeSeg: { type: { kind: "scalar", type: "string" } } },
        initial: { activeSeg: "seg-return" },
        memberInputs: { activeSegmentId: { state: "activeSeg" } },
        memberOutputs: { activeSegmentId: { state: "activeSeg" } },
        answer: () =>
          new Promise<ProductPanelReadResponse>((resolve) => {
            resolveContent = resolve;
          }),
      });

      await vi.waitFor(() => expect(element.querySelector(".sdk-annotated-code[data-status='loading']")).not.toBeNull());
      expect(scrollIntoViewCalls).toEqual([]);

      resolveContent({ status: "ready", value: samplePayload as never });

      await vi.waitFor(() => {
        expect(instance.outputs.code?.activeSegmentId).toBe("seg-return");
        expect(scrollIntoViewCalls).toEqual(["line:5", "seg:seg-return"]);
      });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
