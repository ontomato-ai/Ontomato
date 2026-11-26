package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.access;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDependency;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.OntologyNeighborFacts;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Link;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Name;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectGrant;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

class OntologyFunctionDependencyReadsTest {
    private static final String ACTION = "platform:Action";
    private static final String METRIC_VIEW = "platform:MetricView";
    private static final String FUNCTION = "platform:Function";

    private final ActionDao actions = mock(ActionDao.class);
    private final MetricViewDao metrics = mock(MetricViewDao.class);
    private final FunctionService functions = mock(FunctionService.class);
    private final ActionAuthorization actionAuthorization = mock(ActionAuthorization.class);
    private final CapabilityDefinitions definitions = mock(CapabilityDefinitions.class);
    private final OntologyFunctionDependencyReads reads =
        new OntologyFunctionDependencyReads(actions, metrics, functions, actionAuthorization, definitions);
    private final SubjectContext workbench = subject("system").withJavaUserId("admin");
    private final SubjectContext javaViewer = subject("admin");

    @Test
    void outgoingActionChecksTheSourceBeforeLookingUpOnlyItsReferencedFunction() {
        var action = action("action");
        when(actions.functionDependencies("domain", "action", true))
            .thenReturn(List.of(new FunctionDependency<>(action, "deleted")));
        when(functions.visibleDefinition("deleted", javaViewer)).thenReturn(Optional.empty());
        var read = reads.ontologyActionFunction().handler();

        assertEquals(new OntologyNeighborFacts(List.of(), List.of(), List.of()),
            read.read(workbench, scope(ACTION, "action", true)));
        verifyNoInteractions(functions);

        when(actionAuthorization.allowsDefinition(javaViewer, action)).thenReturn(true);
        var source = List.of(new Name("action", "action", null, Action.STATUS_PENDING_REVIEW));
        assertEquals(new OntologyNeighborFacts(List.of(new Link("action", "deleted")), source, List.of()),
            read.read(workbench, scope(ACTION, "action", true)));
        verify(functions).visibleDefinition("deleted", javaViewer);
        verifyNoMoreInteractions(functions);
    }

    @Test
    void incomingFunctionReadsOnlyAuthorizedSourcesAndReusesTheFunctionCenter() {
        var action = action("action");
        var metric = metric("metric");
        var denied = metric("private");
        when(actions.functionDependencies("domain", "function", false))
            .thenReturn(List.of(new FunctionDependency<>(action, "function")));
        when(metrics.functionDependencies("domain", "function", false))
            .thenReturn(List.of(new FunctionDependency<>(metric, "function"), new FunctionDependency<>(denied, "function")));
        when(actionAuthorization.allowsDefinition(javaViewer, action)).thenReturn(true);
        when(definitions.canRead(javaViewer, access(metric, Verb.USE))).thenReturn(true);
        when(definitions.canRead(javaViewer, access(denied, Verb.USE))).thenReturn(false);

        assertEquals(new OntologyNeighborFacts(List.of(new Link("action", "function")),
                List.of(new Name("action", "action", null, Action.STATUS_PENDING_REVIEW)), List.of()),
            reads.ontologyActionFunction().handler().read(workbench, scope(ACTION, "function", false)));
        assertEquals(new OntologyNeighborFacts(List.of(new Link("metric", "function")),
                List.of(new Name("metric", "metric", null, MetricView.STATUS_PENDING_REVIEW)), List.of()),
            reads.ontologyMetricFunction().handler().read(workbench, scope(METRIC_VIEW, "function", false)));
        verifyNoInteractions(functions);

        when(functions.visibleDefinition("function", javaViewer)).thenReturn(Optional.of(function()));
        assertEquals(List.of(new Name("function", "Function", null, Function.OPERATION_READ)),
            reads.ontologyFunctionCenter().handler().read(workbench, Map.of("primaryKey", "function", "domainId", "other")));
        verify(functions).visibleDefinition("function", javaViewer);
    }

