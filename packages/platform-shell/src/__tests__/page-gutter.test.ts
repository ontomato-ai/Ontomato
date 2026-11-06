// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/*
 * The page gutter is written once (DESIGN.md "Page applications"): the shell's `platform-page-gutter` class gives the
 * content its side padding and the header takes its top from the same value. A page or a frame that wrote
 * `var(--page-gutter)` itself is how a second, drifting copy comes back (the 128 screenshots of 2026-11-06 found the
 * Ontology Manager's pages 12px off their titles), so no other tracked source may name it.
 */
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const OWNERS = [
  "packages/design-tokens/src/foundation.css",
  "packages/platform-shell/src/page.css",
  "packages/platform-shell/src/PlatformPageHeader.vue",
];

function sources(directory: string) {
  return execFileSync("git", ["ls-files", "-z", "--", directory], { cwd: repository, encoding: "utf8" })
    .split("\0")
    .filter((path) => /\.(css|vue|ts)$/.test(path) && !path.includes("/__tests__/"));
}

it("only the shell writes the page gutter", () => {
  const writers = [...sources("apps"), ...sources("packages")].filter(
    (path) => !OWNERS.includes(path) && readFileSync(join(repository, path), "utf8").includes("var(--page-gutter)"),
  );
  expect(writers).toEqual([]);
  expect(readFileSync(join(repository, "packages/platform-shell/src/page.css"), "utf8")).toContain(
    "padding-inline: var(--page-gutter)",
  );
});
