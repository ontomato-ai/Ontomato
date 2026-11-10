import { describe, expect, it } from "vitest";
import { APP_HOST_GLOBAL, type AppHost, type AppHostPreferences } from "@ontomato/contracts/app-host";
import { ossBrand } from "@ontomato/design-tokens/oss";
import { createAppContext } from "../../../../../packages/apps-sdk/src/context";

// Apps draw their charts in `context.chartTheme`, the platform's chart theme: in this product's SDK it holds the brand's
// chart colours and ink of the theme the platform shows, and a switch of the platform's theme reaches it.
describe("the apps SDK's chart theme", () => {
  it("follows the platform between its light and dark themes", () => {
    let follow!: (preferences: AppHostPreferences) => void;
    const host: AppHost = {
      snapshot: () => ({ locale: "en", theme: "light", apiBase: "/api", user: null }),
      credential: () => ({ type: "anonymous" }),
      subscribePreferences: (listener) => {
        follow = listener;
        return () => {};
      },
      navigate: () => {},
      onAuthFailure: () => {},
      setPageContext: () => {},
    };
    Object.assign(window, { [APP_HOST_GLOBAL]: host });
    const { chartTheme } = createAppContext();

    expect(chartTheme.value).toMatchObject({ color: ossBrand.dataviz.light, textStyle: { color: ossBrand.light.ink } });
    follow({ locale: "en", theme: "dark" });
    expect(chartTheme.value).toMatchObject({ color: ossBrand.dataviz.dark, textStyle: { color: ossBrand.dark.ink } });
  });
});
