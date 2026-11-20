import { vi } from "vitest";

/*
 * A panel's HTML is cleaned by DOMPurify as it is drawn (`panel-content.ts`). On happy-dom, the tests' document,
 * DOMPurify does not clean as a browser does: it drops the first element and keeps inline event handlers. The tests
 * therefore give the real DOMPurify a standards DOM (jsdom, the one DOMPurify is itself tested on), so a panel's HTML
 * reaches the parser and the page as a browser would leave it.
 */
vi.mock("dompurify", async importOriginal => {
  const { JSDOM } = await import("jsdom");
  const { default: createDOMPurify } = await importOriginal<typeof import("dompurify")>();
  return { default: createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis) };
});
