package io.ontomato.dataengine.service.vector;

import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.ai.EmbeddingSelection;
import io.ontomato.dataengine.dao.VectorRebuildState;
import io.ontomato.dataengine.dao.VectorRebuildState.Status;
import io.ontomato.dataengine.dao.VectorRebuildStateDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;

/**
 * Owns the vector readiness of a domain and the boundary that the data access writes go through.
 * Vector search of a domain is allowed only when every vector belongs to the current generation
 * (model reference, dimensions); a running, paused, failed or interrupted round keeps it closed.
 */
@Component
public class VectorRetrievalGate {

    @Autowired
    private BusinessConfigService businessConfigService;

    @Autowired
    private EmbeddingService embeddingService;

    @Autowired
    private VectorRebuildStateDao stateDao;

    @Autowired
    private VectorRebuildTracker rebuildTracker;

    @Autowired
    private LangService langService;

    // The source DAOs use this gate for searches and writes, but their row counts do not enter it.
    @Autowired
    private ObjectProvider<VectorRebuildSources> vectorSources;

    record Snapshot(EmbeddingSelection generation, VectorRebuildState recorded) {
        VectorRebuildState effective(BooleanSupplier running, BooleanSupplier empty) {
            if (recorded == null) return VectorRebuildState.of(generation, Status.READY, true);
            boolean current = recorded.sameGeneration(generation);
            if (current && recorded.getStatus() == Status.READY) return recorded;
            if (!running.getAsBoolean() && empty.getAsBoolean()) return VectorRebuildState.of(generation, Status.READY, true);
            return current ? recorded : VectorRebuildState.of(generation, Status.PENDING, false);
        }
    }

    Snapshot snapshot(String domainId) {
        return new Snapshot(embeddingService.selection(domainId), stateDao.find(domainId));
    }

    public VectorRebuildState effectiveState(String domainId) {
        var snapshot = snapshot(domainId);
        return snapshot.effective(() -> rebuildTracker.isRunning(domainId), () -> vectorSources.getObject().isEmpty(domainId));
    }

    /**
     * Run a vector search of this domain: admitted only when every vector belongs to the current
     * generation, and kept inside the shared side until its query embedding and SQL are done. The
     * refusal is thrown here, before the search's own error handling.
     */
    public <T> T read(String domainId, Supplier<T> search) {
        return rebuildTracker.shared(domainId, () -> {
            requireRetrievable(domainId);
            return search.get();
        });
    }

    /** Throw unless every vector of this domain belongs to the current generation. */
    public void requireRetrievable(String domainId) {
        if (effectiveState(domainId).getStatus() != Status.READY) {
            String lang = businessConfigService.get(domainId).getLang();
            throw new VectorNotReadyException(langService.get(lang, VectorNotReadyException.MESSAGE_KEY));
        }
    }

    /** Run a data write that embeds with the current configuration and stores its vector. */
    public <T> T write(String domainId, Supplier<T> embedAndStore) {
        return rebuildTracker.shared(domainId, embedAndStore);
    }

}
