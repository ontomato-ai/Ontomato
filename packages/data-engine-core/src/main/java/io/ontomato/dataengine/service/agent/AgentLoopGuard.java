package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.HashMap;
import java.util.Map;

/**
 * Detects a generation agent that keeps calling tools without making progress.
 *
 * <p>The generation runtime has no step limit, so a model can spin forever on the same command.
 * The explain agent used to drift one line number per call ({@code sed -n '1,2p;198,212p'}, then
 * {@code 199,212p}, ...), which never matched an exact-repeat check. Two counters are kept: exact
 * calls (name, arguments and result) stop at {@link #MAX_EXACT_CALLS}, while argument shapes with
 * numbers removed stop at the higher {@link #MAX_SHAPE_CALLS}. The whole run is also capped at
 * {@link #MAX_TOOL_CALLS}.
 */
public final class AgentLoopGuard {
  static final int MAX_TOOL_CALLS = 100;
  static final int MAX_EXACT_CALLS = 12;
  static final int MAX_SHAPE_CALLS = 12;

  private AgentLoopGuard() {}

  /** True when the run has exhausted its tool budget or repeated one tool shape too often. */
  public static boolean runaway(JSONObject snapshot) {
    if (snapshot == null) return false;
    JSONArray tools = snapshot.getJSONArray("toolExecutions");
    if (tools == null) return false;
    if (tools.size() > MAX_TOOL_CALLS) return true;

    Map<String, Integer> exact = new HashMap<>();
    Map<String, Integer> shapes = new HashMap<>();
    for (int i = 0; i < tools.size(); i++) {
      JSONObject tool = tools.getJSONObject(i);
      if (tool == null) continue;
      String args = AgentJson.json(tool.get("args"));
      String name = tool.getString("toolName");
      String exactKey = normalize(name) + ":" + args + ":" + AgentJson.json(tool.get("result"));
      if (exact.merge(exactKey, 1, Integer::sum) >= MAX_EXACT_CALLS) return true;
      if (shapes.merge(normalize(name) + ":" + normalize(args), 1, Integer::sum)
          >= MAX_SHAPE_CALLS) return true;
    }
    return false;
  }

  /** Numbers and whitespace are noise for a command that only drifts a line or ID. */
  static String normalize(String value) {
    if (value == null) return "";
    return value.replaceAll("\\d+", "#").replaceAll("\\s+", " ").trim();
  }
}
