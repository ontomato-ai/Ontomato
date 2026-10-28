package io.ontomato.dataengine.service.vector;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.VectorRebuildItem;
import io.ontomato.dataengine.dao.VectorRebuildState;
import io.ontomato.dataengine.dao.VectorRebuildState.ItemType;
import io.ontomato.dataengine.dao.VectorRebuildState.Phase;
import io.ontomato.dataengine.dao.VectorRebuildState.Status;
import io.ontomato.dataengine.dao.VectorRebuildStateDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
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

    private static final String REDACTED = "***";

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
    private TransactionTemplate transactions;

    @Autowired
    private KnowledgeDao knowledgeDao;

    @Autowired
    private ActionDao actionDao;

    @Autowired
    private MetricViewDao metricViewDao;

    @Autowired
    private VectorResourceDao vectorResourceDao;

    /** One kind of vectorized rows of a domain. */
    private record VectorSource(ItemType type, String table, IntSupplier rows, IntSupplier pending,
            Supplier<List<VectorRebuildItem>> listPending, BiConsumer<VectorRebuildItem, float[]> fill) {
    }

    public VectorRebuildStatus status(String domainId) {
        VectorRebuildState state = retrievalGate.stateOf(domainId, businessConfigService.get(domainId));
        int total = 0;
        int pending = 0;
        for (VectorSource source : sources(domainId)) {
            total += source.rows().getAsInt();
            pending += source.pending().getAsInt();
        }
        if (total == 0 && state.getStatus() != Status.READY && !rebuildTracker.isRunning(domainId)) {
            state = settleEmpty(domainId);
        }
        boolean running = rebuildTracker.isRunning(domainId);
        if (!running && state.getStatus() == Status.RUNNING) {
            // The round may have finished while the counts were read. Confirm its persisted result
            // before reporting an interruption, using the same live-run snapshot below.
            state = retrievalGate.stateOf(domainId, businessConfigService.get(domainId));
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

    /**
     * A domain with no row to vectorize needs no round, whatever state it recorded (an empty domain
     * flagged by an earlier rule included). Judged again with no vector write in flight.
     */
    private VectorRebuildState settleEmpty(String domainId) {
        return rebuildTracker.exclusively(domainId, () -> {
            BusinessConfig businessConfig = businessConfigService.get(domainId);
            VectorRebuildState state = retrievalGate.stateOf(domainId, businessConfig);
            if (state.getStatus() == Status.READY || rebuildTracker.isRunning(domainId) || !isEmpty(domainId)) {
                return state;
            }
            VectorRebuildState ready = VectorRebuildState.of(businessConfig.getEmbeddingModelProperties(), Status.READY, true);
            stateDao.save(domainId, ready);
            return ready;
        });
    }

    /**
     * Save the embedding configuration of this domain, the only writer of it. An empty domain is
     * ready; a new generation makes a domain with data pending a fresh round; the key and timeout
     * never change the state of a domain with data, so a pending or failed round stays as it is.
     * The configuration and its state are written in one transaction.
     */
    public void saveEmbeddingModel(String domainId, String lang, BusinessConfig.EmbeddingModelProperties input) {
        rebuildTracker.exclusively(domainId, () -> {
            if (rebuildTracker.isRunning(domainId)) {
                throw new IllegalStateException(langService.get(lang, "Vector.saveRefusedWhileRebuilding"));
            }
            BusinessConfig businessConfig = businessConfigService.get(domainId);
            BusinessConfig.EmbeddingModelProperties properties = businessConfig.getEmbeddingModelProperties();
            // In getConfig, embeddingModelProperties:null means not configured; in that case create the existing object before writing.
            VectorRebuildState state = null;
            if (properties == null) {
                properties = businessConfig.new EmbeddingModelProperties();
                businessConfig.setEmbeddingModelProperties(properties);
            } else {
                // Judged before the fields change, so a key-only save keeps the state it finds.
                state = retrievalGate.stateOf(domainId, businessConfig);
            }
            properties.setBaseUrl(input.getBaseUrl());
            properties.setApiKey(input.getApiKey());
            properties.setModelName(input.getModelName());
            properties.setDimensions(input.getDimensions());
            properties.setTimeout(input.getTimeout());
            properties.setCustomHeaders(input.getCustomHeaders());
            VectorRebuildState next = isEmpty(domainId)
                    ? VectorRebuildState.of(properties, Status.READY, true)
                    : state == null || !state.sameGeneration(properties)
                            ? VectorRebuildState.of(properties, Status.PENDING, false)
                            : null;
            BusinessConfig.EmbeddingModelProperties saved = properties;
            transactions.executeWithoutResult(transaction -> {
                if (next != null) {
                    stateDao.save(domainId, next);
                }
                businessConfigService.setEmbeddingModel(saved, domainId);
            });
            return null;
        });
    }

    /** Start a new round or continue the current one in the background, and return at once. */
    public void start(String domainId, String lang) {
        rebuildTracker.exclusively(domainId, () -> {
            BusinessConfig businessConfig = businessConfigService.get(domainId);
            VectorRebuildState state = retrievalGate.stateOf(domainId, businessConfig);
            if (state.getStatus() == Status.READY) {
                throw new IllegalStateException(langService.get(lang, "Vector.rebuildNotNeeded"));
            }
            if (!rebuildTracker.tryStart(domainId)) {
                throw new IllegalStateException(langService.get(lang, "Vector.rebuildAlreadyRunning"));
            }
            // Read now, so a key or timeout corrected after a failure is used by the continued round.
            BusinessConfig.EmbeddingModelProperties properties = businessConfig.getEmbeddingModelProperties();
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
    void run(String domainId, BusinessConfig.EmbeddingModelProperties properties, VectorRebuildState state) {
        Phase phase = Phase.CLEAR;
        ItemType itemType = null;
        String itemId = null;
        try {
            if (!state.isCleared()) {
                knowledgeDao.clearDomainVectors(domainId);
                actionDao.clearDomainVectors(domainId);
                metricViewDao.clearDomainVectors(domainId);
                vectorResourceDao.clearDomainVectors(domainId);
                // Recorded only after every table is cleared: an interrupted clear runs again in full.
                state.setCleared(true);
                stateDao.save(domainId, state);
            }
            phase = Phase.READ;
            for (VectorSource source : sources(domainId)) {
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
                    float[] vector = embeddingService.embedWith(properties, item.getText()).content().vector();
                    phase = Phase.SAVE;
                    source.fill().accept(item, vector);
                }
            }
            state.setStatus(Status.READY);
            stateDao.save(domainId, state);
        } catch (Exception e) {
            String reason = redact(e.getMessage() == null ? e.getClass().getName() : e.getMessage(), properties);
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

    /** No row of this domain needs a vector: a new generation needs no round. */
    private boolean isEmpty(String domainId) {
        for (VectorSource source : sources(domainId)) {
            if (source.rows().getAsInt() > 0) {
                return false;
            }
        }
        return true;
    }

    private List<VectorSource> sources(String domainId) {
        List<VectorSource> sources = new ArrayList<>();
        sources.add(new VectorSource(ItemType.KNOWLEDGE, null,
                () -> knowledgeDao.countDomainRows(domainId), () -> knowledgeDao.countDomainPending(domainId),
                () -> knowledgeDao.listDomainPending(domainId),
                (item, vector) -> knowledgeDao.fillDomainVector(item.getId(), vector)));
        sources.add(new VectorSource(ItemType.ACTION, null,
                () -> actionDao.countDomainRows(domainId), () -> actionDao.countDomainPending(domainId),
                () -> actionDao.listDomainPending(domainId),
                (item, vector) -> actionDao.fillDomainVector(item.getId(), item.getText(), vector)));
        sources.add(new VectorSource(ItemType.METRIC_VIEW, null,
                () -> metricViewDao.countDomainRows(domainId), () -> metricViewDao.countDomainPending(domainId),
                () -> metricViewDao.listDomainPending(domainId),
                (item, vector) -> metricViewDao.fillDomainVector(item.getId(), item.getText(), vector)));
        for (String table : vectorResourceDao.listDomainTables(domainId)) {
            sources.add(new VectorSource(ItemType.RESOURCE, table,
                    () -> vectorResourceDao.countTableRows(table), () -> vectorResourceDao.countTablePending(table),
                    () -> vectorResourceDao.listTablePending(table),
                    (item, vector) -> vectorResourceDao.fillTableVector(table, item.getId(), vector)));
        }
        return sources;
    }

    /** The reported reason never carries the key or a custom header value of the request. */
    static String redact(String reason, BusinessConfig.EmbeddingModelProperties properties) {
        List<String> secrets = new ArrayList<>();
        secrets.add(properties.getApiKey());
        Map<String, String> headers = properties.getCustomHeaders();
        if (headers != null) {
            secrets.addAll(headers.values());
        }
        String redacted = reason;
        for (String secret : secrets) {
            if (secret != null && !secret.isBlank()) {
                redacted = redacted.replace(secret, REDACTED);
            }
        }
        return redacted;
    }

}
