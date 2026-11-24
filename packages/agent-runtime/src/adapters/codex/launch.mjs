import { readFile, mkdir, readdir, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const { ONTOMATO_CODEX_BOOT: boot, CODEX_GATEWAY_TOKEN, ...environment } = process.env;
const { binary, directories, model, prompt, engineTools, resume } = JSON.parse(boot);
const codexHome = directories.state;
const home = join(codexHome, "home");
const mounted = join(home, ".agents", "skills");
const engineFlag = join(codexHome, "engine-tools");
await mkdir(mounted, { recursive: true });
const nativeTools = resume ? JSON.parse(await readFile(engineFlag, "utf8")) : engineTools;
if (!resume) await writeFile(engineFlag, JSON.stringify(nativeTools));
const desired = new Map(directories.skills.map(skill => [skill.name, skill.directory]));
for (const name of await readdir(mounted)) {
  const entry = join(mounted, name);
  if (await readlink(entry) === desired.get(name)) desired.delete(name);
  else await unlink(entry);
}
for (const [name, directory] of desired) await symlink(directory, join(mounted, name), "dir");
const configPath = join(codexHome, "config.toml");
const catalog = join(codexHome, "models.json");
const template = JSON.parse(await readFile(new URL("./model-template.json", import.meta.url), "utf8"));
await writeFile(catalog, JSON.stringify({ models: [{
  ...template,
  slug: model.model,
  display_name: model.model,
  base_instructions: prompt,
  context_window: model.contextWindow,
  max_context_window: model.contextWindow,
  shell_type: nativeTools ? "shell_command" : "disabled",
  apply_patch_tool_type: nativeTools ? "freeform" : null,
}] }));
const string = JSON.stringify;
const fixed = await readFile(new URL("./config.toml", import.meta.url), "utf8");
await writeFile(configPath,
  `model = ${string(model.model)}\nmodel_catalog_json = ${string(catalog)}\n` + fixed + `
[model_providers.ontomato]
name = "Ontomato"
base_url = ${string(model.baseUrl)}
wire_api = "responses"
env_key = "CODEX_GATEWAY_TOKEN"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0

[mcp_servers]
`);
process.chdir(codexHome);
const args = [binary, "app-server", "--stdio", "--strict-config", "-c", `features.shell_tool=${nativeTools}`];
process.execve(binary, args, { ...environment, CODEX_HOME: codexHome, HOME: home, CODEX_GATEWAY_TOKEN });
