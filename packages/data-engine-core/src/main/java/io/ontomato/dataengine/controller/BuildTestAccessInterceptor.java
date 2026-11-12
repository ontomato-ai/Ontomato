package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.BuildTestContextService;
import io.ontomato.dataengine.service.QueryGrantService;
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
 * Rejects a build-test request before any controller, query service or executor runs unless the
 * matched controller method declares how it handles test data.
 */
@Component
public class BuildTestAccessInterceptor implements HandlerInterceptor {
  public static final String CODE = "BUILD_TEST_UNSUPPORTED";
  static final String MESSAGE = "这个接口不支持测试数据";

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
      throws IOException {
    if (request.getHeader(BuildTestContextService.HEADER) == null) return true;
    var declaration = handler instanceof HandlerMethod method
        ? AnnotatedElementUtils.findMergedAnnotation(method.getMethod(), BuildTestAccess.class)
        : null;
    if (declaration == null || declaration.value() == BuildTestAccess.Access.TEST_DATA
        && hasContextGrant(request)) {
      reject(response);
      return false;
    }
    return true;
  }

  /** A query grant and an execution context are two authorities; this request must not merge them. */
  private static boolean hasContextGrant(HttpServletRequest request) {
    return request.getAttribute(QueryGrantService.ATTRIBUTE) instanceof JSONObject grant
        && grant.getString("contextId") != null;
  }

  private static void reject(HttpServletResponse response) throws IOException {
    response.setStatus(HttpStatus.UNPROCESSABLE_ENTITY.value());
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setCharacterEncoding("UTF-8");
    response
        .getWriter()
        .write(
            JSON.toJSONString(
                Map.of("success", false, "code", CODE, "message", MESSAGE)));
  }
}
