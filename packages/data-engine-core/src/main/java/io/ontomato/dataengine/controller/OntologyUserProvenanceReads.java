package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.access;

import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.UserDefinitionProvenance;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Configuration(proxyBeanMethods = false)
class OntologyUserProvenanceReads {
    static final String READ = "userProvenanceByMember";

    private final ActionDao actions;
    private final WorkflowDao workflows;
    private final MetricViewDao metrics;
    private final SubjectDirectory members;
    private final ManagementRequestAccess management;
    private final ActionAuthorization actionAuthorization;
    private final CapabilityDefinitions definitions;

    OntologyUserProvenanceReads(ActionDao actions, WorkflowDao workflows, MetricViewDao metrics,
            SubjectDirectory members, ManagementRequestAccess management,
            ActionAuthorization actionAuthorization, CapabilityDefinitions definitions) {
        this.actions = actions;
        this.workflows = workflows;
        this.metrics = metrics;
        this.members = members;
        this.management = management;
        this.actionAuthorization = actionAuthorization;
        this.definitions = definitions;
    }

    @Bean
    WorkbenchPanelRead actionUserProvenance() {
        return read("platform:Action", (viewer, ids) -> actions.provenanceCandidates(viewer.identity().domainId(), ids)
            .stream().filter(action -> actionAuthorization.allowsDefinition(viewer, action))
            .map(action -> new UserDefinitionProvenance(action.getId(), action.getName(),
                action.getCreatedBy(), action.getReviewedBy())));
    }

    @Bean
    WorkbenchPanelRead workflowUserProvenance() {
        return read("platform:Workflow", (viewer, ids) -> workflows.provenanceCandidates(viewer.identity().domainId(), ids).stream());
    }

    @Bean
    WorkbenchPanelRead metricViewUserProvenance() {
        return read("platform:MetricView", (viewer, ids) -> metrics.provenanceCandidates(viewer.identity().domainId(), ids)
            .stream().filter(metric -> definitions.canRead(viewer, access(metric, Verb.USE)))
            .map(metric -> new UserDefinitionProvenance(metric.getId(), metric.getName(),
                metric.getCreatedBy(), metric.getReviewedBy())));
    }

    private WorkbenchPanelRead read(String type, Source source) {
        return new WorkbenchPanelRead(type, READ, (subject, parameters) -> {
            management.require(subject, GovernanceDirectoryController.MEMBERS_READ);
            if (!(parameters.get("memberIds") instanceof List<?> ids) || ids.isEmpty()
                    || ids.stream().anyMatch(id -> !(id instanceof String key) || key.isBlank())
                    || !(parameters.get("limit") instanceof Integer limit) || limit < 1)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected member IDs and a positive name limit");
            var requested = ids.stream().map(String.class::cast).collect(Collectors.toSet());
            var existing = members.memberIdentitiesInDomain(subject.identity().domainId(), requested).stream()
                .map(SubjectDirectory.MemberIdentity::id).collect(Collectors.toSet());
            // The OSS self-node can open an empty graph directory but is not a directory member.
            if (existing.isEmpty()) return Map.of();
            return UserDefinitionProvenance.summarize(source.read(OntologyFunctionDependencyReads.definitionViewer(subject), existing),
                existing, limit);
        });
    }

    @FunctionalInterface
    private interface Source {
        Stream<UserDefinitionProvenance> read(SubjectContext viewer, Set<String> ids);
    }
}
