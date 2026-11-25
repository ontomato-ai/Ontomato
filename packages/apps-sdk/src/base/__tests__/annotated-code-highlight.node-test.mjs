import assert from "node:assert/strict";
import test from "node:test";
import {
  highlightCodeLines,
  normalizeCodeLanguage,
} from "../annotated-code-highlight.ts";

function flatten(tokens) {
  return tokens.map((token) => token.text).join("");
}

function findToken(tokens, text, kind) {
  return tokens.find((token) => token.text === text && (kind === undefined || token.kind === kind));
}

test("normalizeCodeLanguage resolves all supported language names and aliases and rejects plain/text", () => {
  assert.equal(normalizeCodeLanguage("python"), "python");
  assert.equal(normalizeCodeLanguage("PY"), "python");
  assert.equal(normalizeCodeLanguage("javascript"), "javascript");
  assert.equal(normalizeCodeLanguage("js"), "javascript");
  assert.equal(normalizeCodeLanguage("typescript"), "typescript");
  assert.equal(normalizeCodeLanguage("ts"), "typescript");
  assert.equal(normalizeCodeLanguage("json"), "json");
  assert.equal(normalizeCodeLanguage("sql"), "sql");
  assert.equal(normalizeCodeLanguage("yaml"), "yaml");
  assert.equal(normalizeCodeLanguage("yml"), "yaml");
  assert.equal(normalizeCodeLanguage("bash"), "bash");
  assert.equal(normalizeCodeLanguage("sh"), "bash");
  assert.equal(normalizeCodeLanguage("shell"), "bash");
  assert.equal(normalizeCodeLanguage("html"), "html");
  assert.equal(normalizeCodeLanguage("xml"), "html");
  assert.equal(normalizeCodeLanguage("css"), "css");

  assert.equal(normalizeCodeLanguage(undefined), null);
  assert.equal(normalizeCodeLanguage(null), null);
  assert.equal(normalizeCodeLanguage(""), null);
  assert.equal(normalizeCodeLanguage("plain"), null);
  assert.equal(normalizeCodeLanguage("text"), null);
  assert.equal(normalizeCodeLanguage("unknown-lang"), null);
});

test("highlightCodeLines returns null when language is omitted or plain/text", () => {
  const lines = ["def run(x):", "    return x + 1"];
  assert.equal(highlightCodeLines(lines, null), null);
  assert.equal(highlightCodeLines(lines, undefined), null);
  assert.equal(highlightCodeLines(lines, "plain"), null);
  assert.equal(highlightCodeLines(lines, "text"), null);
});

test("Python highlighter tokenizes keywords, functions, numbers, comments, and multiline triple-quoted strings", () => {
  const lines = [
    "def compute(limit: int) -> int:",
    '    """Compute sum across',
    "    multiple lines with def fake():",
    '    """',
    "    total = sum(range(limit))  # accumulator",
    "    return total + 42",
  ];
  const result = highlightCodeLines(lines, "py");
  assert.ok(result);
  assert.equal(result.length, lines.length);
  lines.forEach((line, index) => assert.equal(flatten(result[index]), line));

  assert.ok(findToken(result[0], "def", "keyword"));
  assert.ok(findToken(result[0], "compute", "function"));
  assert.ok(findToken(result[1], '"""Compute sum across', "string"));
  // Inside triple-quoted string, `def` must stay a string token, not a keyword.
  assert.equal(findToken(result[2], "def", "keyword"), undefined);
  assert.ok(result[2].some((token) => token.kind === "string" && token.text.includes("def fake()")));
  assert.ok(result[3].some((token) => token.kind === "string" && token.text.includes('"""')));
  assert.ok(findToken(result[4], "# accumulator", "comment"));
  assert.ok(findToken(result[5], "return", "keyword"));
  assert.ok(findToken(result[5], "42", "number"));
});

