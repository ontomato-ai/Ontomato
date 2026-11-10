import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "element-plus/es/locale/lang/en";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { catalogFixture } from "./fixtures";
import { useApplicationCatalog } from "../catalog";

/*
 * What the rail keeps while the platform reads its applications again (after a publication, a rollback, another
 * navigation): the list it shows, until the new list replaces it whole; and when that read fails, the list with the error.
 * A rail that empties and fills up again on every read flickers.
 */
installAuthHost({
  getToken: () => null,
  getApiKey: () => null,
  responseStatusError: () => null,
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
});
installWorkbenchI18n({
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en: publicEn },
  elementLocale: () => en,
});

/** Each read of the catalog waits here until the test answers it. */
let pending: ((response: Response) => void)[] = [];
const answer = (body: unknown) =>
  pending.shift()!(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

beforeEach(() => {
  pending = [];
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => pending.push(resolve)));
});

async function readOnce(data: unknown) {
  const catalog = useApplicationCatalog();
  const read = catalog.refresh();
  answer({ success: true, data });
  await read;
  return catalog;
}

describe("the application catalog", () => {
  it("keeps the list it shows while it reads the applications again", async () => {
    const shown = catalogFixture();
    const catalog = await readOnce(shown);

    const read = catalog.refresh();
    expect(catalog.loading.value).toBe(true);
    expect(catalog.applications.value).toEqual(shown);

    const next = shown.slice(1);
    answer({ success: true, data: next });
    await read;
    expect(catalog.applications.value).toEqual(next);
    expect(catalog.loading.value).toBe(false);
  });

  it("reports a read that fails and keeps the list there was", async () => {
    const shown = catalogFixture();
    const catalog = await readOnce(shown);

    const read = catalog.refresh();
    answer({ success: false, message: "Catalog unavailable" });
    await read;
    expect(catalog.error.value).toBe("Catalog unavailable");
    expect(catalog.applications.value).toEqual(shown);
  });
});
