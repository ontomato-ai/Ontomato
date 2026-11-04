package io.ontomato.dataengine.service.vector;

import java.util.function.Supplier;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.ai.EmbeddingSelection;
import io.ontomato.dataengine.dao.VectorRebuildState;
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

    /**
     * The recorded state of this domain judged against its current configuration. The service writes
     * both in one transaction; a recorded generation that still differs (a record edited outside it,
     * such as a restored or migrated one) counts as a round not yet started for the configured one.
     */
    public VectorRebuildState stateOf(String domainId, BusinessConfig businessConfig) {
        EmbeddingSelection current = embeddingService.selection(domainId);
        VectorRebuildState state = stateDao.find(domainId);
        if (state == null) {
            stateDao.insertIfAbsent(domainId, VectorRebuildState.of(current, VectorRebuildState.Status.READY, true));
            state = stateDao.find(domainId);
        }
        if (!state.sameGeneration(current)) {
            return VectorRebuildState.of(current, VectorRebuildState.Status.PENDING, false);
        }
        return state;
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
        BusinessConfig businessConfig = businessConfigService.get(domainId);
        if (stateOf(domainId, businessConfig).getStatus() != VectorRebuildState.Status.READY) {
            throw new IllegalStateException(langService.get(businessConfig.getLang(), "Vector.rebuildRequired"));
        }
    }

    /** Run a data write that embeds with the current configuration and stores its vector. */
    public <T> T write(String domainId, Supplier<T> embedAndStore) {
        return rebuildTracker.shared(domainId, embedAndStore);
    }

}
