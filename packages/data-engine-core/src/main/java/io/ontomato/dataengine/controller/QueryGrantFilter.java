package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.service.QueryGrantService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;

/** Runs outside edition login/permit lists; a runtime grant is never a general login. */
@Component
@Order(-200)
public class QueryGrantFilter extends OncePerRequestFilter {
  private final QueryGrantService grants;

  public QueryGrantFilter(QueryGrantService grants) {
    this.grants = grants;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String authorization = request.getHeader("Authorization");
    if (authorization != null && authorization.startsWith("Bearer oq.")) {
      try {
        request.setAttribute(
            QueryGrantService.ATTRIBUTE,
            grants.verify(
                authorization.substring(7),
                request.getHeader("X-Ontomato-Run-Id"),
                request.getRequestURI()));
      } catch (ResponseStatusException e) {
        response.setStatus(e.getStatusCode().value());
        response.setContentType("application/json");
        response
            .getWriter()
            .write(
                JSON.toJSONString(
                    Map.of(
                        "error",
                        Map.of("code", "QUERY_GRANT_REJECTED", "message", e.getReason()))));
        return;
      }
    }
    if (request.getRequestURI().startsWith("/writeFunctionOperation/")
        && request.getAttribute(QueryGrantService.ATTRIBUTE) == null) {
      response.setStatus(401);
      response.setContentType("application/json");
      response
          .getWriter()
          .write(
              "{\"error\":{\"code\":\"QUERY_GRANT_REQUIRED\",\"message\":\"A scoped write grant is"
                  + " required\"}}");
      return;
    }
    chain.doFilter(request, response);
  }
}
