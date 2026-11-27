package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit.UNRESTRICTED;
import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.access;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.UserDefinitionProvenance;
import io.ontomato.dataengine.service.UserDefinitionProvenance.Names;
import io.ontomato.dataengine.service.UserDefinitionProvenance.Summary;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class OntologyUserProvenanceReadsTest {
    private final ActionDao actions = mock(ActionDao.class);
    private final WorkflowDao workflows = mock(WorkflowDao.class);
    private final MetricViewDao metrics = mock(MetricViewDao.class);
    private final SubjectDirectory members = mock(SubjectDirectory.class);
    private final ManagementRequestAccess management = mock(ManagementRequestAccess.class);
    private final ActionAuthorization actionAuthorization = mock(ActionAuthorization.class);
    private final CapabilityDefinitions definitions = mock(CapabilityDefinitions.class);
    private final OntologyUserProvenanceReads reads =
        new OntologyUserProvenanceReads(actions, workflows, metrics, members, management, actionAuthorization, definitions);
    private final SubjectContext subject = new SubjectContext(new VerifiedIdentity("domain", "system", UNRESTRICTED),
        null, Map.of(), Set.of(), Set.of()).withJavaUserId("admin");
    private final Map<String, Object> parameters = Map.of("memberIds", List.of("member", "missing"), "limit", 3);

    @Test
    void requiresMemberAdmissionBeforeReadingAnyProvenanceSource() {
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN))
            .when(management).require(subject, GovernanceDirectoryController.MEMBERS_READ);
        for (var read : List.of(reads.actionUserProvenance(), reads.workflowUserProvenance(), reads.metricViewUserProvenance()))
            assertThrows(ResponseStatusException.class, () -> read.handler().read(subject, parameters));
        verifyNoInteractions(members, actions, workflows, metrics);
    }

    @Test
    void readsEachOwnerOnlyForRealMembersAndCountsVisibleAuthorshipBeforeTruncating() {
        when(members.memberIdentitiesInDomain("domain", Set.of("member", "missing")))
            .thenReturn(List.of(new SubjectDirectory.MemberIdentity("member", "alice", "Alice")));
        var viewer = subject.asJavaUser();
        var hidden = action("hidden", "Hidden", "member", "member");
        var first = action("first", "First", "\tmember\u00A0", "member");
        var second = action("second", "Same", "member", "other");
        var third = action("third", "Same", "member", null);
        var fourth = action("fourth", "Fourth", "member", "member");
        when(actions.provenanceCandidates("domain", Set.of("member"))).thenReturn(List.of(hidden, first, second, third, fourth));
        for (var row : List.of(first, second, third, fourth))
            when(actionAuthorization.allowsDefinition(viewer, row)).thenReturn(true);
        assertEquals(Map.of("member", new Summary(new Names(List.of("First", "Same", "Same"), 4),
            new Names(List.of("First", "Fourth"), 2))), reads.actionUserProvenance().handler().read(subject, parameters));
        when(workflows.provenanceCandidates("domain", Set.of("member")))
            .thenReturn(List.of(new UserDefinitionProvenance("workflow", "", "other", "member")));
        assertEquals(Map.of("member", new Summary(new Names(List.of(), 0), new Names(List.of("workflow"), 1))),
            reads.workflowUserProvenance().handler().read(subject, parameters));
        var metric = new MetricView();
        metric.setId("metric");
        metric.setName("Total");
        metric.setDomainId("domain");
        metric.setCreatedBy("member");
        when(metrics.provenanceCandidates("domain", Set.of("member"))).thenReturn(List.of(metric));
        when(definitions.canRead(viewer, access(metric, Verb.USE))).thenReturn(true);
        assertEquals(Map.of("member", new Summary(new Names(List.of("Total"), 1), new Names(List.of(), 0))),
            reads.metricViewUserProvenance().handler().read(subject, parameters));
    }

    @Test
    void neverLooksUpTheOssAliasForASyntheticSelfNode() {
        var self = Map.<String, Object>of("memberIds", List.of("system"), "limit", 3);
        for (var read : List.of(reads.actionUserProvenance(), reads.workflowUserProvenance(), reads.metricViewUserProvenance()))
            assertEquals(Map.of(), read.handler().read(subject, self));
        verifyNoInteractions(actions, workflows, metrics);
    }

    private static Action action(String id, String name, String creator, String reviewer) {
        var action = new Action();
        action.setId(id);
        action.setName(name);
        action.setCreatedBy(creator);
        action.setReviewedBy(reviewer);
        return action;
    }
}
