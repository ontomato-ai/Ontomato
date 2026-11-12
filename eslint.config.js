import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import vue from "eslint-plugin-vue";
import prettierConfig from "eslint-config-prettier";
import vueParser from "vue-eslint-parser";

const layerSpec = "the Node.js server module and dependency rules";
const server = "packages/workbench-server/src";

// No file in this repository may depend on a private enterprise module: neither through an
// enterprise package name nor through a relative path into the adjacent enterprise
// repository.
// no-restricted-imports covers import/export-from/side-effect import, and it overrides
// rather than merges across config blocks, so every block repeats this entry; dynamic
// import() is covered by no-restricted-syntax.
const ENTERPRISE_SPECIFIER = "^@enterprise/|^(\\.\\./)+enterprise(/|$)";
const noEnterprise = { regex: ENTERPRISE_SPECIFIER, message: "public modules must not depend on a private enterprise module" };
const restrict = (patterns) => ["error", { patterns: [...patterns, noEnterprise] }];
const restrictLayer = (source, targets) =>
  restrict(
    targets.map((target) => ({
      regex: `^(\\.\\./)+${target}(/|$)`,
      message: `${source} must not depend on ${target}, see ${layerSpec}`,
    }))
  );

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      // Third-party minified libraries.
      "**/*.min.js",
      // Same as the source repository: default runtime resources and skill packages are out
      // of lint scope (the source eslint.config.js ignores data/** and skills/**).
      "packages/workbench-server/data/**",
      "packages/workbench-server/skills/**",
      "packages/workbench-server/resources/runtime-skills/assistant-report/scripts/*.cjs",
      "packages/workbench-server/resources/runtime-skills/assistant-report/vendor/**",
      // Java modules.
      "packages/data-engine-core/**",
    ],
  },
  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      ...ts.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
      "no-debugger": "warn",
      "no-restricted-imports": restrict([]),
      "no-restricted-syntax": [
        "error",
        {
          selector: `ImportExpression > Literal[value=/${ENTERPRISE_SPECIFIER.replaceAll("/", "\\/")}/]`,
          message: "public modules must not depend on a private enterprise module",
        },
      ],
    },
  },
  {
    // Every .mjs here runs on Node (build, packaging and development entries, their tests, and
    // the agent skill CLIs): add only the Node globals.
    files: ["scripts/**/*.mjs", "apps/*/*.mjs", "agent-skills/**/*.mjs", "packages/agent-runtime/src/**/*.mjs", "packages/workbench-server/resources/runtime-skills/**/*.mjs", "packages/contracts/scripts/**/*.mjs", "packages/workbench-server/report-skill/**/*.mjs", "packages/apps-sdk/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Vue single-file components; rules match the source repository (without the prettier
    // plugin, formatting is checked separately).
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      // The base rule reads a function type's parameter name as an unused variable in a single-file component; the
      // TypeScript-aware rule (as for .ts) tells a type position from a value one.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/require-default-prop": "off",
      // As in the source repository, prettier owns formatting; only the template formatting
      // rules are off for Vue files, without changing the existing TS checks.
      ...prettierConfig.rules,
      "no-restricted-imports": restrict([]),
    },
  },
  {
    // Browser code and shared contracts must also work on plain HTTP intranet deployments.
    files: [
      "packages/{contracts,apps-sdk,design-tokens,foundation-ui,agent-shell-ui,ontology-manager,platform-admin,platform-schedules,platform-shell,platform-web,workbench-ui}/src/**/*.{ts,js,vue}",
      "apps/workbench/web/**/*.{ts,js,vue}",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          property: "randomUUID",
          message: "Use randomId() from @ontomato/contracts/random-id; crypto.randomUUID is unavailable over HTTP.",
        },
      ],
    },
  },
  {
    files: ["packages/{agent-shell-ui,foundation-ui,ontology-manager,platform-schedules,platform-web,workbench-ui}/src/**/*.{ts,vue}"],
    rules: {
      // DOM type names (such as RequestInit) are not runtime globals; undefined identifiers
      // are checked by vue-tsc.
      "no-undef": "off",
    },
  },
  {
    // The platform scheduled tasks page is a platform UI package: it takes the host's request function
    // (whose signature uses DOM type names, not runtime globals) and depends on no host application.
    files: ["packages/platform-schedules/src/**/*.{ts,vue}"],
    rules: {
      "no-restricted-imports": restrict([
        {
          regex:
            "^@ontomato/(?!(contracts|design-tokens|foundation-ui)(/|$))|(^|/)(workbench-ui|workbench-server|ontology-manager|platform-admin|agent-shell-ui)(/|$)",
          message:
            "platform-schedules may depend on contracts, design tokens, the shared foundation components and UI libraries only; hosts inject the request function, the applications and the way to a result",
        },
      ]),
    },
  },
  {
    // Manager components consume only what the Manager installs in the page (context, client, text
    // helpers) and report navigation through events; they do not depend on the router, the page's
    // vue-i18n instance or a store. Only the route table, the frame around the pages and the context
    // module bind them to the service page's one router and one vue-i18n (2026-11-04 shell unification).
    files: ["packages/ontology-manager/src/**/*.{ts,vue}"],
    ignores: [
      "packages/ontology-manager/src/routes.ts",
      "packages/ontology-manager/src/context.ts",
      "packages/ontology-manager/src/ManagerFrame.vue",
      "packages/ontology-manager/src/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": restrict([
        {
          regex: "^(vue-router|vue-i18n|pinia)(/|$)",
          message: "Manager components must not depend on the router, the page's vue-i18n or a store; use the Manager context, its text helpers and events",
        },
      ]),
    },
  },
  {
    files: ["packages/agent-runtime/src/**/*.ts"],
    rules: {
      "no-restricted-imports": restrict([
        {
          regex: "^@ontomato/(?!(contracts|service-logging)(/|$))|(^|/)(workbench-server|workbench-ui|data-engine-core|apps)(/|$)",
          message: "agent-runtime may depend on contracts and lower-level libraries, never on a host implementation",
        },
      ]),
    },
  },
  {
    // The agent shell is a platform UI package: it depends only on contracts, the foundation UI and
    // third-party libraries, never on a host (workbench, Manager), a global store, router or i18n instance.
    files: ["packages/agent-shell-ui/src/**/*.{ts,vue}"],
    rules: {
      "no-restricted-imports": restrict([
        {
          regex: "^@ontomato/(?!(contracts|foundation-ui)(/|$))|^(pinia|vue-router|vue-i18n|element-plus)(/|$)",
          message: "agent-shell-ui may depend only on contracts and the foundation UI; hosts pass labels, data ports and renderers",
        },
      ]),
    },
  },
  {
    // The foundation UI is the bottom layer every application and the SDK share (one implementation per
    // capability, exported by capability subpath): it depends only on Vue, Element Plus, ECharts, markstream-vue,
    // CodeMirror and the product Markdown, never on a platform package or a host. It may name the wire contracts'
    // types, so a shape it draws has one definition, but carries no contract code: the TypeScript form of the rule tells
    // a type import from a value import.
    files: ["packages/foundation-ui/src/**/*.{ts,vue}"],
    ignores: ["packages/foundation-ui/src/**/__tests__/**"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": restrict([
        {
          regex: "^(?!(vue|element-plus|echarts|markstream-vue|codemirror|@codemirror/[a-z-]+|@ontomato/markdown|@ontomato/contracts)(/|$)|\\.)",
          message: "foundation-ui may depend only on Vue, Element Plus, ECharts, markstream-vue, CodeMirror and the product Markdown; the packages that use it depend on it, not the other way round",
        },
        {
          regex: "^@ontomato/contracts(/|$)",
          allowTypeImports: true,
          message: "foundation-ui may name contract types (import type) but carries no contract code",
        },
      ]),
    },
  },
  {
    // The product Markdown is the one definition pages and exports read a text with, so both the browser and Node
    // load it: it depends on its parser only, never on Vue, a UI library or another package of the platform.
    files: ["packages/markdown/src/**/*.ts"],
    ignores: ["packages/markdown/src/**/__tests__/**"],
    rules: {
      "no-restricted-imports": restrict([
        {
          regex: "^(?!stream-markdown-parser$|\\.)",
          message: "@ontomato/markdown may depend only on its parser, stream-markdown-parser",
        },
      ]),
    },
  },
  {
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": restrict([
        {
          regex: "(^|/)(?:src|web)(?:/|$)|^@ontomato/(?!contracts(/|$))",
          message: "contracts may depend only on the shared contracts, not on server or browser implementations",
        },
      ]),
    },
  },
  ...[
    ["core", ["services", "platform", "api", "infrastructure"]],
    ["platform", ["services", "api"]],
    ["services", ["api"]],
    ["utils", ["services", "platform", "api", "core"]],
    ["i18n", ["services", "platform", "api", "core"]],
    ["logging", ["services", "platform", "api", "core"]],
    ["config", ["services", "platform", "api", "core"]],
    ["infrastructure", ["services", "platform", "api", "core"]],
    // The assembly seam where the application is installed, at the bottommost layer.
    ["content", ["services", "platform", "api", "core", "infrastructure"]],
    ["runtime", ["services", "platform", "api", "core", "infrastructure"]],
    ["product", ["services", "platform", "api", "core", "infrastructure"]],
    ["identity", ["services", "platform", "api", "core", "infrastructure"]],
  ].map(([source, targets]) => ({
    files: [`${server}/${source}/**/*.ts`],
    rules: { "no-restricted-imports": restrictLayer(source, targets) },
  })),
  {
    files: [`${server}/api/routes/**/*.ts`],
    rules: {
      "no-restricted-imports": restrict([
        { regex: "^pg(/|$)", message: `api/routes must not depend on pg, see ${layerSpec}` },
        {
          regex: "^(\\.\\./)+infrastructure/postgres[^/]*(/|$)",
          message: `api/routes must not depend on infrastructure/postgres, see ${layerSpec}`,
        },
      ]),
    },
  },

];
