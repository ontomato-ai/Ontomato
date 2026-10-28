import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
} from "@earendil-works/pi-coding-agent";
const cwd = process.cwd();
const tools = [
  createReadTool(cwd),
  createWriteTool(cwd),
  createEditTool(cwd),
  createBashTool(cwd, { exposeSessionEnvironment: false }),
];
let current;
const send = (value) =>
  new Promise((resolve, reject) =>
    process.send(value, (error) => (error ? reject(error) : resolve())),
  );
process.on("message", async (message) => {
  if (message.type === "cancel") {
    current?.abort();
    return;
  }
  if (message.type !== "execute" || current) return;
  const tool = tools.find((t) => t.name === message.name),
    controller = new AbortController();
  current = controller;
  try {
    if (!tool) throw new Error("Unknown built-in tool");
    const result = await tool.execute(
      message.id,
      message.arguments,
      controller.signal,
      (partial) => {
        void send({ type: "update", id: message.id, result: partial }).catch(
          () => controller.abort(),
        );
      },
    );
    await send({ type: "result", id: message.id, result });
  } catch (error) {
    await send({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    current = undefined;
  }
});
process.on("disconnect", () => {
  current?.abort();
  process.exit(1);
});
await send({
  type: "ready",
  tools: tools.map(({ name, label, description, parameters }) => ({
    name,
    label,
    description,
    parameters,
  })),
});
