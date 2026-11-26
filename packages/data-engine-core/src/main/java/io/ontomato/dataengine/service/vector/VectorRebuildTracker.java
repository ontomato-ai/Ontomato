package io.ontomato.dataengine.service.vector;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Supplier;

import org.springframework.stereotype.Component;

/**
 * The in-process side of the vector rebuild per domain: whether a run is alive, whether a pause was
 * requested, and the lock between vector writes or searches and generation changes. A single instance holds it,
 * so a restart leaves no live run and the persisted state reports the round as interrupted.
 */
@Component
public class VectorRebuildTracker {

    private static class Entry {
        private boolean running;
        private boolean pauseRequested;
        // Fair, so a generation change is not postponed indefinitely by a stream of writes.
        private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock(true);
    }

    private final ConcurrentHashMap<String, Entry> entries = new ConcurrentHashMap<>();

    private Entry entryOf(String domainId) {
        return entries.computeIfAbsent(domainId, key -> new Entry());
    }

    public boolean isRunning(String domainId) {
        Entry entry = entries.get(domainId);
        if (entry == null) return false;
        synchronized (entry) {
            return entry.running;
        }
    }

    public boolean isPauseRequested(String domainId) {
        Entry entry = entries.get(domainId);
        if (entry == null) return false;
        synchronized (entry) {
            return entry.pauseRequested;
        }
    }

    /** Claim the single run of this domain; false when one is alive. */
    public boolean tryStart(String domainId) {
        Entry entry = entryOf(domainId);
        synchronized (entry) {
            if (entry.running) {
                return false;
            }
            entry.running = true;
            entry.pauseRequested = false;
            return true;
        }
    }

    /** Ask the live run to stop before its next item; false when none is alive. */
    public boolean requestPause(String domainId) {
        Entry entry = entryOf(domainId);
        synchronized (entry) {
            if (!entry.running) {
                return false;
            }
            entry.pauseRequested = true;
            return true;
        }
    }

    public void finish(String domainId) {
        Entry entry = entryOf(domainId);
        synchronized (entry) {
            entry.running = false;
            entry.pauseRequested = false;
        }
    }

    /**
     * Run a vector write or an admitted search under the shared side: a generation change waits until
     * it has finished, so no vector of the previous generation lands after the change and no search
     * compares a query vector of one generation with rows of another.
     */
    public <T> T shared(String domainId, Supplier<T> body) {
        return locked(entryOf(domainId).lock.readLock(), body::get);
    }

    /** Change the generation or claim the run with no vector write or search in flight. */
    public <T, E extends Exception> T exclusively(String domainId, Change<T, E> change) throws E {
        return locked(entryOf(domainId).lock.writeLock(), change);
    }

    @FunctionalInterface
    public interface Change<T, E extends Exception> {
        T run() throws E;
    }

    private static <T, E extends Exception> T locked(Lock lock, Change<T, E> body) throws E {
        lock.lock();
        try {
            return body.run();
        } finally {
            lock.unlock();
        }
    }

}
