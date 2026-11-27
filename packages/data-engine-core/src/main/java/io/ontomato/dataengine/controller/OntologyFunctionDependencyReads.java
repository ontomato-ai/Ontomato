package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.access;

import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.panelreads.OntologyNeighborScope;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.OntologyNeighborFacts;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Link;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Name;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Configuration(proxyBeanMethods = false)
class OntologyFunctionDependencyReads {
    private static final String ONTOLOGY = "platform:OntologyType";
    private static final String ACTION = "platform:Action";
    private static final String POLICY = "platform:PermissionPolicy";
    private static final String WORKFLOW = "platform:Workflow";
    private static final String METRIC_VIEW = "platform:MetricView";
    private static final String FUNCTION = "platform:Function";
    private static final String OBJECT_TYPE = "platform:ObjectType";

    private final ActionDao actions;
    private final MetricViewDao metrics;
    private final FunctionService functions;
    private final ActionAuthorization actionAuthorization;
    private final CapabilityDefinitions definitions;

    OntologyFunctionDependencyReads(ActionDao actions, MetricViewDao metrics, FunctionService functions,
            ActionAuthorization actionAuthorization, CapabilityDefinitions definitions) {
        this.actions = actions;
        this.metrics = metrics;
        this.functions = functions;
        this.actionAuthorization = actionAuthorization;
        this.definitions = definitions;
    }

    @Bean
    WorkbenchPanelRead ontologyActionFunction() {
        return new WorkbenchPanelRead(ONTOLOGY, "action.uses-function", (subject, parameters) -> {
            var scope = dependencyScope(parameters, ACTION);
            var viewer = subject.asJavaUser();
            var rows = actions.functionDependencies(viewer.identity().domainId(), scope.centerId(), scope.outgoing()).stream()
                .filter(ref -> actionAuthorization.allowsDefinition(viewer, ref.definition()))
                .map(ref -> {
                    var action = ref.definition();
                    return new Dependency(action.getId(), action.getName(), action.getStatus(), ref.functionId());
                }).toList();
            return facts(viewer, scope, rows, !Boolean.FALSE.equals(parameters.get("includeLinks")));
        });
    }

