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
        // Aliases of utility or `typeof` types say more expanded, unless the expansion is a wall of text.
        const expanded = checker.typeToString(checker.getDeclaredTypeOfSymbol(symbol), undefined, FULL);
        code(lines, `type ${name} = ${expanded.length <= 4 * PRINTED_LIMIT ? expanded : declaration.type.getText()};`);
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
  if (type.kind === "object") return type.objectType === "@binding" ? "one object of the projection's type" : `one ${type.objectType}`;
  if (type.kind === "list") return `a list of ${portTypeText(type.items).replace(/^one object/, "objects").replace(/^one /, "")}`;
  if (type.kind === "object-union") return `one object of ${type.objectTypes ? type.objectTypes.join(" or ") : `the ${type.layers.join(", ")} layers`}`;
  if (type.kind === "scalar") return type.type;
  return type.kind;
}

/** The catalogue's document section: each component's meaning, what it binds and what it takes and hands over. */
export function catalogueMarkdown(version, catalogueOrComponents) {
  const isFull = !Array.isArray(catalogueOrComponents);
  const components = isFull ? catalogueOrComponents.components : catalogueOrComponents;
  const uiPrimitives = isFull ? catalogueOrComponents.uiPrimitives ?? [] : [];
  const uiDirectives = isFull ? catalogueOrComponents.uiDirectives ?? [] : [];
  const themeTokens = isFull ? catalogueOrComponents.themeTokens ?? [] : [];
  const lines = ["# Components of this SDK version", "", `The components \`${version}\` exports that a projection can bind. Each one names the module a page imports it from, what it means, the ontology elements it may bind, the data it reads, the configuration a projection sets on it, the values it hands the panel and the events the page can listen to. A projection chooses one component, the data it reads and its configuration, and names the owners' operations it offers; a panel places members of projections.`, ""];
  for (const component of components) {
    lines.push(`## ${component.componentId}`, "", `${component.role === "control" ? "Control" : "Presentation"}: \`${component.exportName}\` from \`${component.module}\`.`, "", component.meaning, "");
    if (component.effects) lines.push(`Effects: ${component.effects}`, "");
    if (component.bindsElement?.length) lines.push(`Binds: ${component.bindsElement.map((element) => `\`${element}\``).join(", ")}`, "");
    if (component.data && Object.keys(component.data).length) {
      lines.push("Data it reads (the projection's `data.<name>`, each an owner's read; its parameters are the read's signature):", "");
      for (const [name, datum] of Object.entries(component.data)) {
        const given = datum.runtimeParams?.length ? `; the component gives \`${datum.runtimeParams.join("`, `")}\` itself unless the placement binds them` : "";
        lines.push(`- ${name === "*" ? "any name you choose" : `\`${name}\``}: ${datum.results.join(" or ")}${datum.required ? ", required" : ""}${given}`);
      }
      lines.push("");
    }
    if (component.inputs && Object.keys(component.inputs).length)
      lines.push("Inputs:", "", ...Object.entries(component.inputs).map(([name, type]) => `- \`${name}\`: ${type.kind === "object" ? type.objectType : type.type ?? type.kind}`), "");
    if (component.config?.length) {
      lines.push("Configuration (the projection's `config`):", "");
      // A projection's config names each property as the component's source does, in camelCase.
      for (const prop of component.config) {
        const name = prop.name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const fallback = prop.default !== undefined && prop.default !== "undefined" ? `, default ${prop.default}` : "";
        lines.push(`- \`${name}\` (${prop.type.replace(/ \| undefined$/, "")}${prop.required ? ", required" : ""}${fallback}): ${prop.description || "—"}`);
      }
      lines.push("");
    }
    if (component.outputs && Object.keys(component.outputs).length)
      lines.push("Hands over (bindable to the panel's state):", "", ...Object.entries(component.outputs).map(([name, type]) => `- \`${name}\`: ${portTypeText(type)}`), "");
    const events = component.ports?.events?.filter(({ name }) => !name.startsWith("update:")) ?? [];
    if (events.length)
      lines.push("Events the page can listen to on `<projection>`:", "", ...events.map(({ name, description }) => `- \`${name}\`: ${description || "—"}`), "");
  }
  if (uiPrimitives.length) {
    lines.push(
      "## UI primitives (`@ontomato/sdk/ui`)",
      "",
      "Data-free interface controls published by this SDK. Use `<sdk-*>` tags directly in panel templates (`panel.html`) or import `Sdk*` from `@ontomato/sdk/ui` in custom components. Full prop, event and slot schemas are in `components.json` (`uiPrimitives`).",
      "",
    );
    table(lines, ["Template tag", "Export (`@ontomato/sdk/ui`)", "Description"], uiPrimitives.map((item) => [
      `\`<${item.tag}>\``, `\`${item.exportName}\``, cell(item.description || "—"),
    ]));
  }
  if (uiDirectives.length) {
    lines.push("## UI directives (`@ontomato/sdk/ui`)", "");
    table(lines, ["Template directive", "Export (`@ontomato/sdk/ui`)", "Description"], uiDirectives.map((item) => [
      `\`${item.name}\``, `\`${item.exportName}\``, cell(item.description),
    ]));
  }
  if (themeTokens.length) {
    lines.push("## Theme tokens", "", "CSS custom properties published for panel and component styling. Overridable tokens may be set in `panel.json` `theme.light` / `theme.dark`.", "");
    table(lines, ["Token", "Kind", "Overridable"], themeTokens.map((item) => [
      `\`${item.name}\``, `\`${item.kind}\``, item.overridable ? "yes" : "no",
    ]));
  }
  return lines.join("\n");
}
