import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { parseCsv } from "@ontomato/foundation-ui/preview";
import { workbenchI18n } from "../../../../i18n";
import { diagnosisActionKey } from "../../ops-host";
import ArtifactDetail from "../ArtifactDetail.vue";

const files: Record<string, string> = {
  "rows.tsv": 'name\tnote\n  Alice \t"tab\there\nand a second line"\n',
  "prompt.md": "# Prompt\n\nUse **only** the data.",
};
vi.mock("../../api", () => ({
  diagnosisApi: {
    getArtifactManifest: async () => ({ evidence: null }),
    getArtifactTree: async () => Object.keys(files).map((name) => ({ name, path: name, type: "file" })),
    getArtifactFile: async (_prefix: string, path: string) => ({ content: files[path], size: 0, loadedBytes: 0, truncated: false }),
  },
}));

afterEach(() => {
  document.body.innerHTML = "";
});

async function open(name: string) {
  const wrapper = mount(ArtifactDetail, {
    props: { apiPrefix: "/evidence" },
    // No diagnosis can be started from here.
    global: { plugins: [workbenchI18n(), ElementPlus], provide: { [diagnosisActionKey]: undefined } },
    attachTo: document.body,
  });
  await flushPromises();
  await wrapper.findAll(".el-tree-node__content").find((node) => node.text() === name)!.trigger("click");
  await flushPromises();
  return wrapper;
}

// Evidence is read as written. A CSV or TSV shows in the shared table with the cells every page reads from that file;
// anything else shows as its source in the code editor, never rendered.
it("shows a TSV in the shared table, cell for cell as the shared parser reads it", async () => {
  const wrapper = await open("rows.tsv");
  const cells = wrapper.findAll(".el-table__body td .cell").map((cell) => cell.element.textContent);
  expect(cells).toEqual(parseCsv(files["rows.tsv"]!, "\t").rows.flat());
  wrapper.unmount();
});

it("shows Markdown evidence as its source", async () => {
  const wrapper = await open("prompt.md");
  expect(wrapper.find(".cm-content").text()).toContain("**only**");
  expect(wrapper.find("h1").exists()).toBe(false);
  wrapper.unmount();
});
