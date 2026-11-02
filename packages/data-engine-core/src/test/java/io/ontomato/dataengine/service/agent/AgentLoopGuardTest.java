package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;

class AgentLoopGuardTest {
  private static JSONObject tool(String command, String result) {
    return JSONObject.of(
        "toolName", "bash",
        "args", JSONObject.of("command", command),
        "result", JSONArray.of(JSONObject.of("text", result)));
  }

  private static JSONArray tools() {
    return new JSONArray();
  }

  @Test
  void catchesTheExplainLoopThatOnlyDriftsOneLineNumber() {
    JSONArray tools = tools();
    for (int line = 198; line < 198 + AgentLoopGuard.MAX_SHAPE_CALLS; line++)
      tools.add(
          tool(
              "cd /work && node generation.mjs source 1 212 | cat -n | sed -n '1,2p;"
                  + line
                  + ",212p'",
              "     1\t# ontomato-python:2\n   207\ttry:\n   208\t    main()\n"));

    assertTrue(AgentLoopGuard.runaway(JSONObject.of("toolExecutions", tools)));
  }

  @Test
  void differentResultsMeanTheAgentIsMakingProgress() {
    JSONArray tools = tools();
    for (int line = 198; line < 208; line++)
      tools.add(
          tool(
              "sed -n '" + line + ",212p' program.py",
              "line " + line + " has different content"));

    assertFalse(AgentLoopGuard.runaway(JSONObject.of("toolExecutions", tools)));
  }

  @Test
  void elevenExactRepeatsAreNotEnough() {
    JSONArray tools = tools();
    for (int i = 0; i < 11; i++) tools.add(tool("cat program.py", "same output"));

    assertFalse(AgentLoopGuard.runaway(JSONObject.of("toolExecutions", tools)));
  }

  @Test
  void totalToolCallsIsCapped() {
    JSONArray tools = tools();
    for (int i = 0; i <= AgentLoopGuard.MAX_TOOL_CALLS; i++)
      tools.add(tool("read " + i, "content " + i));

    assertTrue(AgentLoopGuard.runaway(JSONObject.of("toolExecutions", tools)));
  }

  @Test
  void nullSnapshotIsNotARunaway() {
    assertFalse(AgentLoopGuard.runaway(null));
    assertFalse(AgentLoopGuard.runaway(new JSONObject()));
  }
}
