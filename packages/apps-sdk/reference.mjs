// The API reference of the SDK's own modules, generated from their sources: the exports of each public entry, the
// components' props, events and slots by vue-component-meta, and the functions and types as TypeScript declares them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createChecker } = require("vue-component-meta");

/** Longer printed types read better as the type their source names. */
const PRINTED_LIMIT = 160;
const FULL = ts.TypeFormatFlags.NoTruncation;

const cell = (text) => String(text ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function propType(prop) {
  if (prop.type.length <= PRINTED_LIMIT) return prop.type;
  const [declaration] = prop.getDeclarations();
  if (!declaration) return prop.type;
  return readFileSync(declaration.file, "utf8").slice(...declaration.range).replace(/^[^:]*:\s*/, "").replace(/;$/, "");
}

function table(lines, head, rows) {
  if (!rows.length) return;
  lines.push(`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`), "");
}

function component(meta, lines) {
  const props = meta.props.filter((prop) => !prop.global);
  table(lines, ["Prop", "Type", "Required", "Default", "Description"], props.map((prop) => [
    `\`${kebab(prop.name)}\``, `\`${cell(propType(prop))}\``, prop.required ? "yes" : "no",
    prop.default === undefined ? "" : `\`${cell(prop.default)}\``, cell(prop.description),
  ]));
  table(lines, ["Event", "Arguments", "Description"], meta.events.map((event) => [
    `\`${kebab(event.name)}\``, `\`${cell(event.type)}\``, cell(event.description),
  ]));
  table(lines, ["Slot", "Slot props", "Description"], meta.slots.map((slot) => [
    `\`${slot.name}\``, `\`${cell(slot.type)}\``, cell(slot.description),
  ]));
  table(lines, ["Exposed through a template ref", "Type"], meta.exposed
    .filter((item) => !item.name.startsWith("$") && !props.some((prop) => prop.name === item.name))
    .map((item) => [`\`${item.name}\``, `\`${cell(item.type)}\``]));
}

function code(lines, text) {
  lines.push("```ts", text, "```", "");
}

/**
 * One Markdown section per entry, in export order. An export the generator cannot describe fails the build: nothing
 * public ships without its reference.
 */
export function referenceMarkdown({ root, tsconfig, entries }) {
  const meta = createChecker(tsconfig, { schema: false, printer: { newLine: ts.NewLineKind.LineFeed } });
  const program = meta.getProgram();
  const checker = program.getTypeChecker();
  const lines = [];
  for (const entry of entries) {
    lines.push(`## \`${entry.specifier}\` — \`${entry.file}\``, "");
    const source = program.getSourceFile(join(root, entry.source));
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
      const name = exported.name;
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const [declaration] = symbol.declarations;
      const file = declaration.getSourceFile().fileName;
      const docs = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
      lines.push(file.endsWith(".vue") ? `### \`<${kebab(name)}>\` ${name}` : `### ${name}`, "");
      if (docs) lines.push(docs, "");
      if (file.endsWith(".vue")) {
        component(meta.getComponentMeta(file, "default"), lines);
      } else if (ts.isFunctionDeclaration(declaration)) {
        // An inferred return type can expand into a wall of text; the declaration as written names its parts instead.
        const signatures = checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures()
          .map((signature) => `function ${name}${checker.signatureToString(signature, undefined, FULL)}`);
        const written = declaration.getText().slice(0, declaration.body.getStart() - declaration.getStart()).trim();
        code(lines, signatures.some((text) => text.length > 4 * PRINTED_LIMIT) ? written.replace(/^export\s+/, "") : signatures.join("\n"));
      } else if (ts.isTypeAliasDeclaration(declaration)) {
        // Aliases of utility or `typeof` types say more expanded, unless the expansion is a wall of text.
        const expanded = checker.typeToString(checker.getDeclaredTypeOfSymbol(symbol), undefined, FULL);
        code(lines, `type ${name} = ${expanded.length <= 4 * PRINTED_LIMIT ? expanded : declaration.type.getText()};`);
      } else if (ts.isInterfaceDeclaration(declaration)) {
        code(lines, declaration.getText().replace(/^export\s+/, ""));
      } else if (ts.isVariableDeclaration(declaration)) {
        code(lines, `const ${name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, declaration), undefined, FULL)};`);
      } else {
        throw new Error(`${entry.specifier} exports ${name}, which the reference cannot describe`);
      }
    }
  }
  return lines.join("\n");
}
