package io.ontomato.dataengine.service.vector;

import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.VectorRebuildItem;
import io.ontomato.dataengine.dao.VectorRebuildState.ItemType;
import io.ontomato.dataengine.dao.VectorResourceDao;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BiConsumer;
import java.util.function.IntSupplier;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/** The source rows and vector writers for a domain's rebuild. */
@Component
public class VectorRebuildSources {
    private final KnowledgeDao knowledgeDao;
    private final ActionDao actionDao;
    private final MetricViewDao metricViewDao;
    private final VectorResourceDao vectorResourceDao;

    public VectorRebuildSources(KnowledgeDao knowledgeDao, ActionDao actionDao, MetricViewDao metricViewDao,
            VectorResourceDao vectorResourceDao) {
        this.knowledgeDao = knowledgeDao;
        this.actionDao = actionDao;
        this.metricViewDao = metricViewDao;
        this.vectorResourceDao = vectorResourceDao;
    }

    record Source(ItemType type, String table, IntSupplier rows, IntSupplier pending,
            Supplier<List<VectorRebuildItem>> listPending, BiConsumer<VectorRebuildItem, float[]> fill) {}

    boolean isEmpty(String domainId) {
        return forDomain(domainId).stream().noneMatch(source -> source.rows().getAsInt() > 0);
    }

    void clear(String domainId) {
        knowledgeDao.clearDomainVectors(domainId);
        actionDao.clearDomainVectors(domainId);
        metricViewDao.clearDomainVectors(domainId);
        vectorResourceDao.clearDomainVectors(domainId);
    }

    List<Source> forDomain(String domainId) {
        List<Source> sources = new ArrayList<>();
        sources.add(new Source(ItemType.KNOWLEDGE, null,
                () -> knowledgeDao.countDomainRows(domainId), () -> knowledgeDao.countDomainPending(domainId),
                () -> knowledgeDao.listDomainPending(domainId),
                (item, vector) -> knowledgeDao.fillDomainVector(item.getId(), vector)));
        sources.add(new Source(ItemType.ACTION, null,
                () -> actionDao.countDomainRows(domainId), () -> actionDao.countDomainPending(domainId),
                () -> actionDao.listDomainPending(domainId),
                (item, vector) -> actionDao.fillDomainVector(item.getId(), item.getText(), vector)));
        sources.add(new Source(ItemType.METRIC_VIEW, null,
                () -> metricViewDao.countDomainRows(domainId), () -> metricViewDao.countDomainPending(domainId),
                () -> metricViewDao.listDomainPending(domainId),
                (item, vector) -> metricViewDao.fillDomainVector(item.getId(), item.getText(), vector)));
        for (String table : vectorResourceDao.listDomainTables(domainId)) {
            sources.add(new Source(ItemType.RESOURCE, table,
                    () -> vectorResourceDao.countTableRows(table), () -> vectorResourceDao.countTablePending(table),
                    () -> vectorResourceDao.listTablePending(table),
                    (item, vector) -> vectorResourceDao.fillTableVector(table, item.getId(), vector)));
        }
        return sources;
    }
}
