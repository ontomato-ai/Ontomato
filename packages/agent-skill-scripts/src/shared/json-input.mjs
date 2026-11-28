// Parse a JSON input file so that a syntax error shows where it is, not only a character offset.
import fs from "node:fs";

const WINDOW = 60;

export function parseJsonText(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const position = Number(/position (\d+)/.exec(error.message)?.[1]);
    if (!Number.isInteger(position)) throw new Error(`${source}: ${error.message}`, { cause: error });
    const lineStart = text.lastIndexOf("\n", position - 1) + 1;
    const lineEnd = text.indexOf("\n", position);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const column = position - lineStart;
    const from = Math.max(0, column - WINDOW), to = Math.min(line.length, column + WINDOW);
    const excerpt = (from > 0 ? "…" : "") + line.slice(from, to) + (to < line.length ? "…" : "");
    const caret = " ".repeat(column - from + (from > 0 ? 1 : 0)) + "^";
    throw new Error(`${source}: ${error.message}\n${excerpt}\n${caret}`, { cause: error });
  }
}

/** `@file` reads and parses that file; anything else is parsed as inline JSON. */
export function readJsonArgument(argument) {
  return argument.startsWith("@")
    ? parseJsonText(fs.readFileSync(argument.slice(1), "utf8"), argument.slice(1))
    : parseJsonText(argument, "inline JSON");
}
