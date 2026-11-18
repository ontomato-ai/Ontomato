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
  @org.springframework.beans.factory.annotation.Autowired
  private io.ontomato.dataengine.service.agent.AgentExecutionAccess executions;

  public QueryGrantFilter(QueryGrantService grants) {
    this.grants = grants;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String authorization = request.getHeader("tk");
    if (authorization != null && authorization.startsWith("oq.")) {
      try {
        var claims=grants.verify(authorization,request.getHeader("X-Ontomato-Run-Id"),request.getRequestURI());
        if(claims.getString("executionUserId")!=null && (!"knowledge-governance".equals(claims.getString("purpose")) || io.ontomato.dataengine.service.agent.KnowledgeGovernanceService.businessAction(request.getRequestURI().substring(request.getRequestURI().lastIndexOf('/')+1))))
          executions.require(claims.getString("domainId"),claims.getString("userId"));
        request.setAttribute(QueryGrantService.ATTRIBUTE,claims);
      } catch (io.ontomato.dataengine.service.agent.AgentHttpException e) {
        response.setStatus(e.status());response.setContentType("application/json");
        response.getWriter().write(JSON.toJSONString(Map.of("error",Map.of("code",e.code(),"message",e.getMessage()))));
        return;
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
    if (QueryGrantService.requiresWriteGrant(request.getRequestURI())
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
