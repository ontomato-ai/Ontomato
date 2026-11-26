package io.ontomato.dataengine.service.vector;

import com.alibaba.fastjson2.JSONObject;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import io.ontomato.dataengine.service.ai.EmbeddingSelection;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.dao.VectorRebuildItem;
import io.ontomato.dataengine.dao.VectorRebuildState;
import io.ontomato.dataengine.dao.VectorRebuildState.ItemType;
import io.ontomato.dataengine.dao.VectorRebuildState.Phase;
import io.ontomato.dataengine.dao.VectorRebuildState.Status;
import io.ontomato.dataengine.dao.VectorRebuildStateDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.EmbeddingService;

import lombok.extern.slf4j.Slf4j;

/**
 * The in-service vector rebuild of one domain. Changing the generation of a domain that has data
 * starts a pending round; a round clears every vector once, then fills the rows whose vector is
 * NULL. Pausing, a failure or a restart keeps the filled rows, so the next start of the same
 * generation continues with the remaining ones using the key and timeout configured at that time.
 */
@Slf4j
@Service
public class VectorRebuildService {

    @Autowired
    private BusinessConfigService businessConfigService;

    @Autowired
    private EmbeddingService embeddingService;

    @Autowired
    private LangService langService;

    @Autowired
    private VectorRebuildTracker rebuildTracker;

    @Autowired
    private VectorRetrievalGate retrievalGate;

    @Autowired
    private VectorRebuildStateDao stateDao;

    @Autowired
    private VectorRebuildSources vectorSources;

    public VectorRebuildStatus status(String domainId) {
        VectorRetrievalGate.Snapshot snapshot;
        try {
            snapshot = retrievalGate.snapshot(domainId);
        } catch (AgentHttpException error) {
            if (!"MODEL_NOT_CONFIGURED".equals(error.code())) throw error;
            return VectorRebuildStatus.unconfigured();
        }
        int total = 0;
        int pending = 0;
        for (var source : vectorSources.forDomain(domainId)) {
            total += source.rows().getAsInt();
            pending += source.pending().getAsInt();
        }
        boolean empty = total == 0;
        boolean running = rebuildTracker.isRunning(domainId);
        VectorRebuildState state = snapshot.effective(() -> running, () -> empty);
        if (!running && state.getStatus() == Status.RUNNING) {
            // A round may have finished while the counts were read, before the live-run snapshot.
            state = retrievalGate.snapshot(domainId).effective(() -> running, () -> empty);
        }
        VectorRebuildStatus status = new VectorRebuildStatus();
        status.setState(reported(domainId, state.getStatus(), running));
        status.setTotal(total);
        // Before the clear, the stored vectors belong to another generation and count as not done.
        status.setDone(state.isCleared() ? total - pending : 0);
        status.setError(status.getState() == VectorRebuildStatus.State.FAILED ? state.getError() : null);
        return status;
    }

    private VectorRebuildStatus.State reported(String domainId, Status status, boolean running) {
        if (running) {
            return rebuildTracker.isPauseRequested(domainId)
                    ? VectorRebuildStatus.State.PAUSING
                    : VectorRebuildStatus.State.RUNNING;
        }
        return switch (status) {
            case READY -> VectorRebuildStatus.State.READY;
            case PENDING -> VectorRebuildStatus.State.PENDING;
            case RUNNING -> VectorRebuildStatus.State.INTERRUPTED;
            case PAUSED -> VectorRebuildStatus.State.PAUSED;
            case FAILED -> VectorRebuildStatus.State.FAILED;
        };
    }

    /** Capture the previous selection for a settings save when no generation was recorded yet. */
    private EmbeddingSelection generationBeforeSettingsChange(String domainId) {
        if (stateDao.find(domainId) != null) return null;
        try {
            return embeddingService.selection(domainId);
        } catch (AgentHttpException error) {
            if (!"MODEL_NOT_CONFIGURED".equals(error.code())) throw error;
            return null;
        }
    }

    /** Reconcile a configured selection on startup. */
    public void modelSettingsChanged(String domainId) {
        boolean pending = rebuildTracker.exclusively(domainId, () -> reconcileSelection(domainId, null));
        if (pending) start(domainId, businessConfigService.get(domainId).getLang());
    }

    private record SettingsSave(JSONObject settings, boolean pending) {}

    /** Keep the runtime selection change and its vector state inside the existing generation boundary. */
    public JSONObject saveModelSettings(String domainId, VectorRebuildTracker.Change<JSONObject, Exception> save) throws Exception {
        var result = rebuildTracker.exclusively(domainId, () -> {
            var previous = generationBeforeSettingsChange(domainId);
            var saved = save.run();
            return new SettingsSave(saved, saved.getString("embeddingModel") != null && reconcileSelection(domainId, previous));
        });
        if (result.pending()) start(domainId, businessConfigService.get(domainId).getLang());
        return result.settings();
    }

