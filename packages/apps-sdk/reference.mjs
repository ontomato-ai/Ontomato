// The API reference of the SDK's own modules, generated from their sources: the exports of each public entry, the
// components' props, events and slots by vue-component-meta, and the functions and types as TypeScript declares them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createChecker } = require("vue-component-meta");
const { parse: parseComponent } = require("vue/compiler-sfc");

/** Longer printed types read better as the type their source names. */
const PRINTED_LIMIT = 160;
const FULL = ts.TypeFormatFlags.NoTruncation;

const plain = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const cell = (text) => plain(text).replace(/\|/g, "\\|");
/** A name as an HTML template writes it, by Vue's own rule: `EChart` is `<e-chart>`, `choosePlaceholder` `choose-placeholder`. */
const kebab = (name) => name.replace(/\B([A-Z])/g, "-$1").toLowerCase();

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

/**
 * The comment on each event a component declares in `defineEmits<{ … }>()`, by event name. vue-component-meta reads
 * the events from the emit function Vue's types build from that declaration, which keeps no comments.
 */
function eventDescriptions(file) {
  const descriptions = new Map();
  const script = parseComponent(readFileSync(file, "utf8"), { filename: file }).descriptor.scriptSetup;
  if (!script) return descriptions;
  const visit = (node) => {
    const [declared] = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineEmits" ? node.typeArguments ?? [] : [];
    if (declared && ts.isTypeLiteralNode(declared)) {
      for (const member of declared.members) {
        const text = ts.getJSDocCommentsAndTags(member).map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? "").join(" ");
        descriptions.set(member.name.text, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return descriptions;
}

/**
 * A component's ports as its source declares them: its props, the events it emits and its slots, each with the comment
 * written beside it. The reference's tables and the catalogue's `ports` are both read from this, so the two never differ.
 */
function portsOf(meta, file) {
  const events = eventDescriptions(file);
  return {
    props: meta.props.filter((prop) => !prop.global).map((prop) => ({
      name: kebab(prop.name),
      type: plain(propType(prop)),
      required: prop.required,
      ...(prop.default === undefined ? {} : { default: plain(prop.default) }),
      description: plain(prop.description),
    })),
    events: meta.events.map((event) => ({ name: kebab(event.name), type: plain(event.type), description: plain(events.get(event.name)) })),
    slots: meta.slots.map((slot) => ({ name: slot.name, type: plain(slot.type), description: plain(slot.description) })),
  };
}

function component(meta, file, lines) {
  const ports = portsOf(meta, file);
  table(lines, ["Prop", "Type", "Required", "Default", "Description"], ports.props.map((prop) => [
    `\`${prop.name}\``, `\`${cell(prop.type)}\``, prop.required ? "yes" : "no", prop.default === undefined ? "" : `\`${cell(prop.default)}\``, cell(prop.description),
  ]));
  table(lines, ["Event", "Arguments", "Description"], ports.events.map((event) => [`\`${event.name}\``, `\`${cell(event.type)}\``, cell(event.description)]));
  table(lines, ["Slot", "Slot props", "Description"], ports.slots.map((slot) => [`\`${slot.name}\``, `\`${cell(slot.type)}\``, cell(slot.description)]));
  const props = meta.props.filter((prop) => !prop.global);
  table(lines, ["Exposed through a template ref", "Type"], meta.exposed
    .filter((item) => !item.name.startsWith("$") && !props.some((prop) => prop.name === item.name))
    .map((item) => [`\`${item.name}\``, `\`${cell(item.type)}\``]));
}

/**
 * Each public component's ports, by `<module>#<export>` as the catalogue names it: what a component directory shows
 * beside the component's meaning, read from the same source as the reference.
 */
export function componentPorts({ root, tsconfig, entries }) {
  const meta = createChecker(tsconfig, { schema: false, printer: { newLine: ts.NewLineKind.LineFeed } });
  const program = meta.getProgram();
  const checker = program.getTypeChecker();
  const ports = new Map();
  for (const entry of entries) {
    const source = program.getSourceFile(join(root, entry.source));
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const file = symbol.declarations[0].getSourceFile().fileName;
      if (file.endsWith(".vue")) ports.set(`${entry.specifier}#${exported.name}`, portsOf(meta.getComponentMeta(file, "default"), file));
    }
  }
  return ports;
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
        component(meta.getComponentMeta(file, "default"), file, lines);
      } else if (ts.isFunctionDeclaration(declaration)) {
        // An inferred return type can expand into a wall of text; the declaration as written names its parts instead.
        const signatures = checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures()
          .map((signature) => `function ${name}${checker.signatureToString(signature, undefined, FULL)}`);
        const written = declaration.getText().slice(0, declaration.body.getStart() - declaration.getStart()).trim();
        code(lines, signatures.some((text) => text.length > 4 * PRINTED_LIMIT) ? written.replace(/^export\s+/, "") : signatures.join("\n"));
      } else if (ts.isTypeAliasDeclaration(declaration)) {
        // Aliases of utility or `typeof` types say more expanded, unless the expansion is a wall of text or self-referential.
        const expanded = checker.typeToString(checker.getDeclaredTypeOfSymbol(symbol), undefined, FULL);
        code(lines, `type ${name} = ${expanded.length <= 4 * PRINTED_LIMIT && expanded !== name ? expanded : declaration.type.getText()};`);
      } else if (ts.isInterfaceDeclaration(declaration)) {
        code(lines, declaration.getText().replace(/^export\s+/, ""));
      } else if (ts.isClassDeclaration(declaration)) {
        const members=declaration.members.filter(member=>!member.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.PrivateKeyword||modifier.kind===ts.SyntaxKind.ProtectedKeyword)).map(member=>{
          const text=member.getText();
          return member.body ? text.slice(0,member.body.getStart()-member.getStart()).trim()+";" : text;
        });
        const heritage=declaration.heritageClauses?.map(clause=>clause.getText()).join(" ")??"";
        code(lines,`class ${name}${heritage?" "+heritage:""} {\n${members.map(member=>"  "+member).join("\n")}\n}`);
      } else if (ts.isVariableDeclaration(declaration)) {
        code(lines, `const ${name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, declaration), undefined, FULL)};`);
      } else {
        throw new Error(`${entry.specifier} exports ${name}, which the reference cannot describe`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * The semantic metadata of this SDK version's components (overall design 3.1): every `defineComponentMeta` declaration,
 * read with the TypeScript checker so the declaration is the value the component's own module exports, never a copy.
 * The build writes the result as `components.json` and describes it in the reference.
 */
export function componentMetadata({ tsconfig, source }) {
  const meta = createChecker(tsconfig, { schema: false, printer: { newLine: ts.NewLineKind.LineFeed } });
  const program = meta.getProgram();
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(source);
  if (!file) throw new Error(`The component catalogue ${source} is not in the SDK's TypeScript project`);
  const [declaration] = file.statements.filter(
    (statement) => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((item) => item.name.getText() === "components"),
  );
  if (!declaration) throw new Error(`${source} declares no \`components\` list`);
  const [variable] = declaration.declarationList.declarations;
  const declared = ts.isAsExpression(variable.initializer) ? variable.initializer.expression : variable.initializer;
  if (!ts.isArrayLiteralExpression(declared)) throw new Error(`${source}'s components must be an array literal`);
  return declared.elements.map((element) => {
    const call = ts.isAsExpression(element) ? element.expression : element;
    if (!ts.isCallExpression(call) || call.expression.getText() !== "defineComponentMeta")
      throw new Error(`${source} declares a component without defineComponentMeta`);
    const [metadata] = call.arguments;
    const value = checker.getTypeAtLocation(metadata).getProperties().map((property) => {
      const type = checker.getTypeOfSymbolAtLocation(property, metadata);
      return [property.name, literalValue(checker, property, type, metadata)];
    });
    return { metadata: Object.fromEntries(value), line: file.getLineAndCharacterOfPosition(element.getStart()).line + 1 };
  });
}

/** A metadata field's value as JSON: its literals, and a readonly tuple's items as an array. */
function literalValue(checker, property, type, at) {
  const [declaration] = property.declarations ?? [];
  if (!declaration) return undefined;
  const initializer = declaration.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer) || ts.isNumericLiteral(initializer)) return initializer.text;
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(initializer)) return initializer.elements.map((item) => jsonOf(checker, item));
  if (ts.isObjectLiteralExpression(initializer)) {
    return Object.fromEntries(initializer.properties.map((member) => [member.name.getText().replace(/^["']|["']$/g, ""), jsonOf(checker, member.initializer)]));
  }
  void type;
  void at;
  throw new Error(`A component metadata field holds a value the catalogue cannot read: ${initializer.getText()}`);
}

function jsonOf(checker, node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  // A declaration's own words are JSON's: `required: false` is the boolean, not the name of one.
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => jsonOf(checker, item));
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((member) => [member.name.getText().replace(/^["']|["']$/g, ""), jsonOf(checker, member.initializer)]));
  }
  if (ts.isAsExpression(node)) return jsonOf(checker, node.expression);
  throw new Error(`A component metadata value is not a literal: ${node.getText()}`);
}

/**
 * Checks the catalogue against the version's own entries: every declared component is an export a page can import from
 * that module, and every component an entry exports carries a declaration. A component no page can import, or one that
 * ships undescribed, fails the build here rather than in a panel.
 */
export function checkCatalogue(entries, declared, root, tsconfig) {
  const meta = createChecker(tsconfig, { schema: false, printer: { newLine: ts.NewLineKind.LineFeed } });
  const program = meta.getProgram();
  const checker = program.getTypeChecker();
  const exported = new Map();
  for (const entry of entries) {
    const source = program.getSourceFile(join(root, entry.source));
    for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declarations = target.declarations ?? symbol.declarations ?? [];
      exported.set(`${entry.specifier}#${symbol.name}`, declarations.some((declaration) => declaration.getSourceFile().fileName.endsWith(".vue")));
    }
  }
  const described = new Set(declared.map((component) => `${component.metadata.module}#${component.metadata.exportName}`));
  for (const key of described) if (!exported.has(key)) throw new Error(`The catalogue declares ${key}, which this SDK version does not export`);
  for (const [key, component] of exported) {
    if (component && !described.has(key)) throw new Error(`${key} is a public component of this SDK version with no catalogue declaration`);
  }
}

/** A port's type as the reference names it: `@binding` is the type the projection binds. */
function portTypeText(type) {
  if (type.kind === "object") {
    if (type.objectType === "@any") return "any ontology object";
    return type.objectType === "@binding" ? "one object of the projection's type" : `one ${type.objectType}`;
  }
  if (type.kind === "list") return `a list of ${portTypeText(type.items).replace(/^one object/, "objects").replace(/^one /, "")}`;
  if (type.kind === "object-union") {
    const parts = [];
    if (type.layers?.length) parts.push(`the ${type.layers.join(", ")} layers`);
    if (type.objectTypes?.length) parts.push(type.objectTypes.join(" or "));
    return `one object of ${parts.join(" or ")}`;
  }
  if (type.kind === "scalar") return type.type;
  return type.kind;
}

/**
 * Exported type alias and interface definitions across the SDK entries, keyed by type name, so the component
 * catalogue can expand named config structs (such as `ObjectListColumn`) beside the properties that reference them.
 */
export function exportedTypeDefinitions({ root, tsconfig, entries }) {
  const meta = createChecker(tsconfig, { schema: false, printer: { newLine: ts.NewLineKind.LineFeed } });
  const program = meta.getProgram();
  const checker = program.getTypeChecker();
  const definitions = new Map();
  for (const entry of entries) {
    const source = program.getSourceFile(join(root, entry.source));
    if (!source) continue;
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
      const name = exported.name;
      if (definitions.has(name)) continue;
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const [declaration] = symbol.declarations ?? [];
      if (!declaration) continue;
      if (ts.isTypeAliasDeclaration(declaration)) {
        const expanded = checker.typeToString(checker.getDeclaredTypeOfSymbol(symbol), undefined, FULL);
        const body = expanded.length <= 8 * PRINTED_LIMIT && expanded !== name ? expanded : declaration.type.getText();
        definitions.set(name, `type ${name} = ${body};`);
      } else if (ts.isInterfaceDeclaration(declaration)) {
        if (declaration.members.some((member) => ts.isMethodSignature(member))) continue;
        definitions.set(name, declaration.getText().replace(/^export\s+/, ""));
      }
    }
  }
  return definitions;
}

const COMPONENT_GROUPS = [
  ["list", "Lists & Grids"],
  ["detail", "Detail & Values"],
  ["form", "Forms & Pickers"],
  ["action", "Actions & Uploads"],
  ["chart", "Charts & Metrics"],
  ["graph", "Graphs & Relations"],
  ["content", "Files, Text & Previews"],
  ["conversation", "Conversation"],
  ["layout", "Layout & Page Structure"],
];

/** Extracts the opening sentence of a component's meaning while ignoring periods inside backticks. */
function firstSentence(text) {
  const normalized = plain(text);
  let inCode = false;
  for (let index = 0; index < normalized.length; index++) {
    const ch = normalized[index];
    if (ch === "`") {
      inCode = !inCode;
      continue;
    }
    if (!inCode && ch === ".") {
      const next = normalized[index + 1];
      const prefix = normalized.slice(Math.max(0, index - 4), index + 1).toLowerCase();
      if (prefix.endsWith("e.g.") || prefix.endsWith("i.e.") || prefix.endsWith("etc.")) continue;
      if (next === undefined || next === " ") return normalized.slice(0, index + 1);
    }
  }
  return normalized;
}

/**
 * Component IDs registered as panel template/base components in `src/base-components.ts`.
 * Combined with declared projection `data`, this lets the SDK build derive `panelUsable` from runtime facts
 * instead of hand-maintaining a second list.
 */
export function baseComponentIds(source) {
  const parsed = ts.createSourceFile(source, readFileSync(source, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ids = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "baseComponents" &&
      node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
          ids.add(prop.name.getText(parsed).replace(/^["']|["']$/g, ""));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return ids;
}

/**
 * Resolves a component's author-facing `config` prop entries strictly from its declared `metadata.config` list.
 * Each declared name (camelCase or kebab-case) must match an actual Vue prop of the component and appear at most once;
 * undeclared props (host-only inputs, platform-fixed styles, single-page knobs) are never emitted to author-facing docs.
 */
export function resolveDeclaredConfig(metadata, declaredProps, { requireDeclaration = false, defaultToAll = false } = {}) {
  if (metadata.config === undefined) {
    if (requireDeclaration) {
      throw new Error(
        `Catalogue component '${metadata.componentId}' is panel-usable and must explicitly declare its author-facing \`config\` prop list in catalogue.ts`,
      );
    }
    return defaultToAll && declaredProps.length ? declaredProps : undefined;
  }
  if (!Array.isArray(metadata.config)) {
    throw new Error(`Catalogue component '${metadata.componentId}' declared a non-array \`config\``);
  }
  const byName = new Map();
  for (const prop of declaredProps) {
    byName.set(prop.name, prop);
    byName.set(prop.name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()), prop);
  }
  const resolved = [];
  const seen = new Set();
  for (const rawName of metadata.config) {
    if (typeof rawName !== "string" || !rawName.trim()) {
      throw new Error(`Catalogue component '${metadata.componentId}' declared an invalid \`config\` entry: ${JSON.stringify(rawName)}`);
    }
    const found = byName.get(rawName);
    if (!found) {
      throw new Error(
        `Catalogue component '${metadata.componentId}' declares \`config\` prop '${rawName}', which is not declared on its Vue component`,
      );
    }
    if (seen.has(found.name)) {
      throw new Error(
        `Catalogue component '${metadata.componentId}' declares duplicate \`config\` prop '${rawName}'`,
      );
    }
    seen.add(found.name);
    resolved.push(found);
  }
  return resolved.length ? resolved : undefined;
}

/** Single component detail page (`docs/components/<ComponentId>.md`), keeping all data, config, slots and events. */
export function componentPageMarkdown(version, component, typeDefinitions = new Map()) {
  const placement = component.panelUsable === false
    ? "Platform/host component (not placed directly in registered panels)."
    : component.data !== undefined
      ? "Panel placement: `<projection>` member in `manifest.members`."
      : `Panel placement: template tag \`<${kebab(component.componentId)}>\` in \`panel.html\` (not a \`manifest.members\` projection).`;
  const lines = [
    `# ${component.componentId}`,
    "",
    `Component of \`@ontomato/sdk\` \`${version}\`. [Component overview](../components.md)`,
    "",
    `${component.role === "control" ? "Control" : "Presentation"}: \`${component.exportName}\` from \`${component.module}\`. ${placement}`,
    "",
    component.meaning,
    "",
  ];
  if (component.effects) lines.push(`Effects: ${component.effects}`, "");
  if (component.bindsElement?.length) lines.push(`Applicable object types (bind through a projection's declared reads or operations): ${component.bindsElement.map((element) => `\`${element}\``).join(", ")}`, "");
  if (component.data && Object.keys(component.data).length) {
    lines.push("Data it reads (the projection's `data.<name>`, each an owner's read; its parameters are the read's signature):", "");
    for (const [name, datum] of Object.entries(component.data)) {
      const given = datum.runtimeParams?.length ? `; the component gives \`${datum.runtimeParams.join("`, `")}\` itself unless the placement binds them` : "";
      lines.push(`- ${name === "*" ? "any name you choose" : `\`${name}\``}: ${datum.results.join(" or ")}${datum.required ? ", required" : ""}${given}`);
    }
    lines.push("");
  }
  const componentPortTypeText = (name, type) => component.componentId === "ObjectRelations" && name === "visibleRelationKinds"
    ? "a list of relation kind IDs or object references"
    : portTypeText(type);
  if (component.inputs && Object.keys(component.inputs).length)
    lines.push("Inputs:", "", ...Object.entries(component.inputs).map(([name, type]) => `- \`${name}\`: ${componentPortTypeText(name, type)}`), "");
  if (component.config?.length) {
    lines.push("Configuration (the projection's `config`):", "");
    const referencedTypes = new Set();
    // A projection's config names each property as the component's source does, in camelCase.
    for (const prop of component.config) {
      const name = prop.name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const fallback = prop.default !== undefined && prop.default !== "undefined" ? `, default ${prop.default}` : "";
      const printedType = prop.type.replace(/ \| undefined$/, "");
      lines.push(`- \`${name}\` (${printedType}${prop.required ? ", required" : ""}${fallback}): ${prop.description || "—"}`);
      for (const match of printedType.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/gu)) {
        if (typeDefinitions.has(match[1])) referencedTypes.add(match[1]);
      }
    }
    lines.push("");
    if (referencedTypes.size) {
      lines.push("Configuration types:", "", "```ts", ...[...referencedTypes].map((name) => typeDefinitions.get(name)), "```", "");
    }
  }
  if (component.outputs && Object.keys(component.outputs).length)
    lines.push("Hands over (bindable to the panel's state):", "", ...Object.entries(component.outputs).map(([name, type]) => `- \`${name}\`: ${componentPortTypeText(name, type)}`), "");
  if (component.readOnlyOutputs && Object.keys(component.readOnlyOutputs).length)
    lines.push("Read-only outputs (read via `usePanelOutput` / `outputs[member][name]`, separate from writable panel state):", "", ...Object.entries(component.readOnlyOutputs).map(([name, type]) => `- \`${name}\`: ${portTypeText(type)}`), "");
  const slots = component.ports?.slots ?? [];
  if (slots.length)
    lines.push("Vue slots on `<projection>`:", "", ...slots.map((slot) => `- \`#${slot.name}\`${slot.type && slot.type !== "{}" ? ` (\`${cell(slot.type)}\`)` : ""}: ${slot.description || "—"}`), "");
  const events = component.ports?.events?.filter(({ name }) => !name.startsWith("update:")) ?? [];
  if (events.length)
    lines.push("Events the page can listen to on `<projection>`:", "", ...events.map(({ name, description }) => `- \`${name}\`: ${description || "—"}`), "");
  return lines.join("\n");
}

/** UI primitives and directives page (`docs/components/ui-primitives.md`). */
export function uiPrimitivesMarkdown(version, catalogue) {
  const uiPrimitives = catalogue.uiPrimitives ?? [];
  const uiDirectives = catalogue.uiDirectives ?? [];
  const lines = [
    `# UI primitives and directives (\`@ontomato/sdk/ui\`)`,
    "",
    `SDK \`${version}\`. [Component overview](../components.md)`,
    "",
    "Data-free interface controls published by this SDK. Use `<sdk-*>` tags directly in panel templates (`panel.html`) or import `Sdk*` from `@ontomato/sdk/ui` in custom components. Full prop, event and slot schemas are in `components.json` (`uiPrimitives`).",
    "",
  ];
  if (uiPrimitives.length) {
    lines.push("## UI primitives", "");
    table(lines, ["Template tag", "Export (`@ontomato/sdk/ui`)", "Description"], uiPrimitives.map((item) => [
      `\`<${item.tag}>\``, `\`${item.exportName}\``, cell(item.description || "—"),
    ]));
  }
  if (uiDirectives.length) {
    lines.push("## UI directives", "");
    table(lines, ["Template directive", "Export (`@ontomato/sdk/ui`)", "Description"], uiDirectives.map((item) => [
      `\`${item.name}\``, `\`${item.exportName}\``, cell(item.description),
    ]));
  }
  return lines.join("\n");
}

/** Theme tokens page (`docs/components/theme-tokens.md`). */
export function themeTokensMarkdown(version, catalogue) {
  const themeTokens = catalogue.themeTokens ?? [];
  const lines = [
    "# Theme tokens",
    "",
    `SDK \`${version}\`. [Component overview](../components.md)`,
    "",
    "CSS custom properties published for panel and component styling. Overridable tokens may be set in `panel.json` `theme.light` / `theme.dark`.",
    "",
  ];
  if (themeTokens.length) {
    table(lines, ["Token", "Kind", "Overridable"], themeTokens.map((item) => [
      `\`${item.name}\``, `\`${item.kind}\``, item.overridable ? "yes" : "no",
    ]));
  }
  return lines.join("\n");
}

/**
 * Layer-1 component overview (`docs/components.md`): lists only panel-usable components, grouped by purpose, one line
 * each (component name, placement mode, and the opening sentence of its declared `meaning`), pointing to per-component
 * single pages under `docs/components/<ComponentId>.md`.
 */
export function catalogueMarkdown(version, catalogueOrComponents) {
  const isFull = !Array.isArray(catalogueOrComponents);
  const components = (isFull ? catalogueOrComponents.components : catalogueOrComponents)
    .filter((component) => component.panelUsable !== false);
  const grouped = new Map();
  for (const component of components) {
    const key = component.group ?? "other";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(component);
  }
  const lines = [
    "# Panel components overview",
    "",
    `Components in \`@ontomato/sdk\` \`${version}\` that can be placed in a registered panel. Read a single component's full data ports, config, slots, and events with \`sdk read docs/components/<Name>.md\`.`,
    "",
    "- `projection`: declare in `manifest.members` and mount with `<projection slot=\"…\">`.",
    "- `<tag>`: use directly as a template tag in `panel.html` (do not put in `manifest.members`).",
    "",
  ];
  const orderedGroups = [
    ...COMPONENT_GROUPS,
    ...[...grouped.keys()].filter((key) => !COMPONENT_GROUPS.some(([known]) => known === key)).map((key) => [key, key]),
  ];
  for (const [groupKey, label] of orderedGroups) {
    const entries = grouped.get(groupKey);
    if (!entries?.length) continue;
    lines.push(`## ${label}`, "");
    for (const component of entries) {
      const placement = component.data !== undefined ? "projection" : `\`<${kebab(component.componentId)}>\``;
      lines.push(`- [**${component.componentId}**](components/${component.componentId}.md) (${placement}): ${firstSentence(component.meaning)}`);
    }
    lines.push("");
  }
  lines.push(
    "## Also in this SDK release",
    "",
    "- [UI primitives & directives (`<sdk-*>`, `v-sdk-*`)](components/ui-primitives.md) — `sdk read docs/components/ui-primitives.md`",
    "- [Theme tokens (`--sdk-*`)](components/theme-tokens.md) — `sdk read docs/components/theme-tokens.md`",
    "- [Full API reference](reference.md) — `sdk read docs/reference.md` (look up only when needed; do not read upfront)",
    "",
  );
  return lines.join("\n");
}
