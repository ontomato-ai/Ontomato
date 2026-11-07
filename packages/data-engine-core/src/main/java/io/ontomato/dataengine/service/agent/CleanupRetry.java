package io.ontomato.dataengine.service.agent;

import java.util.HashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * In-memory retry pacing for generation cleanup. Each run backs off independently after a
 * failure, and a confirmed cleanup drops its state so a later run failure starts fresh.
 */
final class CleanupRetry {
  static final long BASE_DELAY_MS = 1_000;
  static final long MAX_DELAY_MS = 300_000;
  private final LongSupplier clock;
  private final Map<String, Attempt> attempts = new HashMap<>();

  CleanupRetry() {
    this(System::currentTimeMillis);
  }

  CleanupRetry(LongSupplier clock) {
    this.clock = clock;
  }

  /** Whether the run may be attempted now; an unknown run is always due. */
  synchronized boolean due(String run) {
    Attempt attempt = attempts.get(run);
    return attempt == null || clock.getAsLong() >= attempt.nextAttemptAt();
  }

  /**
   * Records a failure and returns whether it is the first failure or a different reason from the
   * previous one, which is when the caller should warn.
   */
  synchronized boolean failed(String run, String reason) {
    Attempt previous = attempts.get(run);
    int failures = previous == null ? 1 : previous.failures() + 1;
    attempts.put(
        run, new Attempt(failures, clock.getAsLong() + delayMillis(failures), reason));
    return previous == null || !previous.reason().equals(reason);
  }

  /** A confirmed cleanup clears both the backoff and the remembered failure reason. */
  synchronized void succeeded(String run) {
    attempts.remove(run);
  }

  static long delayMillis(int failures) {
    int shift = Math.min(Math.max(failures - 1, 0), 9);
    return Math.min(MAX_DELAY_MS, BASE_DELAY_MS << shift);
  }

  private record Attempt(int failures, long nextAttemptAt, String reason) {}
}
