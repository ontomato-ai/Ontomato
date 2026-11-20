import type { AppsSdkReleaseManifest } from "@ontomato/contracts/apps-sdk";
import { BUILD_TEST_SAMPLE_DIRECTORY } from "@ontomato/contracts/build-tests";
import type { WorkspaceExport } from "@ontomato/contracts/workspaces";
import { HttpError } from "../../utils/errors";

type HostedSdk = {
  sdkBasePath: string;
  manifest: Pick<AppsSdkReleaseManifest, "entries" | "stylesheet" | "hostTransport" | "messageBridge">;
};

export const HOSTED_SDK_MARKER = "<!-- ontomato:apps-sdk -->";
export const SDK_ASSET_PATH = /\/apps-sdk\/([a-zA-Z0-9._-]+)\//g;
const sdkHeader = /<!-- ontomato:apps-sdk -->\n<link rel="stylesheet" href="([^"\n]+)">\n<script type="importmap">([^<\n]+)<\/script>/;
const authoredImportMap = /<script\b[^>]*\btype\s*=\s*(?:"importmap"|'importmap'|importmap\b)/i;
const moduleScript = /<script\b[^>]*\btype\s*=\s*(?:"module"|'module'|module\b)/i;

export function hostedReleaseFiles(files: WorkspaceExport["files"]) {
  return files.filter(({ path }) => path !== BUILD_TEST_SAMPLE_DIRECTORY && !path.startsWith(`${BUILD_TEST_SAMPLE_DIRECTORY}/`)
    && !["ontomato.product-review.json", ".ontomato-network-policy.json", ".ontomato-source-function.json"].includes(path));
}

function sdkUpgrade(message: string) {
  return new HttpError(409, message, "PRODUCT_SDK_UPGRADE_REQUIRED");
}

function importsFor({ sdkBasePath, manifest }: HostedSdk) {
  return Object.fromEntries(Object.entries(manifest.entries).map(([name, file]) => [name, `${sdkBasePath}/${file}`]));
}

export function injectHostedSdkHtml(source: string, sdk: HostedSdk, file = "index.html"): string {
  const head = source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i);
  const marker = source.indexOf(HOSTED_SDK_MARKER);
  if (!head || marker < head.index! || marker >= head.index! + head[0].length
    || marker !== source.lastIndexOf(HOSTED_SDK_MARKER) || moduleScript.test(source.slice(0, marker))) {
    throw sdkUpgrade(`Place one ${HOSTED_SDK_MARKER} in the head before module scripts in ${file}`);
  }
  if (source.match(SDK_ASSET_PATH) || authoredImportMap.test(source)) {
    throw sdkUpgrade(`Remove handwritten SDK URLs and import maps from ${file}`);
  }
  const imports = JSON.stringify({ imports: importsFor(sdk) }).replaceAll("<", "\\u003c");
  const stylesheet = `${sdk.sdkBasePath}/${sdk.manifest.stylesheet}`;
  return source.replace(HOSTED_SDK_MARKER, () => `${HOSTED_SDK_MARKER}\n<link rel="stylesheet" href="${stylesheet}">\n<script type="importmap">${imports}</script>`);
}

export function requireHostedSdkTransport(files: WorkspaceExport["files"], sdk: HostedSdk): void {
  if (sdk.manifest.hostTransport !== 1 || sdk.manifest.messageBridge !== 2) {
    throw sdkUpgrade("Use the sandbox message bridge before publishing");
  }
  if (!files.some(file => /\.html$/i.test(file.path))) throw sdkUpgrade("Publish an application HTML document using the current SDK");
  const expectedImports = importsFor(sdk);
  const expectedStylesheet = `${sdk.sdkBasePath}/${sdk.manifest.stylesheet}`;
  for (const file of files) {
    if (!/\.(?:html|[cm]?js|tsx?|vue|css)$/i.test(file.path)) continue;
    let source = Buffer.from(file.content, file.encoding).toString("utf8");
    if (/\.html$/i.test(file.path)) {
      const match = source.match(sdkHeader);
      if (!match || match[1] !== expectedStylesheet) throw sdkUpgrade(`Use the current SDK stylesheet and import map in ${file.path}`);
      const imports = Object.entries(JSON.parse(match[2]!).imports);
      if (!imports.length || !imports.every(([name, url]) => Object.hasOwn(expectedImports, name) && expectedImports[name] === url)) {
        throw sdkUpgrade(`Use the current SDK entry paths in ${file.path}`);
      }
      source = source.replace(match[0], "");
    }
    if (source.match(SDK_ASSET_PATH)) throw sdkUpgrade(`Import the SDK by public module name in ${file.path}`);
  }
}
