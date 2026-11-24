import { createSessionEngineSandboxFactory } from "@ontomato/agent-runtime/sandbox";
import { startAgentRuntime } from "./application.js";

await startAgentRuntime(createSessionEngineSandboxFactory);
