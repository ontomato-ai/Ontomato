import { describe, expect, it, vi } from "vitest";
import { APP_HOST_GLOBAL, type AppHost, type AppHostPreferences } from "@ontomato/contracts/app-host";
import { ossBrand } from "@ontomato/design-tokens/oss";
import { chartTheme } from "@ontomato/foundation-ui/chart";
import { createAppContext } from "../../../../../packages/apps-sdk/src/context";

const inMode = (mode: "light" | "dark") => ({ color: ossBrand.dataviz[mode], textStyle: { color: ossBrand[mode].ink } });

// Apps draw their charts in `context.chartTheme`: the platform's one chart theme, in this product's SDK with the brand's
// chart colours and ink of the theme the platform shows, and a switch of the platform's theme reaches it.
describe("the apps SDK's chart theme", () => {
  it("is the platform's chart theme and follows the platform between its light and dark themes", async () => {
    let follow!: (preferences: AppHostPreferences) => void;
    const host: AppHost = {
      snapshot: () => ({ locale: "en", theme: "light", apiBase: "/api", user: null }),
      executionContext: () => ({kind:"live"}),
      subscribeExecutionContext: () => () => {},
      credential: () => ({ type: "anonymous" }),
      subscribePreferences: (listener) => {
        follow = listener;
        return () => {};
      },
      navigate: () => {},
      onAuthFailure: () => {},
      setPageContext: () => {},
      subscribeFrameInsets: () => () => {},
    };
    Object.assign(window, { [APP_HOST_GLOBAL]: host });
    const context = createAppContext();

    expect(context.chartTheme.value).toEqual(chartTheme());
    expect(context.chartTheme.value).toMatchObject(inMode("light"));
    follow({ locale: "en", theme: "dark" });
    await vi.waitFor(() => expect(context.chartTheme.value).toMatchObject(inMode("dark")));
    expect(context.chartTheme.value).toEqual(chartTheme());
  });
});
