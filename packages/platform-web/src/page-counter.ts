import { provide, ref } from "vue";
import type { Router } from "vue-router";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import { pageCounterKey, type PageCounter } from "@ontomato/agent-shell-ui";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { createAssistantClient } from "@ontomato/workbench-ui/features/workbench/assistant-host";
import { readRememberedAgent, readRememberedSession } from "@ontomato/workbench-ui";

/*
 * The one counter a page at its own address sends to (DESIGN.md "Applications and shells"): its agents, the agent this
 * tab last used, and the address that opens the conversation with the page beside it. The pages themselves only show
 * the platform's composer and hand over the message. The platform's layout provides it to the pages under it.
 */
export function providePlatformPageCounter(router: Router) {
  /** Read when a page shows its composer, once per page load: the platform's own pages do not read agents at startup. */
  let counterAgents: Promise<readonly AgentHostAgent[]> | null = null;
  provide(pageCounterKey, {
    agents: () =>
      (counterAgents ??= createAssistantClient()
        .listAgents()
        .then((list) => list.filter((agent) => agent.enabled))),
    // The page's own skill, read from the same directory the conversation's composer reads beside it: a page's refusal
    // (no mapping for this reader, or a registered default that is gone) goes back to the page as what it is.
    pageAgents: (page) => createAssistantClient().listPageAgents(page),
    preferredAgentId: ref(readRememberedAgent()),
    async ask(agentId, text, page, entry) {
      if (entry?.submit) {
        const client = createAssistantClient();
        const held = entry.newSession ? null : readRememberedSession(agentId);
        const sessionId = held && await client.listSessions(agentId, null).then(result => result.sessions.some(session => session.id === held))
          ? held
          : (await client.createSession(agentId)).id;
        await client.send(sessionId, { message: text, ...(entry.pageSkill ? { pageSkillContext: entry.pageSkill } : {}) });
        await router.push({ path: platformRoutes.chat.path, query: { agentId, sessionId, ...(page ? { page } : {}) } });
        return;
      }
      void router.push({
        path: platformRoutes.chat.path,
        query: page ? { agentId, prompt: text, page } : { agentId, prompt: text },
      });
    },
  } satisfies PageCounter);
}
