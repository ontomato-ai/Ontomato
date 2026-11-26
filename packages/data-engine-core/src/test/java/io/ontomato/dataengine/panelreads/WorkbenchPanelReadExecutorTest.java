package io.ontomato.dataengine.panelreads;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import java.util.stream.IntStream;
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

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(5, SECONDS));
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError(interrupted);
        }
    }
}
