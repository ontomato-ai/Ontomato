import { readFileSync } from "node:fs";
const moduleId = "apps-sdk:element-components";

/** Use the installed Element Plus version's own component list to generate imports of its component modules. */
export function elementComponents() {
  return {
    name: "apps-sdk-element-components",
    resolveId(id) {
      if (id === moduleId) return "\0" + id;
    },
    load(id) {
      if (id !== "\0" + moduleId) return;
      const installer = readFileSync(new URL(import.meta.resolve("element-plus/es/component.mjs")), "utf8");
      const ast = this.parse(installer);
      const list = ast.body.flatMap(node => node.declarations ?? []).find(declaration => declaration.init.type === "ArrayExpression");
      const paths = new Map(ast.body.filter(node => node.type === "ImportDeclaration").flatMap(node =>
        node.specifiers.map(specifier => [specifier.local.name, node.source.value]),
      ));
      const loaders = list.init.elements.map(({ name }) => {
        const path = paths.get(name).replace(/^\.\//, "element-plus/es/");
        return `  ${name}: () => import(${JSON.stringify(path)}).then(module => module.${name})`;
      });
      return `export default {\n${loaders.join(",\n")}\n};`;
    },
  };
}