    @Test
    void metricCenterWithoutItsEdgeDoesNotReadTheTarget() {
        var metric = metric("metric");
        when(metrics.functionDependencies("domain", "metric", true))
            .thenReturn(List.of(new FunctionDependency<>(metric, "function")));
        when(definitions.canRead(javaViewer, access(metric, Verb.USE))).thenReturn(true);
        var params = Map.<String, Object>of("className", METRIC_VIEW, "primaryKey", "metric",
            "from", METRIC_VIEW, "to", FUNCTION, "direction", "outgoing", "includeLinks", false);

        assertEquals(new OntologyNeighborFacts(List.of(),
                List.of(new Name("metric", "metric", null, MetricView.STATUS_PENDING_REVIEW)), List.of()),
            reads.ontologyMetricFunction().handler().read(workbench, params));
        verifyNoInteractions(functions);
    }

    @Test
    void objectTypeDependenciesUseTheVerifiedJavaViewerAndScopedSourceFacts() {
        var function = function();
        when(functions.visibleObjectTypeReferences("function", true, javaViewer))
            .thenReturn(List.of(new FunctionDao.ObjectTypeReferences(function, List.of("Order", "Deleted"))));
        var functionFacts = (OntologyNeighborFacts) reads.ontologyFunctionObjectTypes().handler().read(workbench,
            Map.of("className", FUNCTION, "primaryKey", "function", "from", FUNCTION,
                "to", "platform:ObjectType", "direction", "outgoing", "domainId", "other"));
        assertEquals(List.of(new Link("function", "Order"), new Link("function", "Deleted")), functionFacts.links());

        var visible = action("visible");
        var hidden = action("hidden");
        when(actions.objectTypeReferences("domain", "Order", false)).thenReturn(List.of(
            new ActionDao.ObjectTypeReference(visible, "Order"), new ActionDao.ObjectTypeReference(hidden, "Order")));
        when(actionAuthorization.allowsDefinition(javaViewer, visible)).thenReturn(true);
        var actionFacts = (OntologyNeighborFacts) reads.ontologyActionObjectType().handler().read(workbench,
            Map.of("className", "platform:ObjectType", "primaryKey", "Order", "from", ACTION,
                "to", "platform:ObjectType", "direction", "incoming", "domainId", "other"));
        assertEquals(List.of(new Link("visible", "Order")), actionFacts.links());
        assertEquals(List.of(new Name("visible", "visible", null, Action.STATUS_PENDING_REVIEW)), actionFacts.fromNames());

        var store = mock(AuthorizationStore.class);
        when(store.policyActionGrants("domain", "policy")).thenReturn(List.of(
            new ObjectGrant("policy", new ObjectTarget("domain", Kind.ACTION, "visible"), Verb.EDIT, null),
            new ObjectGrant("policy", new ObjectTarget("domain", Kind.ACTION, "hidden"), Verb.VIEW, null)));
        when(actions.definitionDirectoryEntries("domain", Set.of("visible", "hidden"))).thenReturn(List.of(visible, hidden));
        String policy = "platform:PermissionPolicy";
        assertEquals(List.of(new Name("visible", "visible", null, Action.STATUS_PENDING_REVIEW)),
            reads.ontologyPolicyGrantActionNames(store).handler().read(workbench,
                Map.of("className", policy, "primaryKey", "policy", "from", policy,
                    "to", ACTION, "direction", "outgoing", "domainId", "outside")));
        verify(actions).definitionDirectoryEntries("domain", Set.of("visible", "hidden"));
        verify(store).policyActionGrants("domain", "policy");
        verifyNoMoreInteractions(store);
    }

    private static SubjectContext subject(String userId) {
        return new SubjectContext(new VerifiedIdentity("domain", userId, CredentialLimit.UNRESTRICTED), null,
            Map.of(), Set.of(), Set.of());
    }

    private static Map<String, Object> scope(String source, String id, boolean outgoing) {
        return Map.of("className", outgoing ? source : FUNCTION, "primaryKey", id,
            "from", source, "to", FUNCTION, "direction", outgoing ? "outgoing" : "incoming", "domainId", "other");
    }

    private static Action action(String id) {
        var action = new Action();
        action.setId(id);
        action.setName(id);
        action.setDomainId("domain");
        action.setStatus(Action.STATUS_PENDING_REVIEW);
        return action;
    }

    private static MetricView metric(String id) {
        var metric = new MetricView();
        metric.setId(id);
        metric.setName(id);
        metric.setDomainId("domain");
        metric.setStatus(MetricView.STATUS_PENDING_REVIEW);
        return metric;
    }

    private static Function function() {
        var function = new Function();
        function.setId("function");
        function.setName("Function");
        function.setOperation(Function.OPERATION_READ);
        return function;
    }
}
