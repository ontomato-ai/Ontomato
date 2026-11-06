import { z } from "zod";
import { assistantService } from "./service";
import { assistantStore } from "./store";
import { withScheduledUserActivity } from "./scheduled-activity";
import { HttpError } from "../../utils/errors";
import { checkedForm, completeForm, emptyExecution, instruction, option, scheduledSessionId, select, type ScheduleApplication } from "../scheduling/application";
import { scheduledConversationStatus } from "../scheduling/conversation";

export const assistantScheduleApplication: ScheduleApplication = {
  id: "agents",
  description(locale) { return locale?.startsWith("zh") ? "按指令运行一个智能体" : "Run an agent with your instructions"; },
  async authorize() {},
  async form(input, { owner, credentials }) {
    const zh = credentials.locale?.startsWith("zh");
    const agents = await assistantStore.agents(owner.domainId, credentials.locale);
    const options = agents.map((agent) => option(agent.id, agent.name, agent.enabled ? null : zh ? "智能体已停用" : "Agent disabled", agent.description));
    const selected = input.values.agentId;
    if (selected && !agents.some((agent) => agent.id === selected))
      options.push(option(selected, selected, zh ? "智能体已不存在" : "Agent no longer exists"));
    return completeForm("agents", "agents-v1", [
      select("agentId", zh ? "智能体" : "Agent", options),
      instruction(zh ? "指令" : "Instruction"),
    ], input.values);
  },
  async validate(input, context) {
    const form = await this.form({ values: input.content, changedField: null, taskId: null, timeZone: input.timeZone }, context);
    const validated = checkedForm(input, form);
    if (!z.string().uuid().safeParse(validated.content.agentId).success)
      throw new HttpError(422, "Invalid agent ID", "TARGET_UNAVAILABLE");
    return validated;
  },
  async start(input, context) {
    await this.validate(input, context);
    const sessionId = scheduledSessionId(input.runId);
    await withScheduledUserActivity(context.owner.userId, async () => {
      const created = await assistantService.create(sessionId, context.owner, { agentId: input.content.agentId }, "scheduled");
      try {
        await assistantService.start(sessionId, input.runId, input.content.instruction, context.owner, context.credentials);
      } catch (error) {
        if (!created.replayed && (await assistantStore.turns(sessionId)).length === 0)
          await assistantService.delete(sessionId, context.owner);
        throw error;
      }
    });
    return { ...emptyExecution(), handle: { sessionId }, resultLink: { appId: "agents", path: `/agents/chat?sessionId=${sessionId}` } };
  },
  async status(input) {
    const sessionId = typeof input.handle?.sessionId === "string" ? input.handle.sessionId : scheduledSessionId(input.runId);
    return scheduledConversationStatus(assistantService, input.owner, sessionId, input.runId, "agents", `/agents/chat?sessionId=${sessionId}`);
  },
};
