import { watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { appAt, type PlatformAppDeclaration } from "./apps";
import { HOME_APPLICATION_ID, recordApplicationOpened } from "./features/home";

/**
 * The platform's one entry for opening an application, and the record of when each was last opened.
 *
 * The rail, the home's cards and a page that leads to an application (the app builder, for what it published) all open
 * through `open`, so an application opens the same way wherever it is chosen. An application of the platform's own is
 * recorded when its address is reached rather than when it is chosen: a deep link, a reload and a link from another
 * application count too, and moving between the pages of one application does not count again. An external
 * application has no address here, so the click that opens it is what is recorded. The home itself is never recorded.
 *
 * A failed record does not stop the application from opening; its error is shown like any other request's.
 */
export function useApplicationOpening(declarations: Readonly<Ref<readonly PlatformAppDeclaration[]>>) {
  const route = useRoute();
  const router = useRouter();

  function record(id: string) {
    if (id === HOME_APPLICATION_ID) return;
    recordApplicationOpened(id).catch((error) => ElMessage.error(error instanceof Error ? error.message : String(error)));
  }

  /** The application whose address the reader is in: which application they last entered, not an event log. */
  let entered: string | null = null;
  watch(
    [() => route.path, declarations],
    ([path, list]) => {
      const id = appAt(list, path)?.id ?? null;
      if (id === entered) return;
      entered = id;
      if (id) record(id);
    },
    { immediate: true },
  );

  return function open(id: string) {
    const app = declarations.value.find((candidate) => candidate.id === id);
    if (!app) return;
    if (app.open) {
      app.open();
      record(id);
    } else if (app.href) {
      window.open(app.href, "_blank", "noopener,noreferrer");
      record(id);
    } else if (app.home) {
      void router.push(app.home);
    }
  };
}
