import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../../utils/api";
import publicEn from "../../../locales/en";
import { errorText, shortVersion } from "../panel";

const text = publicEn.appBuilder;
const REQUIRED = "1.1.0-dev.ec0b94b079a7d4a44cde305d8456a8930acb947c7f0d41517ab0830106510c6d";

const upgrade = (details: unknown) =>
  new ApiRequestError("Upgrade the workspace SDK references before previewing", 409, { code: "BUILD_TEST_SDK_UPGRADE_REQUIRED", details });

const upgradeDetails = (foundVersions: string[]) => ({
  requiredVersion: REQUIRED,
  foundVersions,
  upgrade: {
    kind: "edit-workspace-references",
    currentCommand: "sdk current",
    readCommands: ["sdk read sdk.json"],
    steps: ["Read the current SDK version"],
  },
});

/*
 * A refusal the interface has a code for is said in the platform's language, with the versions the reader can act on:
 * the one the preview needs, the ones the workspace references, and the agent as the one who brings the page over.
 * A version's digest is hundreds of characters long, so the line shows its ends; another refusal keeps the service's
 * message, which names what failed.
 */
describe("an error as the builder says it", () => {
  it("says what to change when the workspace references an older SDK", () => {
    expect(errorText(upgrade(upgradeDetails(["1.0.0"])))).toBe(`${text.previewSdkUpgrade}`
      .replace("{found}", "1.0.0")
      .replace("{required}", "1.1.0-dev.ec0b94b…6510c6d"));
  });

  it("lists every version the workspace references", () => {
    expect(errorText(upgrade(upgradeDetails(["1.0.0", "1.0.1"])))).toContain("1.0.0;1.0.1");
  });

  it("says to reference the SDK at all when the workspace names none", () => {
    expect(errorText(upgrade(upgradeDetails([])))).toBe(text.previewSdkNoReference.replace("{required}", "1.1.0-dev.ec0b94b…6510c6d"));
  });

  it("keeps the service's message for every other error", () => {
    expect(errorText(new ApiRequestError("Preview expired", 404, { code: "NOT_FOUND" }))).toBe("Preview expired");
    expect(errorText(new Error("Network failed"))).toBe("Network failed");
  });
});

describe("a version as the line shows it", () => {
  it("shortens a development version's digest to its ends and keeps a released version whole", () => {
    expect(shortVersion(REQUIRED)).toBe("1.1.0-dev.ec0b94b…6510c6d");
    expect(shortVersion("1.1.0")).toBe("1.1.0");
  });
});
