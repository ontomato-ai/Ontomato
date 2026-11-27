package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.QueryGrantService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class SandboxExecutionFilterTest {

  @Test
  void generationGrantWithoutContextIdHoldsSandboxReadLockUntilRequestCompletes() throws Exception {
    var sandboxes = new DataSandboxService(null, null, null, null, null, null, null);
    var filter = new SandboxExecutionFilter(sandboxes);
    var request = new MockHttpServletRequest("POST", "/writeFunctionOperation/insert");
    request.setAttribute(QueryGrantService.ATTRIBUTE,
        JSONObject.of("purpose", "sandbox-write", "target", "sandbox", "sandboxId", "gen-sb-1"));

    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var writeLockAcquired = new AtomicBoolean(false);

    Thread worker = new Thread(() -> {
      try {
        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> {
          entered.countDown();
          try {
            assertTrue(release.await(5, TimeUnit.SECONDS));
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ServletException(e);
          }
        });
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
    worker.start();
    assertTrue(entered.await(5, TimeUnit.SECONDS));

    // Cleanup/rebuild acquires writeLock; it must wait while the generation request is in-flight.
    var writeLock = sandboxes.lock("gen-sb-1").writeLock();
    assertFalse(writeLock.tryLock());

    Thread cleaner = new Thread(() -> {
      writeLock.lock();
      try {
        writeLockAcquired.set(true);
      } finally {
        writeLock.unlock();
      }
    });
    cleaner.start();
    Thread.sleep(50);
    assertFalse(writeLockAcquired.get());

    release.countDown();
    worker.join(5000);
    cleaner.join(5000);
    assertTrue(writeLockAcquired.get());
  }

  @Test
  void actionTrialGrantHoldsAndReleasesSandboxReadLockOnFailure() {
    var sandboxes = new DataSandboxService(null, null, null, null, null, null, null);
    var filter = new SandboxExecutionFilter(sandboxes);
    var request = new MockHttpServletRequest("POST", "/ontology/query/execute-dsl");
    request.setAttribute(QueryGrantService.ATTRIBUTE, JSONObject.of(
        "purpose", "action-execution", "executionKind", "action-trial",
        "contextId", "trial-sb-1", "sandboxId", "trial-sb-1"));

    var writeLock = sandboxes.lock("trial-sb-1").writeLock();
    assertThrows(ServletException.class, () -> filter.doFilter(request, new MockHttpServletResponse(),
        (req, res) -> {
          assertFalse(writeLock.tryLock());
          throw new ServletException("boom");
        }));
    assertTrue(writeLock.tryLock());
    writeLock.unlock();
  }

  @Test
  void liveAndUngrantedRequestsSkipSandboxLocking() throws Exception {
    var sandboxes = new DataSandboxService(null, null, null, null, null, null, null);
    var filter = new SandboxExecutionFilter(sandboxes);
    var calls = new int[]{0};
    FilterChain chain = (req, res) -> calls[0]++;

    var live = new MockHttpServletRequest("POST", "/ontology/query/execute-dsl");
    live.setAttribute(QueryGrantService.ATTRIBUTE, JSONObject.of("purpose", "user-read", "target", "live"));
    filter.doFilter(live, new MockHttpServletResponse(), chain);

    filter.doFilter(new MockHttpServletRequest("GET", "/health"), new MockHttpServletResponse(), chain);
    assertEquals(2, calls[0]);
  }
}
