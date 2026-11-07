import { beforeEach, describe, expect, it } from "vitest";
import { serviceHome } from "../view";

function home(url: string, initialRoute = "") {
  window.history.replaceState({}, "", url);
  return serviceHome(initialRoute);
}

describe("where the root address lands", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"));

  it("the main system's old view parameter maps to data browsing, smart assets and knowledge", () => {
    expect(home("/?view=data-browser")).toBe("/data");
    expect(home("/?view=assets")).toBe("/assets/metrics");
    expect(home("/?view=knowledge")).toBe("/knowledge");
  });

  it("view=visual-modeling maps to the modeling page; focus/id/back enter its query as-is and other parameters are dropped", () => {
    expect(home("/?view=visual-modeling&theme=dark")).toBe("/visual-modeling");
    expect(home("/?view=visual-modeling&focus=relation&id=placedBy&back=playground&keep=1")).toBe(
      "/visual-modeling?focus=relation&id=placedBy&back=playground"
    );
  });

  it("next comes the deployment's initial route normalized to a path, and finally the agent platform", () => {
    expect(home("/?view=other", "#objects/A")).toBe("/objects/A");
    expect(home("/", " /data ")).toBe("/data");
    expect(home("/")).toBe("/agents/chat");
  });
});
