import { z } from "zod";
import { agentHostAgentSchema } from "./agent-host";

export const appBuilderBootstrapSchema = z.object({ agent: agentHostAgentSchema }).strict();
export type AppBuilderBootstrap = z.infer<typeof appBuilderBootstrapSchema>;
