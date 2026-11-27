import { z } from "zod";
import { agentInVisibilityRange, allowedAgents } from "./authorization";
import { assistantService } from "./service";
import { assistantStore } from "./store";
import { withScheduledUserActivity } from "./scheduled-activity";
import { HttpError } from "../../utils/errors";
import { checkedForm, completeForm, emptyExecution, instruction, option, scheduledSessionId, select, summarizeFields, type ScheduleApplication, type ScheduleContext } from "../scheduling/application";
import { scheduledConversationStatus } from "../scheduling/conversation";
import type { ObjectVisibilityRange } from "../product-governance/authorization";

function agentOption(agent: { id: string; name: string; enabled: boolean; description: string }, zh?: boolean) {
  return option(agent.id, agent.name, agent.enabled ? null : zh ? "智能体已停用" : "Agent disabled", agent.description);
}

async function agentChoices({ owner, credentials }: ScheduleContext, range?: ObjectVisibilityRange) {
  const zh = credentials.locale?.startsWith("zh");
  const agents = await assistantStore.agents(owner.domainId);
  const visible = range ? agents.filter(agent => agentInVisibilityRange(agent, range, owner.domainId))
    : await allowedAgents(agents, "USE", credentials);
  const options = visible.map(agent => agentOption(agent, zh));
  return { agents, options };
}

function agentFields(zh: boolean | undefined, options: ReturnType<typeof option>[]) {
  return [select("agentId", zh ? "智能体" : "Agent", options), instruction(zh ? "指令" : "Instruction")];
}

export const assistantScheduleApplication: ScheduleApplication = {
  id: "agents",
  description(locale) { return locale?.startsWith("zh") ? "按指令运行一个智能体" : "Run an agent with your instructions"; },
  async authorize() {},
  async describeTargets(contents, context, access) {
    const zh = context.credentials.locale?.startsWith("zh");
    const options = access
      ? (await assistantStore.agentDefinitionSummaries(context.owner.domainId, access.agentUse, { includeSystem: false }))
        .map(agent => agentOption(agent, zh))
      : (await agentChoices(context)).options;
    const fields = agentFields(zh, options);
    const names = new Map(options.map(item => [item.value, item.label]));
    return contents.map(content => ({ name: names.get(content.agentId) ?? null, summary: summarizeFields(fields, content) }));
  },
  async form(input, context, access) {
    const zh = context.credentials.locale?.startsWith("zh");
    const { agents, options } = await agentChoices(context, access?.agentUse);
    const selected = input.values.agentId;
    if (selected && !options.some(entry => entry.value === selected)) {
      const reason = agents.some(agent => agent.id === selected)
        ? zh ? "无权使用该智能体" : "Agent use permission required"
        : zh ? "智能体已不存在" : "Agent no longer exists";
      options.push(option(selected, selected, reason));
    }
    return completeForm("agents", "agents-v1", agentFields(zh, options), input.values);
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
      const created = await assistantService.create(sessionId, context.owner, { agentId: input.content.agentId }, context.credentials, "scheduled");
      try {
        await assistantService.send(sessionId, input.runId, {message:input.content.instruction}, context.owner, context.credentials, "background");
      } catch (error) {
        if (!created.replayed && (await assistantStore.turns(sessionId)).length === 0)
          await assistantService.delete(sessionId, context.owner, context.credentials);
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
