import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import * as objectViews from "@ontomato/contracts/object-views";
import { managerRoutes } from "../routes";
import { installObjectViewHost } from "./object-view-host";

let app: App;
afterEach(() => { app.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function settle() {
  for (let index = 0; index < 10; index++) {
    await vi.dynamicImportSettled();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function openEditor() {
  vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/skills") ? { skills: [] } : {
    success: true,
    data: url.endsWith("/edit") ? { revision: 0, publishedRevision: null, versions: [] }
      : url.endsWith("getMetas") ? { classDef: [{ className: "Order", attrs: [] }, { className: "Person", attrs: [] }] }
      : [],
  })));
  const errors: unknown[] = [];
  const router = createRouter({ history: createMemoryHistory(), routes: [
    ...managerRoutes(),
    { path: "/outside", component: { template: '<p class="outside">Outside the editor</p>' } },
    { path: "/another", component: { template: '<p class="another">Another page</p>' } },
  ] });
  const element = document.createElement("div"); document.body.append(element);
  app = createApp(defineComponent({ setup: () => () => h(RouterView) }));
  installObjectViewHost(app);
  app.config.errorHandler = error => { errors.push(error); };
  app.use(router);
  await router.push("/ontology/objects/Order/view");
  app.mount(element);
  await settle();
  return { router, errors };
}

it("can leave and reopen the editor after its initialization fails", async () => {
  const failure = new Error("Editor initialization failed");
  vi.spyOn(objectViews, "createObjectView").mockImplementationOnce(() => { throw failure; });
  const { router, errors } = await openEditor();
  expect(errors).toContain(failure);
  const initializationErrors = errors.length;

  await router.push("/outside");
  await settle();
  expect(router.currentRoute.value.path).toBe("/outside");
  expect(document.querySelector(".outside")?.textContent).toBe("Outside the editor");

  await router.push("/ontology/objects/Order/view");
  await settle();
  expect(document.querySelector(".view-builder")).not.toBeNull();
  expect(document.querySelector(".builder-body")?.hasAttribute("inert")).toBe(false);
  await router.push("/outside");
  await settle();
  expect(router.currentRoute.value.path).toBe("/outside");
  expect(errors).toHaveLength(initializationErrors);
});

it("confirms unsaved changes for updates and leaving, then removes the checks on unmount", async () => {
  const { router, errors } = await openEditor();
  function editTitle() {
    const input = document.querySelector<HTMLInputElement>(".layout-controls input")!;
    input.value = "Unsaved tab";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function decide(confirm: boolean) {
    await settle();
    await vi.waitFor(() => expect(document.querySelector(".manager-confirm .el-dialog__footer button")).not.toBeNull());
    const buttons = document.querySelectorAll<HTMLButtonElement>(".manager-confirm .el-dialog__footer button");
    buttons[confirm ? 1 : 0].click();
  }

  editTitle();
  const cancelledUpdate = router.push("/ontology/objects/Person/view");
  await decide(false);
  await cancelledUpdate;
  expect(router.currentRoute.value.path).toBe("/ontology/objects/Order/view");
  const acceptedUpdate = router.push("/ontology/objects/Person/view");
  await decide(true);
  await acceptedUpdate;
  await settle();
  expect(router.currentRoute.value.path).toBe("/ontology/objects/Person/view");

  editTitle();
  const cancelledLeave = router.push("/outside");
  await decide(false);
  await cancelledLeave;
  expect(router.currentRoute.value.path).toBe("/ontology/objects/Person/view");
  const acceptedLeave = router.push("/outside");
  await decide(true);
  await acceptedLeave;
  await settle();
  expect(document.querySelector(".view-builder")).toBeNull();
  await router.push("/another");
  await settle();
  expect(document.querySelector(".another")?.textContent).toBe("Another page");
  await router.push("/ontology/objects/Order/view");
  await settle();
  await router.push("/outside");
  await settle();
  expect(document.querySelector(".outside")?.textContent).toBe("Outside the editor");
  expect(errors).toEqual([]);
});
