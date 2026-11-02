import { afterEach, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import SourceCodeEditor from "../components/SourceCodeEditor.vue";
import { provideManagerContext, type ManagerHostContext } from "../context";
import { englishMessages } from "../i18n";

let app: App;
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; });

it("highlights Python safely and preserves edits when returning to preview", async () => {
  const code = ref('def run():\n    return "<script>alert(1)</script>"');
  const root = document.createElement("div"); document.body.append(root);
  app = createApp({ setup() {
    provideManagerContext({ messages: englishMessages } as ManagerHostContext, () => {});
    return () => h(SourceCodeEditor, { modelValue: code.value, "onUpdate:modelValue": value => { code.value = value; } });
  } });
  app.mount(root);
  expect(root.querySelector(".hljs-keyword")?.textContent).toBe("def");
  expect(root.querySelector("code")?.textContent).toBe(code.value + "\n");
  expect(root.querySelector("script")).toBeNull();
  expect(root.querySelector("textarea")).toBeNull();
  root.querySelectorAll("button")[1].click(); await nextTick();
  const input = root.querySelector("textarea")!;
  expect(root.querySelector(".hljs-keyword")?.textContent).toBe("def");
  input.value = "return 42\n";
  input.dispatchEvent(new Event("input", { bubbles: true })); await nextTick();
  expect(root.querySelector(".hljs-number")?.textContent).toBe("42");
  input.scrollTop = 80; input.scrollLeft = 40; input.dispatchEvent(new Event("scroll"));
  expect(root.querySelector("pre")?.scrollTop).toBe(80);
  expect(root.querySelector("pre")?.scrollLeft).toBe(40);
  root.querySelector("button")!.click(); await nextTick();
  expect(code.value).toBe("return 42\n");
  expect(root.querySelector("code")?.textContent).toBe(code.value + "\n");
  expect(root.querySelector(".hljs-number")?.textContent).toBe("42");
});