    @Bean
    WorkbenchPanelRead ontologyWorkflowStepActionNames() {
        return new WorkbenchPanelRead(ONTOLOGY, "workflowStepActionNames", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, WORKFLOW, ACTION);
            if (!scope.outgoing())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a Workflow center");
            var viewer = subject.asJavaUser();
            return actions.workflowStepDefinitions(viewer.identity().domainId(), scope.centerId()).stream()
                .filter(action -> actionAuthorization.allowsDefinition(viewer, action))
                .map(action -> new Name(action.getId(), action.getName(), null, action.getStatus())).toList();
        });
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyGrantActionNames(AuthorizationStore store) {
        return new WorkbenchPanelRead(ONTOLOGY, "policyGrantActionNames", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, POLICY, ACTION);
            if (!scope.outgoing())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a permission policy center");
            var viewer = subject.asJavaUser();
            var domain = viewer.identity().domainId();
            var ids = store.policyActionGrants(domain, scope.centerId()).stream()
                .map(grant -> grant.target().id()).collect(Collectors.toSet());
            return actions.definitionDirectoryEntries(domain, ids).stream()
                .filter(action -> actionAuthorization.allowsDefinition(viewer, action))
                .map(action -> new Name(action.getId(), action.getName(), null, action.getStatus())).toList();
        });
    }

    @Bean
    WorkbenchPanelRead ontologyMetricFunction() {
        return new WorkbenchPanelRead(ONTOLOGY, "metric-view.uses-function", (subject, parameters) -> {
            var scope = dependencyScope(parameters, METRIC_VIEW);
            var viewer = subject.asJavaUser();
            var rows = metrics.functionDependencies(viewer.identity().domainId(), scope.centerId(), scope.outgoing()).stream()
                .filter(ref -> definitions.canRead(viewer, access(ref.definition(), Verb.USE)))
                .map(ref -> {
                    var metric = ref.definition();
                    return new Dependency(metric.getId(), metric.getName(), metric.getStatus(), ref.functionId());
                }).toList();
            return facts(viewer, scope, rows, !Boolean.FALSE.equals(parameters.get("includeLinks")));
        });
    }

    @Bean
    WorkbenchPanelRead ontologyFunctionCenter() {
        return new WorkbenchPanelRead(ONTOLOGY, "functionCenter", (subject, parameters) -> {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isEmpty())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a Function center ID");
            return functionNames(subject.asJavaUser(), id);
        });
    }

    @Bean
    WorkbenchPanelRead ontologyFunctionObjectTypes() {
        return objectTypeRelation("function.reads-object-type", FUNCTION);
    }

    @Bean
    WorkbenchPanelRead ontologyActionObjectType() {
        return objectTypeRelation("action.targets-object-type", ACTION);
    }

    @Bean
    WorkbenchPanelRead ontologyDependencyObjectTypeNames(AdminController model, ManagementRequestAccess management) {
        return new WorkbenchPanelRead(ONTOLOGY, "dependencyObjectTypeNames", (subject, parameters) -> {
            if (!(parameters.get("from") instanceof String source) || !List.of(ACTION, FUNCTION).contains(source)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a Function or Action source");
            }
            var scope = OntologyNeighborScope.parse(parameters, source, OBJECT_TYPE);
            if (!scope.outgoing())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected an outgoing object type dependency");
            management.require(subject, OntologyModelController.Operations.READ);
            var ids = objectTypeDependencies(subject.asJavaUser(), scope, source).stream()
                .flatMap(row -> row.classNames().stream()).collect(Collectors.toSet());
            return model.modelObjectTypeEndpoints(subject.identity().domainId(), ids);
        });
    }

    private WorkbenchPanelRead objectTypeRelation(String relation, String source) {
        return new WorkbenchPanelRead(ONTOLOGY, relation, (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, source, OBJECT_TYPE);
            var rows = objectTypeDependencies(subject.asJavaUser(), scope, source);
            var links = rows.stream().flatMap(row -> row.classNames().stream()
                .map(id -> new Link(row.name().id(), id))).toList();
            return new OntologyNeighborFacts(links, rows.stream().map(ObjectTypeDependency::name).toList(), List.of());
        });
    }

    private record ObjectTypeDependency(Name name, List<String> classNames) {}

    private List<ObjectTypeDependency> objectTypeDependencies(SubjectContext viewer, OntologyNeighborScope scope, String source) {
        if (FUNCTION.equals(source)) {
            return functions.visibleObjectTypeReferences(scope.centerId(), scope.outgoing(), viewer).stream()
                .map(row -> {
                    var function = row.definition();
                    return new ObjectTypeDependency(new Name(function.getId(), function.getName(), null, function.getOperation()),
                        row.classNames());
                }).toList();
        }
        return actions.objectTypeReferences(viewer.identity().domainId(), scope.centerId(), scope.outgoing()).stream()
            .filter(row -> actionAuthorization.allowsDefinition(viewer, row.definition()))
            .map(row -> {
                var action = row.definition();
                var target = row.className();
                return new ObjectTypeDependency(new Name(action.getId(), action.getName(), null, action.getStatus()),
                    target == null || target.isEmpty() ? List.of() : List.of(target));
            }).toList();
    }

    private static OntologyNeighborScope dependencyScope(Map<String, Object> parameters, String source) {
        if (!(parameters.get("primaryKey") instanceof String id) || id.isEmpty()
                || !source.equals(parameters.get("from")) || !FUNCTION.equals(parameters.get("to"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid function dependency scope");
        }
        if (source.equals(parameters.get("className")) && "outgoing".equals(parameters.get("direction")))
            return new OntologyNeighborScope(id, true, false);
        if (FUNCTION.equals(parameters.get("className")) && "incoming".equals(parameters.get("direction")))
            return new OntologyNeighborScope(id, false, true);
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid function dependency center");
    }

    private record Dependency(String id, String name, String status, String functionId) {}

    private OntologyNeighborFacts facts(SubjectContext viewer, OntologyNeighborScope scope, List<Dependency> rows, boolean includeLinks) {
        var names = rows.stream().map(row -> new Name(row.id(), row.name(), null, row.status())).toList();
        if (!includeLinks) return new OntologyNeighborFacts(List.of(), names, List.of());
        var links = rows.stream().filter(row -> row.functionId() != null && !row.functionId().isBlank())
            .map(row -> new Link(row.id(), row.functionId())).toList();
        var targets = scope.outgoing() && !links.isEmpty() ? functionNames(viewer, links.getFirst().toId()) : List.<Name>of();
        return new OntologyNeighborFacts(links, names, targets);
    }

    private List<Name> functionNames(SubjectContext viewer, String id) {
        return functions.visibleDefinition(id, viewer).stream()
            .map(function -> new Name(function.getId(), function.getName(), null, function.getOperation())).toList();
    }

}
