package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.service.PreviewExecution;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Refuses a preview request before any controller, query service or executor runs unless the
 * matched controller method declares that it never writes live state. Reads are unaffected:
 * annotated entries serve live data exactly as without the preview header.
 */
@Component
public class PreviewWriteGuard implements HandlerInterceptor {

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
      throws IOException {
    if (!PreviewExecution.isPreview(request)) return true;
    // The boundary owns controller endpoints; resource and other non-controller traffic is not a write.
    if (!(handler instanceof HandlerMethod method)) return true;
    if (AnnotatedElementUtils.findMergedAnnotation(method.getMethod(), PreviewAccess.class) != null) return true;
    response.setStatus(HttpStatus.UNPROCESSABLE_ENTITY.value());
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setCharacterEncoding("UTF-8");
    response.getWriter().write(JSON.toJSONString(
        Map.of("success", false, "code", PreviewExecution.WRITE_CODE, "message", PreviewExecution.WRITE_MESSAGE)));
    return false;
  }
}
