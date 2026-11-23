import { describe, expect, it } from "vitest";
import type { DomainComponentInput } from "@ontomato/contracts/domain-components";
import { HttpError } from "../../../utils/errors";
import { checkDomainComponentSource } from "../catalog";

function componentInput(module: string): DomainComponentInput {
  return {
    name: "OrderBadge",
    visibility: "domain",
    declaration: {
      componentId: "domain-component:00000000-0000-0000-0000-000000000001",
      role: "presentation",
      meaning: "Shows order status",
      data: {},
      config: [],
      inputs: {},
      outputs: {},
      operations: [],
      ports: { props: [], events: [], slots: [] },
    },
    source: {
      template: "<sdk-button>{{ label }}</sdk-button>",
      module,
    },
  };
}

describe("checkDomainComponentSource", () => {
  it("allows @ontomato/sdk/ui, @ontomato/sdk/chart, and vue imports with a default export", async () => {
    const source = [
      'import { computed } from "vue";',
      'import { SdkButton } from "@ontomato/sdk/ui";',
      'import { EChart } from "@ontomato/sdk/chart";',
      'export default { components: { SdkButton, EChart }, setup() { return { label: computed(() => "ok") }; } };',
    ].join("\n");

    await expect(checkDomainComponentSource(componentInput(source))).resolves.toBeUndefined();
  });

  it("rejects illegal third-party package imports including element-plus, lodash, and bare echarts", async () => {
    await expect(checkDomainComponentSource(componentInput(
      'import { ElButton } from "element-plus"; export default { components: { ElButton } };',
    ))).rejects.toThrow(HttpError);

    await expect(checkDomainComponentSource(componentInput(
      'import { ElButton } from "element-plus"; export default { components: { ElButton } };',
    ))).rejects.toThrow(/@ontomato\/sdk\/ui/u);

    await expect(checkDomainComponentSource(componentInput(
      'import { chunk } from "lodash"; export default { setup() { return { chunk }; } };',
    ))).rejects.toThrow(/outside the official SDK entries/u);

    await expect(checkDomainComponentSource(componentInput(
      'import * as echarts from "echarts"; export default { setup() { return { echarts }; } };',
    ))).rejects.toThrow(/@ontomato\/sdk\/chart/u);
  });

  it("rejects direct business API calls and hardcoded /api/ paths with projection/operation guidance", async () => {
    const cases = [
      'export default { async setup() { await fetch("https://example.com/x"); return {}; } };',
      'export default { setup() { const xhr = new XMLHttpRequest(); return { xhr }; } };',
      'export default { setup() { const es = new EventSource("https://example.com/s"); return { es }; } };',
      'export default { setup() { const ws = new WebSocket("wss://example.com/w"); return { ws }; } };',
      'export default { setup() { const endpoint = "/api/orders"; return { endpoint }; } };',
      "export default { setup() { const endpoint = '/api/orders'; return { endpoint }; } };",
      'export default { setup() { const endpoint = `/api/orders/${1}`; return { endpoint }; } };',
    ];

    for (const source of cases) {
      await expect(checkDomainComponentSource(componentInput(source)))
        .rejects.toThrow(/declared projection.*registered operation/u);
    }
  });

  it("allows comments and safe identifiers that resemble network API names", async () => {
    const source = [
      '// Do not call fetch("/api/orders") or new XMLHttpRequest() here',
      '/* EventSource / WebSocket / "/api/internal" in block comment */',
      'import { SdkTag } from "@ontomato/sdk/ui";',
      'const prefetchData = true;',
      'const fetchCount = 2;',
      'const label = "fetch status from projection";',
      'export default { components: { SdkTag }, setup() { return { prefetchData, fetchCount, label }; } };',
    ].join("\n");

    await expect(checkDomainComponentSource(componentInput(source))).resolves.toBeUndefined();
  });
});
