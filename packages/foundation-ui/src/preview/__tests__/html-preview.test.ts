import { expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import HtmlPreview from "../HtmlPreview.vue";

it("registers the actual frame before supplying its executable same-origin document",async()=>{
  let source:object|undefined;
  const wrapper=mount(HtmlPreview,{attachTo:document.body,props:{html:'<script>window.ready=true</script>',sandbox:"allow-scripts allow-same-origin",
    registerFrame:window=>{
      const iframe=document.querySelector("iframe")!;
      expect(iframe.getAttribute("srcdoc")).toBeNull();expect(window).toBe(iframe.contentWindow);source=window;
      return ()=>{};
    }}});
  try {
    await flushPromises();const iframe=wrapper.get("iframe").element as HTMLIFrameElement;
    expect(source).toBeDefined();expect(iframe.srcdoc).toContain("window.ready=true");
    await wrapper.setProps({html:"<p>next document</p>"});expect(iframe.srcdoc).toBe("<p>next document</p>");
  } finally {wrapper.unmount();}
});
