package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.impl.PythonExecuteServiceImpl;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class RuntimePythonClientTest {
  @org.junit.jupiter.api.BeforeEach
  void cancellationOwner() throws Exception {
    var entrance = new BackendSessionEntrance();
    org.springframework.test.util.ReflectionTestUtils.setField(
        entrance, "sessionRegistryService", mock(SessionRegistryService.class));
    entrance.publishInstance();
  }

  @Test
  void savedOldProtocolIsRejectedBeforeAnyRuntimeCall() throws Exception {
    RuntimeCodeClient runtime = mock(RuntimeCodeClient.class);
    when(runtime.pythonHelper()).thenReturn("# private fixture helper");
    QueryGrantService grants = mock(QueryGrantService.class);
    var executor = new PythonExecuteServiceImpl(runtime, grants);
    var error =
        assertThrows(
            IllegalArgumentException.class,
            () ->
                executor.execute(
                    "s",
                    "import requests\nprint('old')",
                    1,
                    "en",
                    PythonAuthority.read("u", "d"),
                    new JSONObject(),
                    Map.of()));
    assertTrue(error.getMessage().contains("Convert or regenerate"));
    verifyNoInteractions(runtime, grants);
  }

  @Test
  void newProtocolDelegatesIdentityAndPreservesPartialNullShapedOutput() throws Exception {
    RuntimeCodeClient runtime = mock(RuntimeCodeClient.class);
    when(runtime.pythonHelper()).thenReturn("# private fixture helper");
    QueryGrantService grants = mock(QueryGrantService.class);
    when(runtime.ontologyUrl()).thenReturn("http://ontology");
    when(grants.issue(
            anyString(), anyString(), anyString(), anyString(), anyLong(), anyList(), isNull()))
        .thenReturn("scoped-grant");
    when(runtime.execution(anyString(), anyString()))
        .thenReturn(
            JSONObject.parseObject(
                "{\"status\":\"stopped\",\"exitCode\":0,\"outputs\":[{\"name\":\"stdout\"},{\"name\":\"stderr\"},{\"name\":\"query-status.json\"}]}"));
    when(runtime.output(anyString(), anyString(), eq("stdout")))
        .thenReturn("{\"answer\":[{\"region\":null,\"count\":0,\"valid\":false}]}");
    when(runtime.output(anyString(), anyString(), eq("stderr"))).thenReturn("");
    when(runtime.output(anyString(), anyString(), eq("query-status.json")))
        .thenReturn("{\"truncated\":true,\"rowLimit\":1000,\"truncationHint\":\"Processing cap\"}");
    var result =
        new PythonExecuteServiceImpl(runtime, grants)
            .execute(
                "session",
                "# ontomato-python:2\nfrom query_runtime import execute_dsl",
                1,
                "en",
                PythonAuthority.read("user", "domain"),
                JSONObject.parseObject("{\"date\":null}"),
                Map.of());
    assertTrue(result.getResult().contains("null"));
    assertEquals(1000, result.getPartialQuery().getInteger("rowLimit"));
    var request = ArgumentCaptor.forClass(Object.class);
    verify(runtime)
        .request(
            eq("domain"),
            eq("session"),
            eq("/v1/code-executions"),
            eq("POST"),
            request.capture(),
            anyString());
    JSONObject body = JSONObject.from(request.getValue());
    assertEquals(0, body.getJSONArray("arguments").size());
    assertEquals(
        "scoped-grant",
        body.getJSONObject("environment").getJSONObject("secrets").getString("ONTOMATO_TK"));
    var files = body.getJSONArray("files").stream().map(JSONObject::from).toList();
    assertTrue(files.stream().filter(file -> "parameters.json".equals(file.getString("path")))
        .findFirst().orElseThrow().getString("content").contains("null"));
    assertTrue(files.stream().anyMatch(file -> "query_runtime.py".equals(file.getString("path"))));
    assertTrue(body.getJSONArray("libraries").isEmpty());
    assertFalse(body.getJSONObject("environment").getJSONObject("secrets").containsKey("ONTOMATO_QUERY_TK"));
    verify(grants).revoke(eq("domain"), anyString());
  }

  @Test
  void publishedFunctionUsesRuntimeParametersAndOriginalColumnMasking() throws Exception {
    RuntimeCodeClient runtime = mock(RuntimeCodeClient.class);
    when(runtime.pythonHelper()).thenReturn("# private fixture helper");
    QueryGrantService grants = mock(QueryGrantService.class);
    when(runtime.ontologyUrl()).thenReturn("http://ontology");
    when(grants.issue(
            anyString(), anyString(), anyString(), anyString(), anyLong(), anyList(), isNull()))
        .thenReturn("user-read-fixture");
    when(runtime.execution(anyString(), anyString()))
        .thenReturn(JSONObject.parseObject("{\"status\":\"stopped\",\"exitCode\":0,\"outputs\":[{\"name\":\"stdout\"}]}"));
    when(runtime.output(anyString(), anyString(), eq("stdout")))
        .thenReturn("{\"answer\":[{\"count\":0,\"region\":null,\"valid\":false}]}");
    var function =
        JSONObject.parseObject(
            """
{"id":"published","domainId":"domain","operation":"OPERATION_READ","description":null,"logic":null,
 "parameters":[{"name":"date","type":"TYPE_TIME","sample":null,"value":null,"classNames":null}],
 "returnDef":{"isVoid":false,"value":null,"classNames":["/sales"],"outKeyRefs":[
   {"key":"count","className":"/sales","attrName":"count","asGroupBy":false,"statCal":true},
   {"key":"region","className":"/sales","attrName":"region","asGroupBy":true,"statCal":false},
   {"key":"valid","className":"/sales","attrName":"valid","asGroupBy":false,"statCal":false}]}}
""",
            io.ontomato.dataengine.bean.function.Function.class);
    function.setDomainId("domain");
    function.setCode("# ontomato-python:2\nfrom query_runtime import execute_dsl, parameters");
    var service = new io.ontomato.dataengine.service.impl.ABCProgramServiceImpl();
    org.springframework.test.util.ReflectionTestUtils.setField(
        service, "pythonExecuteService", new PythonExecuteServiceImpl(runtime, grants));
    var permission = new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission();
    permission.setFullData(true);
    var result =
        service.execute("function-session", function, "user", permission, null, "en", 1, "domain");
    var rows = (com.alibaba.fastjson2.JSONArray) result[0];
    assertEquals(0, rows.getJSONObject(0).getIntValue("count"));
    assertNull(rows.getJSONObject(0).get("region"));
    assertEquals(false, rows.getJSONObject(0).get("valid"));
    permission.setFullData(false);
    rows =
        (com.alibaba.fastjson2.JSONArray)
            service
                .execute(
                    "function-session-2", function, "user", permission, null, "en", 1, "domain")[0];
    assertEquals("****", rows.getJSONObject(0).getString("count"));
    verify(grants, times(2))
        .issue(
            eq("user"),
            eq("domain"),
            eq("user-read"),
            anyString(),
            anyLong(),
            eq(java.util.List.of()),
            isNull());
    function.setCode("print('old protocol')");
    assertThrows(
        IllegalArgumentException.class,
        () -> service.execute("old", function, "user", permission, null, "en", 1, "domain"));
  }

  @Test
  void pythonFailureUsesHostQueryEvidenceAndNeverMessageContents() throws Exception {
    // Exercise actual Python traceback formatting without a runtime, database or model.
    var process = new ProcessBuilder("python3", "-c",
        "exec(compile(\"def fail():\\n    raise ValueError('private-value')\\nfail()\\n\", 'program.py', 'exec'))").start();
    String stderr = new String(process.getErrorStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
    assertEquals(1, process.waitFor());
    var runtime = mock(RuntimeCodeClient.class);
    when(runtime.pythonHelper()).thenReturn("# helper");
    when(runtime.ontologyUrl()).thenReturn("http://ontology");
    when(runtime.execution(anyString(), anyString())).thenReturn(JSONObject.parseObject(
        "{\"status\":\"stopped\",\"exitCode\":1,\"errorMessage\":\"private runtime diagnostic\",\"outputs\":[{\"name\":\"stderr\"}]}"));
    when(runtime.output(anyString(), anyString(), eq("stderr"))).thenReturn(stderr);
    var grants = mock(QueryGrantService.class);
    String execution = java.util.UUID.randomUUID().toString();
    when(grants.queryError("domain", execution)).thenReturn("column t.hj_dj does not exist");
    var executor = new PythonExecuteServiceImpl(runtime, grants);
    var result = executor.execute("session", "# ontomato-python:2", 1, "en",
        PythonAuthority.read("user", "domain").forExecution(execution), new JSONObject(), Map.of());
    assertEquals("ValueError，program.py 第 2 行\n查询失败：column t.hj_dj does not exist", result.getError());
    assertNull(result.getResult());
    var programs = new io.ontomato.dataengine.service.impl.ABCProgramServiceImpl();
    assertEquals(result.getError(), assertThrows(Exception.class,
        () -> programs.parsePythonReturn(result.getResult(), result.getError())).getMessage());

    when(runtime.output(anyString(), anyString(), eq("stderr")))
        .thenReturn("RuntimeError: Ontology request failed (500): private-value");
    when(grants.queryError("domain", execution)).thenReturn(null);
    var forged = executor.execute("session", "# ontomato-python:2", 1, "en",
        PythonAuthority.read("user", "domain").forExecution(execution), new JSONObject(), Map.of());
    assertEquals("RuntimeError", forged.getError());
  }

  @Test
  void lostAdmissionResponseClosesExecutionIntent() throws Exception {
    RuntimeCodeClient runtime = mock(RuntimeCodeClient.class);
    when(runtime.pythonHelper()).thenReturn("# private fixture helper");
    QueryGrantService grants = mock(QueryGrantService.class);
    when(runtime.request(
            anyString(), anyString(), eq("/v1/code-executions"), eq("POST"), any(), anyString()))
        .thenThrow(new java.io.IOException("response lost"));
    String id = java.util.UUID.randomUUID().toString();
    assertThrows(
        java.io.IOException.class,
        () ->
            new PythonExecuteServiceImpl(runtime, grants)
                .execute(
                    "s",
                    "print(1)",
                    1,
                    "en",
                    PythonAuthority.calculation("d").forExecution(id),
                    new JSONObject(),
                    Map.of()));
    verify(runtime).closeIntent("d", id);
  }
}
