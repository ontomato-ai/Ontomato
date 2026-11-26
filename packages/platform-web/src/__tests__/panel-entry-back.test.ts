import { expect, it, vi } from "vitest";
import { createRouter, createWebHashHistory } from "vue-router";
import { createPanelBackController } from "@ontomato/platform-shell";

it("pops each pushed entry detail in order, restoring the previous entry's query", async () => {
  const origin = "/ontology/organization?tab=positions";
  const member = "/ontology/members/detail?tab=permissions&selected=member-1";
  const role = "/ontology/roles/detail?selected=role-1";
  window.history.replaceState(null, "", `/#${origin}`);
  const history = createWebHashHistory();
  const router = createRouter({
    history,
    routes: ["/ontology/organization", "/ontology/members/detail", "/ontology/roles/detail"].map(path => ({
      path, component: { render: () => null },
    })),
  });
  const controller = createPanelBackController({
    active: () => true,
    allowHistory: () => true,
    isDirty: () => false,
    confirmLeaveUnsaved: async () => true,
  });
  const navigate = vi.fn(async (address: string) => { await router.push(address); });
  try {
    await router.push(origin);
    await router.push(member);
    await router.push(role);
    const rolePosition = window.history.state.position;

    await controller.navigateBack("/ontology/roles", navigate);
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(member));
    expect(window.history.state.position).toBe(rolePosition - 1);

    await controller.navigateBack("/ontology/members", navigate);
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(origin));
    expect(window.history.state.position).toBe(rolePosition - 2);
    expect(navigate).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
    history.destroy();
  }
});
