package io.ontomato.dataengine.panelreads;

import static io.ontomato.dataengine.panelreads.WorkbenchPanelReadsController.Status.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.controller.AuthorizationPolicyGovernanceController;
import io.ontomato.dataengine.panelreads.WorkbenchPanelReadsController.ItemResult;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeView;
import io.ontomato.dataengine.service.OntologyQueryService;
import io.ontomato.dataengine.service.QueryAccessService.Access;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ObjectVisibilityRange;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Product graph facts are read sequentially by their existing owners. Workbench owns the graph. */
@Component
final class WorkbenchProductGraphRead implements WorkbenchReadRegistration {
    private final ApplicationCatalog applications;
    private final AuthorizationService authorization;
    private final AuthorizationPolicyGovernanceController grants;
    private final WorkbenchPanelRead.Handler model;
    private final WorkbenchPanelRead.Handler actions;
    private final OntologyQueryService metrics;
    private final WorkbenchPanelReadExecutor executor;

    WorkbenchProductGraphRead(ApplicationCatalog applications, AuthorizationService authorization,
            AuthorizationPolicyGovernanceController grants, @Qualifier("objectTypeRecord") WorkbenchPanelRead model,
            @Qualifier("actionPanelRecord") WorkbenchPanelRead actions, OntologyQueryService metrics,
            WorkbenchPanelReadExecutor executor) {
        this.applications = applications;
        this.authorization = authorization;
        this.grants = grants;
        this.model = model.handler();
        this.actions = actions.handler();
        this.metrics = metrics;
        this.executor = executor;
    }

    @Override public String type() { return "platform:ObjectType"; }
    @Override public String name() { return "productGraph"; }

    boolean acceptsCallerScope() { return true; }

    record References(Set<String> panelIds, Set<String> projectionIds, Set<String> objectTypes,
                      Set<String> actions, Set<String> metrics) {
        static References parse(Map<String, Object> parameters) {
            return new References(ids(parameters, "panelIds"), ids(parameters, "projectionIds"),
                    ids(parameters, "objectTypes"), ids(parameters, "actions"), ids(parameters, "metrics"));
        }

        private static Set<String> ids(Map<String, Object> parameters, String field) {
            if (!(parameters.get(field) instanceof List<?> values))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " must be an array");
            var ids = new LinkedHashSet<String>();
            for (var value : values) {
                if (!(value instanceof String id) || id.isBlank())
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " must contain nonblank IDs");
                ids.add(id);
            }
            return ids;
        }
    }

    record Facts(ItemResult panels, ItemResult projections, ItemResult applications, ItemResult authorization,
                 Map<String, ItemResult> objectTypes, Map<String, ItemResult> actions, Map<String, ItemResult> metrics) {}

    private record ApplicationFacts(ItemResult references, ItemResult grants) {}

    Facts read(SubjectContext subject, References refs, Callable<Access> queryAccess, long deadline) {
        var panels = fact(deadline, false, () -> range(subject, Kind.PANEL, refs.panelIds()));
        var projections = fact(deadline, false, () -> range(subject, Kind.PROJECTION, refs.projectionIds()));
        var directory = applicationFacts(subject, refs.panelIds(), deadline);
        return new Facts(panels, projections, directory.references(), directory.grants(),
            labels(refs.objectTypes(), id -> fact(deadline, false, () -> objectTypeName(subject, id))),
            labels(refs.actions(), id -> fact(deadline, false, () -> actionName(subject, id))),
            metricLabels(refs.metrics(), queryAccess, deadline));
    }

    private ObjectVisibilityRange range(SubjectContext subject, Kind kind, Set<String> candidates) {
        var range = authorization.readObjectRanges(subject, kind, Set.of(Verb.USE)).get(Verb.USE);
        var ids = range.objectIds().stream().filter(candidates::contains).collect(Collectors.toSet());
        return new ObjectVisibilityRange(range.fixed(), range.authorId(), ids, range.all());
    }

    private ApplicationFacts applicationFacts(SubjectContext subject, Set<String> panels, long deadline) {
        List<ApplicationCatalog.ProductGraphCandidate> candidates;
        try {
            candidates = executor.inReadTransaction(deadline, () -> applications.productGraphCandidates(subject, panels));
        } catch (RuntimeException failure) {
            return new ApplicationFacts(WorkbenchPanelReads.captureFailure(failure, false), ready(null));
        }
        return new ApplicationFacts(ready(candidates.stream().map(ApplicationCatalog.ProductGraphCandidate::references).toList()),
                fact(deadline, false, () -> grants.productGraphAuthorization(subject, candidates)));
    }

    private String objectTypeName(SubjectContext subject, String id) {
        var record = (Map<?, ?>) model.read(subject, Map.of("primaryKey", id));
        var view = (ObjectTypeView) record.get("view");
        return view.showName().isEmpty() ? view.classDesc() : view.showName();
    }

    private String actionName(SubjectContext subject, String id) {
        var record = (ObjectNode) actions.read(subject, Map.of("primaryKey", id));
        return record == null ? null : record.path("name").textValue();
    }

    private Map<String, ItemResult> metricLabels(Set<String> ids, Callable<Access> queryAccess, long deadline) {
        if (ids.isEmpty()) return Map.of();
        Access access;
        try {
            access = queryAccess.call();
        } catch (Exception failure) {
            var refusal = WorkbenchPanelReads.captureFailure(failure, true);
            return labels(ids, id -> refusal);
        }
        return labels(ids, id -> fact(deadline, true, () -> metricName(id, access)));
    }

    private String metricName(String id, Access access) {
        if (access.expiresAt() != null && access.expiresAt() <= System.currentTimeMillis())
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "The user credential expired");
        return metrics.describeMetric(id, access).getString("name");
    }

    private static Map<String, ItemResult> labels(Set<String> ids, Function<String, ItemResult> read) {
        var facts = new LinkedHashMap<String, ItemResult>();
        for (var id : ids) facts.put(id, read.apply(id));
        return facts;
    }

    private ItemResult fact(long deadline, boolean query, Supplier<?> read) {
        try {
            return ready(executor.inReadTransaction(deadline, read));
        } catch (RuntimeException failure) {
            return WorkbenchPanelReads.captureFailure(failure, query);
        }
    }

    private static ItemResult ready(Object payload) {
        return new ItemResult(payload == null ? EMPTY : READY, null, null, payload, null);
    }
}
