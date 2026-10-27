package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.service.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Java interprets business output; all Python processes belong to the runtime. */
@Service
public class PythonExecuteServiceImpl implements PythonExecuteService {
  private final RuntimeCodeClient runtime;
  private final QueryGrantService grants;

  public PythonExecuteServiceImpl(RuntimeCodeClient runtime, QueryGrantService grants) {
    this.runtime = runtime;
    this.grants = grants;
  }

  @Override
  public PythonExecuteResult execute(
      String sessionId,
      String code,
      int timeoutMinutes,
      String lang,
      PythonAuthority authority,
      JSONObject parameters,
      Map<String, String> inputFiles)
      throws Exception {
    if (authority.domainId() == null)
      throw new IllegalArgumentException("Python execution requires the owning domain");
    if (authority.purpose() != null && !code.contains("# ontomato-python:2"))
      throw new IllegalArgumentException(
          "This saved program uses the retired Python protocol. Convert or regenerate it before"
              + " execution (ontomato-python:2 required).");
    String id =
        authority.executionId() == null ? UUID.randomUUID().toString() : authority.executionId();
    UUID.fromString(id);
    runtime.registerSkill();
    long started = System.currentTimeMillis(), timeout = Math.max(1, timeoutMinutes) * 60000L;
    if (authority.parentGrant() != null)
      timeout = Math.min(timeout, authority.parentGrant().expiresAt() - started);
    if (timeout <= 0) throw new IllegalStateException("Parent query grant expired");
    String token =
        authority.parentGrant() != null
            ? authority.parentGrant().token()
            : authority.purpose() == null
                ? null
                : grants.issue(
                    authority.userId(),
                    authority.domainId(),
                    authority.purpose(),
                    id,
                    started + timeout,
                    authority.classNames(),
                    authority.sandboxId());
    List<Map<String, String>> files = new ArrayList<>();
    files.add(Map.of("path", "program.py", "content", code));
    files.add(
        Map.of(
            "path",
            "parameters.json",
            "content",
            JSON.toJSONString(
                parameters == null ? new JSONObject() : parameters,
                com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue)));
    for (var file : inputFiles.entrySet()) {
      if (file.getKey().equals("program.py") || file.getKey().equals("parameters.json"))
        throw new IllegalArgumentException("Input shadows an execution-owned file");
      files.add(Map.of("path", file.getKey(), "content", file.getValue()));
    }
    JSONObject binding = new JSONObject();
    binding.put("targetUrl", token == null ? null : runtime.ontologyUrl());
    binding.put(
        "credential",
        token == null ? Map.of("kind", "none") : Map.of("kind", "bearer", "value", token));
    binding.put(
        "context",
        authority.parentGrant() == null
            ? Map.of()
            : Map.of("credentialRunId", authority.parentGrant().runId()));
    binding.put(
        "limits", Map.of("wallTimeMs", timeout, "cpuSeconds", Math.max(1, timeoutMinutes) * 60));
    binding.put("libraries", List.of(Map.of("skill", RuntimeCodeClient.SKILL, "path", "python")));
    Map<String, Object> request =
        Map.of(
            "language",
            "python",
            "files",
            files,
            "entry",
            "program.py",
            "arguments",
            List.of(),
            "outputPaths",
            token == null ? List.of() : List.of("query-status.json"),
            "binding",
            binding);
    boolean settled = false;
    try {
      if (Thread.currentThread().isInterrupted() || BackendSessionEntrance.isCancelled(sessionId))
        throw new SessionCancelledException(sessionId);
      runtime.request(authority.domainId(), sessionId, "/v1/code-executions", "POST", request, id);
      JSONObject snapshot;
      while (true) {
        if (Thread.currentThread().isInterrupted() || BackendSessionEntrance.isCancelled(sessionId))
          throw new SessionCancelledException(sessionId);
        if (authority.parentGrant() != null)
          grants.verify(
              authority.parentGrant().token(),
              authority.parentGrant().runId(),
              "/ontology/query/metrics/execute");
        snapshot = runtime.execution(authority.domainId(), id);
        if (!"running".equals(snapshot.getString("status"))) {
          settled = true;
          break;
        }
        if (System.currentTimeMillis() > started + timeout + 1000)
          throw new IllegalStateException("Python execution timed out");
        Thread.sleep(100);
      }
      PythonExecuteResult result = new PythonExecuteResult();
      List<String> outputs = snapshot.getList("outputs", String.class);
      result.setResult(
          outputs.contains("stdout") ? runtime.output(authority.domainId(), id, "stdout") : null);
      result.setError(
          outputs.contains("stderr") ? runtime.output(authority.domainId(), id, "stderr") : null);
      if (!"completed".equals(snapshot.getString("status"))) {
        JSONObject error = snapshot.getJSONObject("error");
        result.setError(
            error == null ? "Python execution did not complete" : error.getString("message"));
      }
      if (outputs.contains("query-status.json")) {
        JSONObject marker =
            JSON.parseObject(runtime.output(authority.domainId(), id, "query-status.json"));
        if (Boolean.TRUE.equals(marker.getBoolean("truncated"))) result.setPartialQuery(marker);
      }
      result.setSpendTime(System.currentTimeMillis() - started);
      return result;
    } finally {
      boolean interrupted = Thread.interrupted();
      try {
        if (!settled) runtime.closeIntent(authority.domainId(), id);
      } finally {
        grants.revoke(authority.domainId(), id);
        if (interrupted) Thread.currentThread().interrupt();
      }
    }
  }
}