    private boolean reconcileSelection(String domainId, EmbeddingSelection previous) {
        if (rebuildTracker.isRunning(domainId)) return false;
        var snapshot = retrievalGate.snapshot(domainId);
        if (snapshot.recorded() == null && previous != null) {
            snapshot = new VectorRetrievalGate.Snapshot(snapshot.generation(),
                    VectorRebuildState.of(previous, Status.READY, true));
        }
        var state = snapshot.effective(() -> false, () -> vectorSources.isEmpty(domainId));
        stateDao.save(domainId, state);
        return state.getStatus() == Status.PENDING;
    }

    /** Start a new round or continue the current one in the background, and return at once. */
    public void start(String domainId, String lang) {
        rebuildTracker.exclusively(domainId, () -> {
            var snapshot = retrievalGate.snapshot(domainId);
            var state = snapshot.effective(() -> rebuildTracker.isRunning(domainId), () -> vectorSources.isEmpty(domainId));
            if (state.getStatus() == Status.READY) {
                throw new IllegalStateException(langService.get(lang, "Vector.rebuildNotNeeded"));
            }
            if (!rebuildTracker.tryStart(domainId)) {
                throw new IllegalStateException(langService.get(lang, "Vector.rebuildAlreadyRunning"));
            }
            EmbeddingSelection properties = snapshot.generation();
            VectorRebuildState running = VectorRebuildState.of(properties, Status.RUNNING, state.isCleared());
            try {
                stateDao.save(domainId, running);
            } catch (RuntimeException e) {
                rebuildTracker.finish(domainId);
                throw e;
            }
            Thread thread = new Thread(() -> run(domainId, properties, running), "vector-rebuild-" + domainId);
            thread.setDaemon(true);
            thread.start();
            return null;
        });
    }

    /** Ask the running round to stop after its current item. */
    public void pause(String domainId, String lang) {
        if (!rebuildTracker.requestPause(domainId)) {
            throw new IllegalStateException(langService.get(lang, "Vector.rebuildNotRunning"));
        }
    }

    /**
     * Run a round synchronously with the configuration read at start: clear once unless the state
     * records that this generation already cleared, then fill each pending row. A row written
     * meanwhile already holds a vector of this generation and is left as written.
     */
    void run(String domainId, EmbeddingSelection properties, VectorRebuildState state) {
        Phase phase = Phase.CLEAR;
        ItemType itemType = null;
        String itemId = null;
        try {
            if (!state.isCleared()) {
                vectorSources.clear(domainId);
                // Recorded only after every table is cleared: an interrupted clear runs again in full.
                state.setCleared(true);
                stateDao.save(domainId, state);
            }
            phase = Phase.READ;
            for (var source : vectorSources.forDomain(domainId)) {
                phase = Phase.READ;
                itemType = source.type();
                itemId = null;
                for (VectorRebuildItem item : source.listPending().get()) {
                    if (rebuildTracker.isPauseRequested(domainId)) {
                        state.setStatus(Status.PAUSED);
                        stateDao.save(domainId, state);
                        return;
                    }
                    itemId = source.table() == null ? item.getId() : source.table() + "/" + item.getId();
                    phase = Phase.EMBED;
                    float[] vector = embeddingService.embedWith(properties, item.getText(), domainId);
                    phase = Phase.SAVE;
                    source.fill().accept(item, vector);
                }
            }
            state.setStatus(Status.READY);
            stateDao.save(domainId, state);
        } catch (Exception e) {
            String reason = "Runtime embedding or vector storage failed (" + e.getClass().getSimpleName() + ")";
            // Only the redacted reason is logged: the raw exception and its causes may carry the key or headers.
            log.error("Vector rebuild of domain {} failed at {} {} {} ({}): {}", domainId, phase, itemType, itemId,
                    e.getClass().getName(), reason);
            VectorRebuildState.Failure failure = new VectorRebuildState.Failure();
            failure.setPhase(phase);
            failure.setItemType(phase == Phase.CLEAR ? null : itemType);
            failure.setItemId(itemId);
            failure.setReason(reason);
            state.setStatus(Status.FAILED);
            state.setError(failure);
            try {
                stateDao.save(domainId, state);
            } catch (RuntimeException saveError) {
                // The state stays RUNNING and is reported as interrupted.
                log.error("Recording the vector rebuild failure of domain {} failed", domainId, saveError);
            }
        } finally {
            rebuildTracker.finish(domainId);
        }
    }

}
