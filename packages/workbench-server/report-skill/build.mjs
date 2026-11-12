// Rebuild the committed runtime package from its single source before publishing a source change.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const output = path.resolve(directory, "../resources/runtime-skills/assistant-report");
for (const name of ["scripts", "vendor", "licenses"]) {
  fs.rmSync(path.join(output, name), { recursive: true, force: true });
  fs.mkdirSync(path.join(output, name), { recursive: true });
}
const result = await build({ entryPoints: [path.join(directory, "render.mjs")], bundle: true,
  platform: "node", target: "node24", format: "cjs", minify: true, metafile: true,
  outfile: path.join(output, "scripts/render.cjs"), logLevel: "info" });
const echarts = path.dirname(require.resolve("echarts/package.json"));
fs.copyFileSync(path.join(echarts, "dist/echarts.min.js"), path.join(output, "vendor/echarts.cjs"));
fs.writeFileSync(path.join(output, "vendor/resvg.wasm.b64"), fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")).toString("base64") + "\n");
const packages = new Set([echarts, path.dirname(createRequire(path.join(echarts, "package.json")).resolve("zrender/package.json"))]);
for (const input of Object.keys(result.metafile.inputs)) {
  let parent = path.dirname(path.resolve(input));
  while (!fs.existsSync(path.join(parent, "package.json"))) parent = path.dirname(parent);
  packages.add(parent);
}
const notices = [];
for (const root of [...packages].sort()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.name.startsWith("@ontomato/")) continue;
  const files = fs.readdirSync(root).filter(name => /^(license|copying|notice)/i.test(name));
  // Some npm distributions carry the license in their README, or omit it: keep the source-owned copy in that case.
  if (!files.length) {
    const owned = path.join(directory, "licenses", `${pkg.name.replaceAll("/", "_")}.txt`);
    if (fs.existsSync(owned)) fs.copyFileSync(owned, path.join(output, "licenses", path.basename(owned)));
    else {
      const readme = fs.readdirSync(root).find(name => /^readme/i.test(name));
      fs.copyFileSync(path.join(root, readme), path.join(output, "licenses", `${pkg.name.replaceAll("/", "_")}-README.txt`));
    }
  }
  for (const name of files)
    fs.cpSync(path.join(root, name), path.join(output, "licenses", `${pkg.name.replaceAll("/", "_")}-${name}`), { recursive: true });
  notices.push(`${pkg.name} ${pkg.version}: ${pkg.license}`);
}
fs.writeFileSync(path.join(output, "licenses/THIRD_PARTY.txt"), notices.sort().join("\n") + "\n");
