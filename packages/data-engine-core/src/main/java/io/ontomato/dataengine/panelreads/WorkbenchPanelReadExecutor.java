package io.ontomato.dataengine.panelreads;

import static java.util.concurrent.TimeUnit.NANOSECONDS;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Component
final class WorkbenchPanelReadExecutor {
    private static final int CONCURRENCY = 5;
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(CONCURRENCY, CONCURRENCY, 0,
        NANOSECONDS, new LinkedBlockingQueue<>());
    private final PlatformTransactionManager transactions;
    private final JdbcTemplate jdbc;

    WorkbenchPanelReadExecutor(PlatformTransactionManager transactions, JdbcTemplate jdbc) {
        this.transactions = transactions;
        this.jdbc = jdbc;
    }

    <T> CompletableFuture<T> submit(long deadline, Supplier<T> read) {
        return enqueue(deadline, () -> inReadTransaction(deadline, read));
    }

    CompletableFuture<WorkbenchPanelReadsController.ItemResult> submitProductGraph(
            long deadline, Supplier<WorkbenchPanelReadsController.ItemResult> read) {
        // The graph uses the same worker slot and deadline, with each owner fact in its own read transaction.
        return enqueue(deadline, read);
    }

    private <T> CompletableFuture<T> enqueue(long deadline, Supplier<T> read) {
        var result = new CompletableFuture<T>();
        Runnable task = () -> {
            if (result.isDone()) return;
            try {
                result.complete(read.get());
            } catch (RuntimeException | Error e) {
                result.completeExceptionally(e);
            }
        };
        result.orTimeout(Math.max(0, deadline - System.nanoTime()), NANOSECONDS).whenComplete((value, failure) -> {
            if (failure instanceof TimeoutException) workers.remove(task);
        });
        if (!result.isDone()) {
            workers.execute(task);
            if (result.isDone()) workers.remove(task);
        }
        return result;
    }

    <T> T inReadTransaction(long deadline, Supplier<T> read) {
        var tx = new TransactionTemplate(transactions);
        tx.setReadOnly(true);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return tx.execute(status -> {
            var remaining = deadline - System.nanoTime();
            if (remaining <= 0) throw new org.springframework.transaction.TransactionTimedOutException("Panel read deadline expired");
            // The metadata store is PostgreSQL. The transaction limit covers cumulative SQL (not just one statement).
            // The worker keeps its slot until transaction cleanup, even if the response has already timed out.
            jdbc.queryForObject("SELECT set_config('transaction_timeout', ?, true)", String.class,
                Math.max(1, NANOSECONDS.toMillis(remaining)) + "ms");
            return read.get();
        });
    }

    @PreDestroy
    void close() {
        workers.shutdown();
    }
}
