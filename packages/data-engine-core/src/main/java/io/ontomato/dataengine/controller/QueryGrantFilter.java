package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.QueryGrantOperation;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.agent.AgentExecutionAccess;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.KnowledgeGovernanceService;
import org.springframework.http.HttpStatus;
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
  private final AgentExecutionAccess executions;
  private final IdentityService identity;

  public QueryGrantFilter(QueryGrantService grants, AgentExecutionAccess executions, IdentityService identity) {
    this.grants = grants;
    this.executions = executions;
    this.identity = identity;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String authorization = request.getHeader("tk");
    var call = QueryGrantOperation.resolve(request.getMethod(), request.getRequestURI());
    if (authorization != null && authorization.startsWith("oq.")) {
      try {
        if (request.getHeader(DataSandboxService.HEADER) != null)
          throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The grant already binds the execution target");
        var claims = grants.verifyRequest(authorization, request.getHeader("X-Ontomato-Run-Id"), call);
        String purpose = claims.getString("purpose");
        String domain = claims.getString("domainId");
        String actor = claims.getString("userId");
        String initiator = claims.getString("initiatorUserId");
        boolean governance = "knowledge-governance".equals(purpose);
        boolean businessActor = !governance || KnowledgeGovernanceService.businessAction(call.bindings().get("action"));
        if (initiator != null && (!actor.equals(initiator) || !businessActor))
          executions.requireMember(domain, initiator);
        if (businessActor) {
          if (claims.getString("executionUserId") != null) executions.require(domain, actor);
          else executions.requireMember(domain, actor);
        }
        if (claims.getBooleanValue("requiresQueryAccess"))
          identity.requireQueryAccess(actor, domain);
        request.setAttribute(QueryGrantService.ATTRIBUTE, claims);
      } catch (AgentHttpException e) {
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
    if (call != null && call.requiresGrant()
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
