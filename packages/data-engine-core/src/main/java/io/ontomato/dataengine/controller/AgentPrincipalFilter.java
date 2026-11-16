package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.AgentPrincipalService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;

/** An agent credential reaches governed execution interfaces, never administrative endpoints. */
@Component
@Order(-210)
public class AgentPrincipalFilter extends OncePerRequestFilter {
    private final AgentPrincipalService principals;
    public AgentPrincipalFilter(AgentPrincipalService principals){this.principals=principals;}
    public static boolean allowed(String path){return java.util.Set.of("/ontology/query/overview","/ontology/query/schema","/ontology/query/execute-dsl","/ontology/query/metrics/describe","/ontology/query/metrics/execute","/ontology/query/metrics/parameter-form","/ontology/query/metrics/parse-parameters","/metricView/queryById","/metricView/execute","/action/queryById","/action/form","/action/execute","/data/queryInfoByNode").contains(path);}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException {
        String token=request.getHeader("tk");
        if(token!=null&&token.startsWith("ap1."))try{
            if(!allowed(request.getRequestURI()))throw AgentPrincipalService.denied("Agent credential cannot call this interface");
            if(request.getHeader(io.ontomato.dataengine.service.BuildTestContextService.HEADER)!=null)throw AgentPrincipalService.denied("Agent execution cannot adopt a user build context");
            request.setAttribute(AgentPrincipalService.ATTRIBUTE,principals.verify(token));
        }catch(ResponseStatusException failure){response.setStatus(failure.getStatusCode().value());response.setContentType("application/json");response.getWriter().write("{\"error\":{\"code\":\"AGENT_PRINCIPAL_REJECTED\",\"message\":\"Agent execution credential rejected\"}}");return;}
        chain.doFilter(request,response);
    }
}
