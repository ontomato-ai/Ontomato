package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.QueryGrantService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Keeps a grant-admitted HTTP operation alive until its Java work has returned, so expiry or
 * orphan cleanup of an action-trial or generation sandbox never collects it mid-request.
 * Runs after QueryGrantFilter, which owns grant verification and binds the claims.
 */
@Component
@Order(-190)
public class SandboxExecutionFilter extends OncePerRequestFilter {
  private final DataSandboxService sandboxes;
  public SandboxExecutionFilter(DataSandboxService sandboxes) { this.sandboxes = sandboxes; }
  @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
    var grant = (JSONObject) request.getAttribute(QueryGrantService.ATTRIBUTE);
    String id = grant == null ? null : grant.getString("sandboxId");
    if (id == null) { chain.doFilter(request, response); return; }
    var lock = sandboxes.lock(id).readLock();
    lock.lock();
    try { chain.doFilter(request, response); } finally { lock.unlock(); }
  }
}
