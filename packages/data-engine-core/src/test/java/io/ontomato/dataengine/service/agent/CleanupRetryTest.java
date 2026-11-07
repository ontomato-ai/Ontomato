package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class CleanupRetryTest {
  @Test
  void retryDelayGrowsToTheFiveMinuteCap() {
    assertEquals(1_000, CleanupRetry.delayMillis(1));
    assertEquals(2_000, CleanupRetry.delayMillis(2));
    assertEquals(4_000, CleanupRetry.delayMillis(3));
    assertEquals(256_000, CleanupRetry.delayMillis(9));
    assertEquals(300_000, CleanupRetry.delayMillis(10));
    assertEquals(300_000, CleanupRetry.delayMillis(30));
  }

  @Test
  void attemptsWaitForTheBackoffAndWarnOnlyWhenTheReasonChanges() {
    var now = new AtomicLong(1_000);
    var retry = new CleanupRetry(now::get);
    assertTrue(retry.due("run"));
    assertTrue(retry.failed("run", "HTTP 503 DEPENDENCY_UNAVAILABLE"));
    assertFalse(retry.due("run"));
    now.addAndGet(999);
    assertFalse(retry.due("run"));
    now.addAndGet(1);
    assertTrue(retry.due("run"));
    assertFalse(retry.failed("run", "HTTP 503 DEPENDENCY_UNAVAILABLE"));
    now.addAndGet(1_999);
    assertFalse(retry.due("run"));
    now.addAndGet(1);
    assertTrue(retry.due("run"));
    assertTrue(retry.failed("run", "HTTP 500 INTERNAL"));
  }

  @Test
  void aConfirmedCleanupResetsTheBackoff() {
    var now = new AtomicLong();
    var retry = new CleanupRetry(now::get);
    assertTrue(retry.failed("run", "failure"));
    assertFalse(retry.due("run"));
    retry.succeeded("run");
    assertTrue(retry.due("run"));
    assertTrue(retry.failed("run", "failure"));
  }

  @Test
  void runsKeepIndependentBackoff() {
    var now = new AtomicLong();
    var retry = new CleanupRetry(now::get);
    assertTrue(retry.failed("first", "failure"));
    assertFalse(retry.due("first"));
    assertTrue(retry.due("second"));
  }
}
