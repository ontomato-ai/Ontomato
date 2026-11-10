package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.service.BuildTestContextService;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Keep an admitted HTTP operation alive until its Java work has returned. */
@Component
@org.springframework.core.annotation.Order(-190)
public class BuildTestExecutionFilter extends OncePerRequestFilter {
  private final BuildTestContextService contexts;
  public BuildTestExecutionFilter(BuildTestContextService contexts) { this.contexts=contexts; }
  @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
    String header=request.getHeader(BuildTestContextService.HEADER), id=null;
    if(header!=null) {
      try { var declaration=JSON.parseObject(header); if(declaration!=null) id=declaration.getString("contextId"); }
      catch(RuntimeException invalid) { response.sendError(400,"BUILD_TEST_CONTEXT_REQUIRED"); return; }
    }
    var grant=(com.alibaba.fastjson2.JSONObject)request.getAttribute(io.ontomato.dataengine.service.QueryGrantService.ATTRIBUTE);
    if(grant!=null && grant.getString("contextId")!=null) id=grant.getString("contextId");
    if(id==null) { chain.doFilter(request,response); return; }
    var lock=contexts.lock(id).readLock();lock.lock();
    try { chain.doFilter(request,response); } finally { lock.unlock(); }
  }
}