test("JavaScript and TypeScript highlighters preserve multiline block comments and types", () => {
  const lines = [
    "/* Block comment start",
    " * const notCode = 123;",
    " */",
    "export interface Item { count: number }",
    "const total: number = compute(10);",
  ];
  const result = highlightCodeLines(lines, "ts");
  assert.ok(result);
  lines.forEach((line, index) => assert.equal(flatten(result[index]), line));

  assert.ok(result[0].every((token) => token.kind === "comment"));
  assert.ok(result[1].every((token) => token.kind === "comment"));
  assert.equal(findToken(result[1], "const", "keyword"), undefined);
  assert.ok(result[2].some((token) => token.kind === "comment"));
  assert.ok(findToken(result[3], "interface", "keyword"));
  assert.ok(findToken(result[3], "Item", "type"));
  assert.ok(findToken(result[4], "const", "keyword"));
  assert.ok(findToken(result[4], "compute", "function"));
  assert.ok(findToken(result[4], "10", "number"));

  const jsLines = ["const greeting = `hello ${name}`; // inline"];
  const jsResult = highlightCodeLines(jsLines, "js");
  assert.ok(jsResult);
  assert.equal(flatten(jsResult[0]), jsLines[0]);
  assert.ok(findToken(jsResult[0], "const", "keyword"));
  assert.ok(findToken(jsResult[0], "// inline", "comment"));
});

test("JSON highlighter distinguishes property keys, string values, numbers, and booleans", () => {
  const lines = [
    "{",
    '  "name": "orders",',
    '  "retries": 3,',
    '  "enabled": true',
    "}",
  ];
  const result = highlightCodeLines(lines, "json");
  assert.ok(result);
  lines.forEach((line, index) => assert.equal(flatten(result[index]), line));

  assert.ok(findToken(result[1], '"name"', "property"));
  assert.ok(findToken(result[1], '"orders"', "string"));
  assert.ok(findToken(result[2], '"retries"', "property"));
  assert.ok(findToken(result[2], "3", "number"));
  assert.ok(findToken(result[3], "true", "builtin"));
});

test("SQL highlighter tokenizes keywords, strings, numbers, line comments, and block comments", () => {
  const lines = [
    "/* query",
    "   orders */",
    "SELECT id, COUNT(*) FROM orders WHERE status = 'open' AND amount > 100 -- active",
  ];
  const result = highlightCodeLines(lines, "sql");
  assert.ok(result);
  lines.forEach((line, index) => assert.equal(flatten(result[index]), line));

  assert.ok(result[0].every((token) => token.kind === "comment"));
  assert.ok(result[1].some((token) => token.kind === "comment"));
  assert.ok(findToken(result[2], "SELECT", "keyword"));
  assert.ok(findToken(result[2], "'open'", "string"));
  assert.ok(findToken(result[2], "100", "number"));
  assert.ok(findToken(result[2], "-- active", "comment"));
});

test("YAML, Bash, HTML/XML, and CSS highlighters produce lossless tokens with semantic kinds", () => {
  const yamlLines = ["service: api # name", "replicas: 2", "enabled: true"];
  const yaml = highlightCodeLines(yamlLines, "yml");
  assert.ok(yaml);
  yamlLines.forEach((line, i) => assert.equal(flatten(yaml[i]), line));
  assert.ok(findToken(yaml[0], "service", "property"));
  assert.ok(findToken(yaml[0], "# name", "comment"));
  assert.ok(findToken(yaml[1], "2", "number"));
  assert.ok(findToken(yaml[2], "true", "builtin"));

  const bashLines = ['if [ "$ENV" = "prod" ]; then', '  echo "ready" # ok', "fi"];
  const bash = highlightCodeLines(bashLines, "shell");
  assert.ok(bash);
  bashLines.forEach((line, i) => assert.equal(flatten(bash[i]), line));
  assert.ok(findToken(bash[0], "if", "keyword"));
  assert.ok(findToken(bash[1], "echo", "builtin"));
  assert.ok(findToken(bash[1], "# ok", "comment"));

  const htmlLines = ["<!-- header", "     note -->", '<div class="card">Hello</div>'];
  const html = highlightCodeLines(htmlLines, "xml");
  assert.ok(html);
  htmlLines.forEach((line, i) => assert.equal(flatten(html[i]), line));
  assert.ok(html[0].every((token) => token.kind === "comment"));
  assert.ok(html[1].some((token) => token.kind === "comment"));
  assert.ok(findToken(html[2], "div", "keyword"));
  assert.ok(findToken(html[2], "class", "property"));
  assert.ok(findToken(html[2], '"card"', "string"));

  const cssLines = ["/* theme", "   rule */", ".card { color: #336699; padding: 12px; }"];
  const css = highlightCodeLines(cssLines, "css");
  assert.ok(css);
  cssLines.forEach((line, i) => assert.equal(flatten(css[i]), line));
  assert.ok(css[0].every((token) => token.kind === "comment"));
  assert.ok(css[1].some((token) => token.kind === "comment"));
  assert.ok(findToken(css[2], "color", "property"));
  assert.ok(findToken(css[2], "12px", "number"));
});
