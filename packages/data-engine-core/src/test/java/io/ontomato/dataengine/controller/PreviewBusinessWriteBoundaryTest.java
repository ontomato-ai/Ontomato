package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.PreviewExecution;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.VectorResourceService;
import io.ontomato.dataengine.service.WriteFunctionOperationService;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * A preview's direct business-data writes: refused when the grant binds live data, admitted inside the action-trial or
 * generation sandbox the grant binds, where the run writes and reads back what it wrote.
 */
class PreviewBusinessWriteBoundaryTest {
  private static final JSONObject LIVE = JSONObject.of("domainId", "d", "purpose", "action-execution",
      "classNames", List.of("person"));
  private static final JSONObject SANDBOX = JSONObject.of("domainId", "d", "purpose", "action-execution",
      "executionKind", "action-trial", "contextId", "sb-1", "sandboxId", "sb-1", "classNames", List.of("person"));

  /** A generation check's grant binds its sandbox alone, with no action-trial context. */
  private static final JSONObject GENERATION = JSONObject.of("domainId", "d", "purpose", "sandbox-write",
      "target", "sandbox", "sandboxId", "gen-1", "classNames", List.of("person"));

  private final WriteFunctionOperationService writes = mock(WriteFunctionOperationService.class);
  private final VectorResourceService vectors = mock(VectorResourceService.class);
  private MockHttpServletResponse response;

  @AfterEach void cleanup() { RequestContextHolder.resetRequestAttributes(); }

  private MockHttpServletRequest preview(JSONObject grant) {
    var request = new MockHttpServletRequest("POST", "/");
    request.addHeader(PreviewExecution.HEADER, "preview");
    request.setAttribute(QueryGrantService.ATTRIBUTE, grant);
    response = new MockHttpServletResponse();
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request, response));
    return request;
  }

  private WriteFunctionOperationController writeController() {
    var controller = new WriteFunctionOperationController();
    ReflectionTestUtils.setField(controller, "writeFunctionOperationService", writes);
    return controller;
  }

  private VectorResourceController vectorController() {
    var controller = new VectorResourceController();
    ReflectionTestUtils.setField(controller, "writes", writes);
    ReflectionTestUtils.setField(controller, "vectorResourceService", vectors);
    return controller;
  }

  private static void assertRefused(org.junit.jupiter.api.function.Executable write) {
    assertThrows(PreviewExecution.Refused.class, write);
  }

  private static JSONObject inserted() {
    return JSONObject.of("className", "person", "objs", JSONArray.of(JSONObject.of("id", "p")));
  }

  private static JSONObject vector() {
    return JSONObject.of("className", "person", "attrName", "photo", "objectId", "p", "path", "/files/p.bin");
  }

  @Test
  void aLiveWriteIsRefusedBeforeItsParametersAreRead() throws Exception {
    var controller = writeController();
    preview(LIVE);
    assertRefused(() -> controller.insert(inserted()));
    for (var body : List.of(new JSONObject(), JSONObject.of("className", "person"))) {
      assertRefused(() -> controller.update(body));
      assertRefused(() -> controller.delete(body));
      assertRefused(() -> controller.createEdge(body));
      assertRefused(() -> controller.deleteEdge(body));
      assertRefused(() -> controller.appendVector(body));
      assertRefused(() -> controller.updateVector(body));
      assertRefused(() -> controller.deleteVector(body));
    }
    var vectorEntry = vectorController();
    var deleting = preview(LIVE);
    assertRefused(() -> vectorEntry.delete(vector(), deleting));
    var uploading = preview(LIVE);
    assertRefused(() -> vectorEntry.upload(null, "text", "person", "photo", "p", null, null, uploading));
    verifyNoInteractions(writes, vectors);
  }

  @Test
  void aSandboxWriteOfThePreviewGoesAhead() throws Exception {
    preview(SANDBOX);
    assertTrue(writeController().insert(inserted()).getBooleanValue("success"));
    verify(writes).insert(eq("person"), any(), eq("sb-1"), eq("d"));
    assertTrue(vectorController().delete(vector(), preview(SANDBOX)).getBooleanValue("success"));
    verify(writes).deleteVector("person", "photo", "p", "p.bin", "sb-1", "d");
    assertEquals(200, response.getStatus());
    verifyNoInteractions(vectors);
  }

  @Test
  void aGenerationSandboxWriteOfThePreviewGoesAheadWithoutAnActionTrialContext() throws Exception {
    assertFalse(QueryGrantService.target(GENERATION).testing());
    preview(GENERATION);
    assertTrue(writeController().insert(inserted()).getBooleanValue("success"));
    verify(writes).insert(eq("person"), any(), eq("gen-1"), eq("d"));
    assertEquals(200, response.getStatus());
  }

  @Test
  void aWriteWithoutThePreviewIdentityIsUnaffected() throws Exception {
    var request = new MockHttpServletRequest("POST", "/");
    request.setAttribute(QueryGrantService.ATTRIBUTE, LIVE);
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request, new MockHttpServletResponse()));
    assertTrue(writeController().insert(inserted()).getBooleanValue("success"));
    verify(writes).insert(eq("person"), any(), isNull(), eq("d"));
  }
}
