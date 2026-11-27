package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.service.PreviewExecution;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

/** The preview write boundary: default refusal, declared read/sandbox entries unaffected. */
class PreviewWriteGuardTest {

  static class Fixture {
    @PreviewAccess
    public void read() {}
    public void write() {}
    @SuppressWarnings("unused")
    public void annotated() { read(); }
  }

  private final PreviewWriteGuard guard = new PreviewWriteGuard();

  private static HandlerMethod handler(String name) throws Exception {
    Method method = Fixture.class.getMethod(name);
    return new HandlerMethod(new Fixture(), method);
  }

  private static MockHttpServletRequest preview() {
    var request = new MockHttpServletRequest("POST", "/fixture");
    request.addHeader(PreviewExecution.HEADER, "{\"kind\":\"preview\"}");
    return request;
  }

  @Test
  void refusesUndeclaredEntriesUnderPreview() throws Exception {
    var response = new MockHttpServletResponse();
    assertFalse(guard.preHandle(preview(), response, handler("write")));
    assertEquals(422, response.getStatus());
    var body = com.alibaba.fastjson2.JSON.parseObject(response.getContentAsString());
    assertEquals("PREVIEW_WRITE_FORBIDDEN", body.getString("code"));
    assertEquals(PreviewExecution.WRITE_MESSAGE, body.getString("message"));
  }

  @Test
  void admitsDeclaredEntriesAndIgnoresNonPreviewTraffic() throws Exception {
    assertTrue(guard.preHandle(preview(), new MockHttpServletResponse(), handler("read")));
    var plain = new MockHttpServletRequest("POST", "/fixture");
    assertTrue(guard.preHandle(plain, new MockHttpServletResponse(), handler("write")));
    // A malformed or non-preview header is not a preview identity and does not engage the boundary.
    var malformed = new MockHttpServletRequest("POST", "/fixture");
    malformed.addHeader(PreviewExecution.HEADER, "not-json");
    assertTrue(guard.preHandle(malformed, new MockHttpServletResponse(), handler("write")));
    // Non-handler traffic (static resources) is unaffected.
    assertTrue(guard.preHandle(preview(), new MockHttpServletResponse(), new Object()));
  }

  @Test
  void annotationIsDetectableOnFixture() throws Exception {
    assertNotNull(AnnotatedElementUtils.findMergedAnnotation(Fixture.class.getMethod("read"), PreviewAccess.class));
    assertNull(AnnotatedElementUtils.findMergedAnnotation(Fixture.class.getMethod("write"), PreviewAccess.class));
  }
}
