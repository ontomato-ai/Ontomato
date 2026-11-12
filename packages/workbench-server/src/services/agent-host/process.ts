import { runtimeRunSnapshotSchema } from "@ontomato/contracts/agent-runtime";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AgentHostOwner } from "./types";

/** The runtime authorizes the delegation relationship before crossing its host boundary. */
export class ChannelProcessClient {
  readonly runtime: RuntimeClient;
  constructor(owner: AgentHostOwner, readonly session: string, readonly task: string) { this.runtime = new RuntimeClient(owner.domainId, undefined, owner.userId); }
  private path() { return `/v1/channel/sessions/${this.session}/tasks/${this.task}/process`; }
  async run(_session: string, _run: string) { return runtimeRunSnapshotSchema.parse(await this.runtime.request(this.path())); }
  events(_session: string, _run: string, after: { seq: number; streamId: string }, signal: AbortSignal) {
    return this.runtime.channelStream(this.path() + `/events?${new URLSearchParams({ afterSeq: String(after.seq), streamId: after.streamId })}`, signal);
  }
}
