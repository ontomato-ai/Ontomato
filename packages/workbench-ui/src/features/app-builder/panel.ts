import type { Component } from "vue";
import { Eye, Files, GitCompare, History } from "lucide-vue-next";
import { buildTestSdkUpgradeDetailsSchema } from "@ontomato/contracts/build-tests";
import { ApiRequestError } from "../../utils/api";
import { errorPunctuation } from "../../utils/error-punctuation";
import { workbenchI18n } from "../../i18n";

/** The builder's one page beside the conversation: the open workspace, in four views. */
export const PANEL_ID = "workspace";

export type PanelTab = "preview" | "files" | "changes" | "history";

export const PANEL_TABS: readonly { id: PanelTab; label: string; icon: Component }[] = [
  { id: "preview", label: "appBuilder.tabPreview", icon: Eye },
  { id: "files", label: "appBuilder.tabFiles", icon: Files },
  { id: "changes", label: "appBuilder.tabChanges", icon: GitCompare },
  { id: "history", label: "appBuilder.tabHistory", icon: History },
];

/**
 * What the changes view shows: `latest` is the newest commit against its parent (it follows new commits), `working`
 * the current files against HEAD, anything else that one commit against its parent.
 */
export type ChangeTarget = string;

export const shortCommit = (id: string) => id.slice(0, 7);
/** A conversation is titled by its first message, whose later lines carry the page context. */
export const firstLine = (text: string) => text.split("\n", 1)[0]!;

/**
 * A version as the reader can take in: a development version's digest is hundreds of characters and says nothing past
 * its first few, so the line keeps the newest such version whole and shortens each digest to its ends.
 */
const SHORT_DIGEST = /^(.*?-dev\.)([0-9a-f]{16,})$/i;
export function shortVersion(version: string) {
  const match = SHORT_DIGEST.exec(version);
  return match ? `${match[1]}${match[2].slice(0, 7)}…${match[2].slice(-7)}` : version;
}

/**
 * The refusal to preview a workspace that references an older SDK, said in the platform's language: which SDK the
 * preview needs, which the workspace references, and the one way to close the gap — the agent changes the version the
 * page references, the platform never rewrites the app's source on its own.
 */
function sdkUpgradeText(error: ApiRequestError) {
  const details = buildTestSdkUpgradeDetailsSchema.safeParse(error.payload.details);
  if (!details.success) return error.message;
  const { requiredVersion, foundVersions } = details.data;
  const found = foundVersions.map(shortVersion).join(errorPunctuation().listSeparator);
  return workbenchI18n().global.t(found ? "appBuilder.previewSdkUpgrade" : "appBuilder.previewSdkNoReference", {
    required: shortVersion(requiredVersion),
    found,
  });
}

/**
 * An error as the interface says it. A refusal with a code this interface knows is said in the platform's language with
 * what the reader can act on; every other error keeps the service's message, which names what failed.
 */
export const errorText = (error: unknown) => {
  if (error instanceof ApiRequestError && error.code === "BUILD_TEST_SDK_UPGRADE_REQUIRED") return sdkUpgradeText(error);
  return error instanceof Error ? error.message : String(error);
};
