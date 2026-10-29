import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const source = process.argv[2]?.replace(/^@/, "");
const input = source ? JSON.parse(await readFile(source, "utf8")) : {};
const session = process.env.ONTOMATO_ASSISTANT_SESSION_ID || input.sessionId;
const base = process.env.ONTOMATO_WORKBENCH_URL?.replace(/\/$/, "");
if (!base || !session) throw new Error("Workbench URL and conversation session ID are required");
const response = await fetch(`${base}/api/assistant/sessions/${encodeURIComponent(session)}/export/ppt`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(process.env.ONTOMATO_TK ? { tk: process.env.ONTOMATO_TK } : {}),
    ...(process.env.ONTOMATO_API_KEY ? { "x-api-key": process.env.ONTOMATO_API_KEY } : {}),
    "Accept-Language": process.env.ONTOMATO_LANGUAGE || "en",
  },
  body: "{}",
});
if (!response.ok) throw new Error(`PPT export failed (${response.status}): ${await response.text()}`);
const root = process.env.ONTOMATO_OUTPUT_DIR || "outputs";
await mkdir(root, { recursive: true });
await mkdir("work", { recursive: true });
const temporary = path.join("work", randomUUID() + ".tmp");
const output = path.join(root, "conversation.pptx");
try {
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
  await rename(temporary, output);
} finally { await rm(temporary, { force: true }); }
console.log(path.relative(process.cwd(), path.resolve(output)));
