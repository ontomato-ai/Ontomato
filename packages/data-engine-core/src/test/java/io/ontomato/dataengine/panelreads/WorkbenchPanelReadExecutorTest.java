package io.ontomato.dataengine.panelreads;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import java.util.stream.IntStream;
import org.apache.logging.log4j.ThreadContext;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

class WorkbenchPanelReadExecutorTest {
    @Test
    void deadlinesIncludeQueueAndDoNotFreeAnActiveWorkerBeforeTransactionCleanup() throws Exception {
        var transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        var jdbc = mock(JdbcTemplate.class);
        var executor = new WorkbenchPanelReadExecutor(transactions, jdbc);
        var borrowed = new CountDownLatch(5);
        var release = new CountDownLatch(1);
        Supplier<String> hold = () -> {
            borrowed.countDown();
            await(release);
            return "held";
        };
        try {
            long deadline = System.nanoTime() + SECONDS.toNanos(1);
            var active = IntStream.range(0, 5).mapToObj(i -> executor.submit(deadline, hold)).toList();
            assertTrue(borrowed.await(1, SECONDS));
            var queued = executor.submit(deadline, () -> fail("An expired queued read must not run"));
            for (var read : active)
                assertInstanceOf(TimeoutException.class, assertThrows(CompletionException.class, read::join).getCause());
            assertInstanceOf(TimeoutException.class, assertThrows(CompletionException.class, queued::join).getCause());
            var next = executor.submit(System.nanoTime() + SECONDS.toNanos(5), () -> "ready");
            assertFalse(next.isDone());
            verify(transactions, times(5)).getTransaction(any());
            verify(transactions, never()).commit(any());
            release.countDown();
            assertEquals("ready", next.get(5, SECONDS));
            verify(jdbc, atLeast(6)).queryForObject(eq("SELECT set_config('transaction_timeout', ?, true)"),
                eq(String.class), matches("[1-9][0-9]*ms"));
        } finally {
            release.countDown();
            executor.close();
        }
    }

    @Test
    void propagatesLoggingContextAndClearsItBeforeReusingWorkers() throws Exception {
        var transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        var executor = new WorkbenchPanelReadExecutor(transactions, mock(JdbcTemplate.class));
        var context = Map.of("correlationId", "request-1", "runId", "run-1", "sessionId", "session-1");
        var probed = new CountDownLatch(5);
        try {
            long deadline = System.nanoTime() + SECONDS.toNanos(10);
            ThreadContext.putAll(context);
            ThreadContext.push("panel-read");
            var reads = IntStream.range(0, 5).mapToObj(i -> executor.submit(deadline, () -> {
                context.forEach((key, value) -> assertEquals(value, ThreadContext.get(key)));
                assertEquals(List.of("panel-read"), ThreadContext.getImmutableStack().asList());
                ThreadContext.put("workerOnly", "local");
                if (i == 0) throw new IllegalStateException("read failed");
                return i;
            })).toList();
            ThreadContext.clearAll();

            assertInstanceOf(IllegalStateException.class,
                    assertThrows(CompletionException.class, reads.getFirst()::join).getCause());
            for (int i = 1; i < reads.size(); i++) {
                assertEquals(i, reads.get(i).get(5, SECONDS));
            }

            var probes = IntStream.range(0, 5).mapToObj(i -> executor.submit(deadline, () -> {
                probed.countDown();
                await(probed);
                assertTrue(ThreadContext.isEmpty());
                assertTrue(ThreadContext.getImmutableStack().isEmpty());
                return null;
            })).toList();
            for (var probe : probes) probe.get(5, SECONDS);
        } finally {
            ThreadContext.clearAll();
            executor.close();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(5, SECONDS));
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError(interrupted);
        }
    }
}
