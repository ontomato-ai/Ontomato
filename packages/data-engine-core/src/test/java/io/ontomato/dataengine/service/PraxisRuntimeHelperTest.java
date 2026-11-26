package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class PraxisRuntimeHelperTest {
  @Test
  void helpersUseTheServerInjectedPraxisUrlAndCallerToken() throws Exception {
    Path workspace = Files.createTempDirectory("praxis-runtime-helper");
    try (InputStream helper = getClass().getResourceAsStream("/python/query_runtime.py")) {
      assertNotNull(helper);
      Files.copy(helper, workspace.resolve("query_runtime.py"));
    }
    Files.writeString(workspace.resolve("helper_test.py"), """
        import json
        import query_runtime as q

        q.identity = {"loginCode": "xg.pangchao", "domainId": "domain-1"}
        calls = []

        class Response:
            ok = True
            status_code = 200
            text = "{}"

            def json(self):
                return {"id": "run-1", "status": "waiting"}

        def request(method, url, params=None, json=None, headers=None, **kwargs):
            calls.append({
                "method": method,
                "url": url,
                "params": params,
                "body": json,
                "headers": headers,
            })
            return Response()

        q.requests.request = request
        run = q.praxis_start_run(
            "campus_midterm_check_v1",
            inputs={"s1": {"task_id": "task-1"}},
            assignments={"s1": "xg.chencong", "s2": "xg.pangchao"},
            auto=False,
        )
        q.praxis_assign_step("step-1", "xg.chencong")
        q.praxis_decide_step("step-1", "approve", "ok")

        assert run["id"] == "run-1"
        assert calls[0]["method"] == "POST"
        assert calls[0]["url"] == "http://data-agent:3000/api/praxis/runs"
        assert calls[0]["headers"]["tk"] == "caller-token"
        assert calls[0]["headers"]["Authorization"] == "Bearer caller-token"
        assert calls[0]["headers"]["x-ontomato-domain-id"] == "domain-1"
        assert calls[0]["body"]["requester"] == "xg.pangchao"
        assert calls[0]["body"]["assignments"]["s2"] == "xg.pangchao"
        assert calls[1]["body"]["assignedBy"] == "xg.pangchao"
        assert calls[2]["body"]["decider"] == "xg.pangchao"
        assert calls[2]["body"]["verdict"] == "approve"
        print("ok")
        """, StandardCharsets.UTF_8);

    var builder = new ProcessBuilder("python3", "helper_test.py")
        .directory(workspace.toFile())
        .redirectErrorStream(true);
    var environment = builder.environment();
    environment.put("ONTOMATO_ONTOLOGY_URL", "http://ontology");
    environment.put("ONTOMATO_TK", "query-token");
    environment.put("ONTOMATO_PRAXIS_URL", "http://data-agent:3000/api/praxis");
    environment.put("ONTOMATO_CALLER_TK", "caller-token");
    Process process = builder.start();
    process.getOutputStream().close();

    assertTrue(process.waitFor(20, TimeUnit.SECONDS), "Python helper test timed out");
    String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertEquals(0, process.exitValue(), output);
  }
}
