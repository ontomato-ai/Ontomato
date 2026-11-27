package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.access;

import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.schedules.PlatformTasks;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Name;
import io.ontomato.dataengine.service.PermissionPolicyDirectory;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Configuration(proxyBeanMethods = false)
class OntologyPolicyObjectReads {
    private static final String ONTOLOGY = "platform:OntologyType";
    private static final String POLICY = "platform:PermissionPolicy";
    private static final Set<Kind> KINDS = Set.of(Kind.PANEL, Kind.PROJECTION, Kind.COMPONENT, Kind.AGENT, Kind.METRIC,
            Kind.READ_FUNCTION, Kind.WRITE_FUNCTION, Kind.WORKFLOW, Kind.TRIGGER);
    private static final Set<Kind> SHARED_KINDS = Set.of(Kind.PANEL, Kind.AGENT);

    private final AuthorizationStore store;

    OntologyPolicyObjectReads(AuthorizationStore store) {
        this.store = store;
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyObjectGrants() {
        // The registered batch has already verified the service and ordinary domain member.
        return new WorkbenchPanelRead(ONTOLOGY, "permission-policy.can-use-object", (subject, parameters) ->
                grants(subject.identity().domainId(), Scope.parse(parameters)).stream()
                        .map(AuthorizationPolicyGovernanceController::policyGrantFact).toList());
    }

    record PolicyFacts(List<Name> names, List<AuthorizationPolicyGovernanceController.PolicyCreateKind> createKinds) {}

    @Bean
    WorkbenchPanelRead ontologyObjectGrantPolicies(PermissionPolicyDirectory policies, ManagementRequestAccess management) {
        return new WorkbenchPanelRead(ONTOLOGY, "objectGrantPolicies", (subject, parameters) -> {
            var scope = Scope.parse(parameters);
            management.require(subject, AuthorizationPolicies.READ);
            var domain = subject.identity().domainId();
            var ids = scope.outgoing() ? Set.of(scope.centerId()) : grants(domain, scope).stream()
                    .map(ObjectGrant::policyId).collect(Collectors.toSet());
            var names = scope.outgoing() ? List.<Name>of() : policies.policyNamesInDomain(domain, ids).stream()
                    .map(policy -> new Name(policy.id(), policy.name(), null)).toList();
            var createKinds = store.policyCreateGrants(domain, ids, KINDS).stream()
                    .map(grant -> new AuthorizationPolicyGovernanceController.PolicyCreateKind(grant.policyId(), grant.target().kind()))
                    .distinct().toList();
            return new PolicyFacts(names, createKinds);
        });
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyObjectSharedUses() {
        return new WorkbenchPanelRead(ONTOLOGY, "policyObjectSharedUses", (subject, parameters) -> {
            var scope = Scope.parse(parameters);
            if (!scope.outgoing() || !SHARED_KINDS.containsAll(scope.kinds()))
                throw badScope();
            var domain = subject.identity().domainId();
            var candidates = grants(domain, scope).stream().collect(Collectors.groupingBy(grant -> grant.target().kind(),
                    Collectors.mapping(grant -> grant.target().id(), Collectors.toSet())));
            if (candidates.isEmpty()) return Map.of();
            var policy = store.domainPolicy(domain).policyId();
            return candidates.entrySet().stream().collect(Collectors.toMap(Map.Entry::getKey,
                    entry -> store.policyUseKeys(domain, policy, entry.getKey(), entry.getValue())));
        });
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyObjectFunctionNames(FunctionService functions) {
        return namesRead("policyObjectFunctionNames", Set.of(Kind.READ_FUNCTION, Kind.WRITE_FUNCTION),
                (viewer, ids) -> functions.visibleDefinitions(ids, viewer).stream()
                        .map(row -> new Name(row.getId(), row.getName(), null, row.getOperation())).toList());
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyObjectMetricNames(MetricViewDao metrics, CapabilityDefinitions definitions) {
        return namesRead("policyObjectMetricNames", Set.of(Kind.METRIC),
                (viewer, ids) -> metrics.definitionDirectoryEntries(viewer.identity().domainId(), ids).stream()
                        .filter(row -> definitions.canRead(viewer, access(row, Verb.USE)))
                        .map(row -> new Name(row.getId(), row.getName(), null, row.getStatus())).toList());
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyObjectWorkflowNames(WorkflowService workflows) {
        return namesRead("policyObjectWorkflowNames", Set.of(Kind.WORKFLOW),
                (viewer, ids) -> workflows.directoryEntries(viewer.identity().domainId(), ids).stream()
                        .map(row -> new Name(row.id(), row.name(), null, row.version() == null ? row.status() : "v" + row.version()))
                        .toList());
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyObjectTriggerNames(PlatformTasks tasks) {
        return namesRead("policyObjectTriggerNames", Set.of(Kind.TRIGGER), tasks::ontologyNames);
    }

    private WorkbenchPanelRead namesRead(String name, Set<Kind> targetKinds,
            BiFunction<SubjectContext, Set<String>, List<Name>> directory) {
        return new WorkbenchPanelRead(ONTOLOGY, name, (subject, parameters) -> {
            var scope = Scope.parse(parameters);
            if (!scope.outgoing() || !targetKinds.containsAll(scope.kinds())) throw badScope();
            var ids = grants(subject.identity().domainId(), scope).stream()
                    .map(grant -> grant.target().id()).collect(Collectors.toSet());
            return directory.apply(OntologyFunctionDependencyReads.definitionViewer(subject), ids);
        });
    }

    private List<ObjectGrant> grants(String domain, Scope scope) {
        return scope.outgoing() ? store.policyObjectGrants(domain, scope.centerId(), scope.kinds())
                : store.targetObjectGrants(domain, scope.centerId(), scope.kinds());
    }

    private record Scope(String centerId, boolean outgoing, Set<Kind> kinds) {
        private static Scope parse(Map<String, Object> parameters) {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank()
                    || !(parameters.get("className") instanceof String className)
                    || !(parameters.get("targetKinds") instanceof List<?> kinds) || kinds.isEmpty())
                throw badScope();
            var selected = KINDS.stream().filter(kind -> kinds.contains(kind.name())).collect(Collectors.toSet());
            if (selected.size() != kinds.size()) throw badScope();
            boolean outgoing = POLICY.equals(className);
            if (!(outgoing ? "outgoing" : "incoming").equals(parameters.get("direction"))) throw badScope();
            return new Scope(id, outgoing, selected);
        }
    }

    private static ResponseStatusException badScope() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid policy object neighbor scope");
    }
}
