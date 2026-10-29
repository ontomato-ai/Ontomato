package io.ontomato.dataengine.logging;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.logging.log4j.CloseableThreadContext;
import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.ThreadContext;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.async.CallableProcessingInterceptor;
import org.springframework.web.context.request.async.WebAsyncUtils;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Component
@Order(-300)
public final class ServiceLogFilter extends OncePerRequestFilter implements WebMvcConfigurer {
  private final IdentityService identity;
  public ServiceLogFilter(IdentityService identity) { this.identity = identity; }
  @Override public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(new HandlerInterceptor() {
      @Override public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        Object grant = request.getAttribute(QueryGrantService.ATTRIBUTE);
        if (grant instanceof JSONObject claims) {
          ServiceLogContext.put("userId", claims.getString("userId")); ServiceLogContext.put("domainId", claims.getString("domainId"));
          ServiceLogContext.put("runId", claims.getString("runId"));
          if (claims.getString("sessionId") != null) ServiceLogContext.put("sessionId", claims.getString("sessionId"));
        } else {
          try { ServiceLogContext.user(identity.getCurrentUser()); } catch (RuntimeException ignored) { /* Authentication remains owned by the identity boundary. */ }
        }
        WebAsyncUtils.getAsyncManager(request).registerCallableInterceptor(ServiceLogFilter.class.getName(), new CallableProcessingInterceptor() {
          private Map<String, String> captured;
          private CloseableThreadContext.Instance scope;
          @Override public <T> void beforeConcurrentHandling(NativeWebRequest webRequest, Callable<T> task) { captured = ServiceLogContext.capture(); }
          @Override public <T> void preProcess(NativeWebRequest webRequest, Callable<T> task) { scope = ServiceLogContext.open(captured); }
          @Override public <T> void postProcess(NativeWebRequest webRequest, Callable<T> task, Object result) { if (scope != null) scope.close(); }
        });
        return true;
      }
    });
  }
  @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
    Map<String, String> previous = ServiceLogContext.capture();
    ThreadContext.removeAll(ServiceLogContext.KEYS);
    String correlation = ServiceLogContext.correlation(request.getHeader(ServiceLogContext.header("correlationId")));
    ServiceLogContext.put("correlationId", correlation); response.setHeader(ServiceLogContext.header("correlationId"), correlation);
    for (String field : List.of("runId", "sessionId")) ServiceLogContext.put(field, request.getHeader(ServiceLogContext.header(field)));
    long started = System.nanoTime(); Throwable failure = null;
    try { chain.doFilter(request, response); }
    catch (IOException | ServletException | RuntimeException error) { failure = error; throw error; }
    finally {
      Map<String, String> captured = ServiceLogContext.capture();
      if (!request.getRequestURI().startsWith("/observe/logs") && !request.getRequestURI().equals("/health")) {
        if (request.isAsyncStarted()) {
          AtomicBoolean finished = new AtomicBoolean(), timedOut = new AtomicBoolean();
          AtomicReference<Throwable> error = new AtomicReference<>(failure);
          AsyncListener listener = new AsyncListener() {
            @Override public void onComplete(AsyncEvent event) {
              if (finished.compareAndSet(false, true)) complete(request, response, captured, started, error.get(), timedOut.get());
            }
            @Override public void onError(AsyncEvent event) { error.set(event.getThrowable()); }
            @Override public void onTimeout(AsyncEvent event) { timedOut.set(true); }
            @Override public void onStartAsync(AsyncEvent event) { event.getAsyncContext().addListener(this); }
          };
          try { request.getAsyncContext().addListener(listener); }
          catch (IllegalStateException completed) { if (finished.compareAndSet(false, true)) complete(request, response, captured, started, failure, false); }
        } else complete(request, response, captured, started, failure, false);
      }
      ThreadContext.removeAll(ServiceLogContext.KEYS); ThreadContext.putAll(previous);
    }
  }
  private void complete(HttpServletRequest request, HttpServletResponse response, Map<String, String> context, long started, Throwable error, boolean timedOut) {
    try (var ignored = ServiceLogContext.open(context)) {
      int status = response.getStatus();
      Map<String, Object> fields = new HashMap<>();
      fields.put("method", request.getMethod()); fields.put("path", request.getRequestURI());
      fields.put("status", error != null && !response.isCommitted() ? null : status);
      fields.put("durationMs", (System.nanoTime() - started) / 1_000_000);
      fields.put("outcome", timedOut ? "cancelled" : error != null || status >= 400 ? "failure" : "success");
      ServiceLogEvents.emit("http", error != null || status >= 500 ? Level.ERROR : status >= 400 || timedOut ? Level.WARN : Level.INFO,
        "http", "request completed", fields, error);
    }
  }
}
