package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.QueryPackage;
import io.ontomato.dataengine.service.agent.*;
import io.ontomato.dataengine.service.impl.ActionDraftService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

class OntologyGenerationControllerTest {
  private static Map<String, Object> dslQueryPackage() {
    var manifest = new LinkedHashMap<String, Object>();
    manifest.put("schema", "ontomato.query-package.v1");
    manifest.put("entry", Map.of("kind", "dsl", "query", "main"));
    manifest.put("queries", Map.of("main", "queries/main.json"));
    manifest.put("modules", List.of());
    manifest.put("parameterDefs", List.of());
    manifest.put("parameterBindings", List.of());
    manifest.put("computation", null);

    var file = new LinkedHashMap<String, Object>();
    file.put("path", "queries/main.json");
    file.put("content", "{\"answer\":{\"steps\":[]}}");

    var bundle = new LinkedHashMap<String, Object>();
    bundle.put("manifest", manifest);
    bundle.put("files", List.of(file));
    return bundle;
  }

  private static Map<String, Object> historicalRun() {
    var run = new LinkedHashMap<String, Object>();
    run.put("hostId", "workbench");
    run.put("sessionId", "11111111-1111-1111-1111-111111111111");
    run.put("runId", "22222222-2222-2222-2222-222222222222");
    run.put("ownerId", "user-1");
    run.put("executionUserId", "user-1");
    run.put("domainId", "domain-1");
    run.put("classNames", List.of("person"));
    run.put("expiresAt", 1_900_000_000_000L);
    return run;
  }

  private static Map<String, Object> hostRun() {
    var run = new LinkedHashMap<String, Object>(historicalRun());
    run.put("target", Map.of("kind", "live"));
    return run;
  }

  @Test
  void authoringAdoptPreservesNullComputationInDslQueryPackage() throws Exception {
    var access = mock(OntologyAgentAccess.class);
    var platform = mock(PlatformAuthoringService.class);
    var controller = new OntologyGenerationController(
        mock(OntologyGenerationService.class),
        mock(GenerationOperations.class),
        access,
        mock(OntologyAgentStore.class),
        mock(AgentRuntimeClient.class),
        mock(ActionDraftService.class));
    ReflectionTestUtils.setField(controller, "platform", platform);

    var fn = new LinkedHashMap<String, Object>();
    fn.put("name", "Headcount");
    fn.put("operation", Function.OPERATION_READ);
    fn.put("queryPackage", dslQueryPackage());
    fn.put("sourceArtifact", null);

    var definition = new LinkedHashMap<String, Object>();
    definition.put("id", "metric-1");
    definition.put("name", "Headcount");
    definition.put("description", "Draft description");
    definition.put("function", fn);

    var requestBody = new LinkedHashMap<String, Object>();
    requestBody.put("run", historicalRun());
    requestBody.put("input", Map.of("definition", definition));

    when(platform.operate(eq("metric-view"), eq("adopt"), any(), any(), eq("zh-CN")))
        .thenReturn(JSONObject.of("ok", true));

    controller.authoring("metric-view", "adopt", requestBody, "zh-CN", mock(HttpServletRequest.class));

    var inputCaptor = ArgumentCaptor.forClass(JSONObject.class);
    verify(platform).operate(eq("metric-view"), eq("adopt"), any(), inputCaptor.capture(), eq("zh-CN"));
    JSONObject receivedDefinition = inputCaptor.getValue().getJSONObject("definition");
    JSONObject receivedManifest = receivedDefinition
        .getJSONObject("function")
        .getJSONObject("queryPackage")
        .getJSONObject("manifest");
    assertTrue(receivedManifest.containsKey("computation"));
    assertNull(receivedManifest.get("computation"));

    // Confirm the exact downstream conversion & validation used by PlatformAuthoringService.adoptDefinition passes.
    Function parsed = Function.fromAsset(receivedDefinition);
    assertDoesNotThrow(() -> QueryPackage.accept(parsed.getQueryPackage()));
  }

  @Test
  void authoringAndExternalTestPreserveNullComputationInDslQueryPackage() throws Exception {
    var access = mock(OntologyAgentAccess.class);
    var platform = mock(PlatformAuthoringService.class);
    var caller = mock(OntologyAgentAccess.Context.class);
    when(access.current(any())).thenReturn(caller);

    var controller = new OntologyGenerationController(
        mock(OntologyGenerationService.class),
        mock(GenerationOperations.class),
        access,
        mock(OntologyAgentStore.class),
        mock(AgentRuntimeClient.class),
        mock(ActionDraftService.class));
    ReflectionTestUtils.setField(controller, "platform", platform);

    var testInput = new LinkedHashMap<String, Object>();
    testInput.put("queryPackage", dslQueryPackage());
    testInput.put("columnLabels", Map.of("count", "Count"));

    var platformBody = new LinkedHashMap<String, Object>();
    platformBody.put("run", hostRun());
    platformBody.put("input", testInput);

    when(platform.operate(eq("metric-view"), eq("test"), any(), any(), eq("en")))
        .thenReturn(JSONObject.of("ok", true));
    when(platform.operateExternal(anyString(), eq("metric-view"), eq("test"), any(), eq(caller)))
        .thenReturn(JSONObject.of("ok", true));

    controller.authoring("metric-view", "test", platformBody, "en", mock(HttpServletRequest.class));
    controller.externalAuthoring(
        "22222222-2222-2222-2222-222222222222", "metric-view", "test", testInput, mock(HttpServletRequest.class));

    var platformCaptor = ArgumentCaptor.forClass(JSONObject.class);
    verify(platform).operate(eq("metric-view"), eq("test"), any(), platformCaptor.capture(), eq("en"));
    JSONObject platformManifest = platformCaptor.getValue()
        .getJSONObject("queryPackage")
        .getJSONObject("manifest");
    assertTrue(platformManifest.containsKey("computation"));
    assertNull(platformManifest.get("computation"));

    var externalCaptor = ArgumentCaptor.forClass(JSONObject.class);
    verify(platform).operateExternal(
        eq("22222222-2222-2222-2222-222222222222"), eq("metric-view"), eq("test"), externalCaptor.capture(), eq(caller));
    JSONObject externalManifest = externalCaptor.getValue()
        .getJSONObject("queryPackage")
        .getJSONObject("manifest");
    assertTrue(externalManifest.containsKey("computation"));
    assertNull(externalManifest.get("computation"));
  }
}
