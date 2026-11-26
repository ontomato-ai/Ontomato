package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.service.CapabilityGrantQuery;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.OntologyNeighborFacts;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Link;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Name;
import io.ontomato.dataengine.service.OrganizationDirectory;
import io.ontomato.dataengine.service.OrganizationDirectory.MemberRelation;
import io.ontomato.dataengine.service.PermissionPolicyDirectory;
import io.ontomato.dataengine.service.PlatformAccessQuery;
import io.ontomato.dataengine.service.PlatformAccessQuery.RoleName;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectGrant;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

class GovernanceDirectoryControllerTest {
    @Test void countRequestsReturnOnlyCountsForTheAuthenticatedDomain() throws Exception {
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("member", "domain"));
        var organization = mock(OrganizationDirectory.class);
        when(organization.countInDomain("domain")).thenReturn(new OrganizationDirectory.Counts(2, 3, 7));
        var policies = mock(PermissionPolicyDirectory.class);
        when(policies.countInDomain("domain")).thenReturn(11L);
        var mvc = MockMvcBuilders.standaloneSetup(new GovernanceDirectoryController(identity, organization, policies))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        String request = """
            {"countOnly":true,"domainId":"other"}""";

        mvc.perform(post("/platform/governance/organization").contentType(MediaType.APPLICATION_JSON).content(request))
            .andExpect(status().isOk()).andExpect(jsonPath("$.units").value(2)).andExpect(jsonPath("$.positions").value(3))
            .andExpect(jsonPath("$.grants").value(7)).andExpect(jsonPath("$.memberships").doesNotExist());
        mvc.perform(post("/platform/governance/policies").contentType(MediaType.APPLICATION_JSON).content(request))
            .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(11)).andExpect(jsonPath("$.policies").doesNotExist());
        verify(organization).countInDomain("domain");
        verify(policies).countInDomain("domain");
        verifyNoMoreInteractions(organization, policies);
    }

    @Test void policyInstanceDirectoryRequiresPolicyReadAndUsesTheVerifiedDomain() {
        var policyDirectory = mock(PermissionPolicyDirectory.class);
        var management = mock(ManagementRequestAccess.class);
        var controller = new GovernanceDirectoryController(mock(IdentityService.class),
            mock(OrganizationDirectory.class), policyDirectory);
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
            null, Map.of(), Set.of(), Set.of());
        var read = controller.policyInstanceDirectory(management);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).doNothing()
            .when(management).require(subject, AuthorizationPolicies.READ);

        assertThrows(ResponseStatusException.class, () -> read.handler().read(subject, Map.of()));
        verifyNoInteractions(policyDirectory);
        when(policyDirectory.listPolicies("domain")).thenReturn(List.of(
            new PermissionPolicyDirectory.Policy("policy", "Policy", 2, false, "parent")));
        assertEquals(List.of(new GovernanceDirectoryController.PolicyInstance("policy", "Policy")),
            read.handler().read(subject, Map.of("domainId", "outside")));
        verify(policyDirectory).listPolicies("domain");

        var neighbors = new OntologyGovernanceNeighborReads(null, null, null, policyDirectory, null, management, null);
        var model = mock(AdminController.class);
        var edge = neighbors.ontologyPolicyDataNeighbors().handler();
        var labels = neighbors.ontologyPolicyDataObjectTypeNames(model).handler();
        var policy = "platform:PermissionPolicy";
        var objectType = "platform:ObjectType";
        var outgoing = Map.<String, Object>of("className", policy, "primaryKey", "policy", "from", policy, "to", objectType,
            "direction", "outgoing", "domainId", "outside");
        var incoming = Map.<String, Object>of("className", objectType, "primaryKey", "Orders", "from", policy, "to", objectType,
            "direction", "incoming", "domainId", "outside");
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, AuthorizationPolicies.READ);
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> edge.read(subject, incoming)).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> labels.read(subject, outgoing)).getStatusCode().value());
        verifyNoMoreInteractions(policyDirectory);
        verifyNoInteractions(model);

        doNothing().when(management).require(subject, AuthorizationPolicies.READ);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management)
            .require(subject, OntologyModelController.Operations.READ);
        var linked = List.of(new PermissionPolicyDirectory.PolicyDataNeighbor("policy", "Orders", "Policy"));
        when(policyDirectory.policyDataNeighbors("domain", "Orders", false)).thenReturn(linked);
        when(policyDirectory.policyDataNeighbors("domain", "policy", true)).thenReturn(linked);
        var links = List.of(new Link("policy", "Orders"));
        assertEquals(new OntologyNeighborFacts(links, List.of(new Name("policy", "Policy", null)), List.of()),
            edge.read(subject, incoming));
        assertEquals(new OntologyNeighborFacts(links, List.of(), List.of()), edge.read(subject, outgoing));
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> labels.read(subject, outgoing)).getStatusCode().value());
        verifyNoInteractions(model);

        doNothing().when(management).require(subject, OntologyModelController.Operations.READ);
        labels.read(subject, outgoing);
        verify(model).modelObjectTypeEndpoints("domain", Set.of("Orders"));
        verify(policyDirectory, times(2)).policyDataNeighbors("domain", "policy", true);
        verify(policyDirectory).policyDataNeighbors("domain", "Orders", false);
        when(policyDirectory.policyNamesInDomain("domain", Set.of("policy"))).thenReturn(List.of(
            new PermissionPolicyDirectory.PolicyName("policy", "Policy")));
        assertEquals(new OntologyGovernanceNeighborReads.Center(List.of(new Name("policy", "Policy", null)), false),
            neighbors.ontologyGovernanceCenter().handler().read(subject, outgoing));
        verify(policyDirectory).policyNamesInDomain("domain", Set.of("policy"));
        verifyNoMoreInteractions(policyDirectory);

        var store = mock(AuthorizationStore.class);
        var policyNames = neighbors.ontologyActionGrantPolicyNames(store).handler();
        var action = "platform:Action";
        var actionScope = Map.<String, Object>of("className", action, "primaryKey", "approve",
            "from", policy, "to", action, "direction", "incoming", "domainId", "outside");
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, AuthorizationPolicies.READ);
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> policyNames.read(subject, actionScope)).getStatusCode().value());
        verifyNoInteractions(store);
        verifyNoMoreInteractions(policyDirectory);
        doNothing().when(management).require(subject, AuthorizationPolicies.READ);
        when(store.actionPolicyGrants("domain", "approve")).thenReturn(List.of(
            new ObjectGrant("policy", new ObjectTarget("domain", Kind.ACTION, "approve"), Verb.VIEW, null)));
        assertEquals(List.of(new Name("policy", "Policy", null)), policyNames.read(subject, actionScope));
        verify(store).actionPolicyGrants("domain", "approve");
        verify(policyDirectory, times(2)).policyNamesInDomain("domain", Set.of("policy"));

        var objectReads = new OntologyPolicyObjectReads(store);
        var functionKinds = Set.of(Kind.READ_FUNCTION, Kind.WRITE_FUNCTION);
        var functionScope = Map.<String, Object>of("className", "platform:Function", "primaryKey", "fn",
            "direction", "incoming", "targetKinds", List.of("READ_FUNCTION", "WRITE_FUNCTION"), "domainId", "outside");
        when(store.targetObjectGrants("domain", "fn", functionKinds)).thenReturn(List.of(
            new ObjectGrant("policy", new ObjectTarget("domain", Kind.WRITE_FUNCTION, "fn"), Verb.EDIT, null)));
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, AuthorizationPolicies.READ);
        assertEquals(List.of(new AuthorizationPolicyGovernanceController.PolicyGrantFact("policy", Kind.WRITE_FUNCTION, "fn", Verb.EDIT, null)),
            objectReads.ontologyPolicyObjectGrants().handler().read(subject, functionScope));
        var objectPolicies = objectReads.ontologyObjectGrantPolicies(policyDirectory, management).handler();
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> objectPolicies.read(subject, functionScope)).getStatusCode().value());
        verify(store).targetObjectGrants("domain", "fn", functionKinds);
        doNothing().when(management).require(subject, AuthorizationPolicies.READ);
        assertEquals(new OntologyPolicyObjectReads.PolicyFacts(List.of(new Name("policy", "Policy", null)), List.of()),
            objectPolicies.read(subject, functionScope));
        verify(store, times(2)).targetObjectGrants("domain", "fn", functionKinds);
    }

    @Test void instanceDirectoriesKeepTheOrganizationReadGateAndTheVerifiedDomain() {
        var organization = mock(OrganizationDirectory.class);
        var management = mock(ManagementRequestAccess.class);
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var controller = new GovernanceDirectoryController(mock(IdentityService.class), organization,
                mock(PermissionPolicyDirectory.class));
        var units = controller.orgUnitInstanceDirectory(management);
        var positions = controller.orgPositionInstanceDirectory(management);
        var grants = controller.orgGrantInstanceDirectory(management);
        var reads = List.of(units, positions, grants);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, "organization.read");
        for (var read : reads) {
            assertEquals(403, assertThrows(ResponseStatusException.class,
                    () -> read.handler().read(subject, Map.of())).getStatusCode().value());
        }
        verifyNoInteractions(organization);
        doNothing().when(management).require(subject, "organization.read");
        var params = Map.<String, Object>of("domainId", "other");
        assertEquals(List.of(), units.handler().read(subject, params));
        assertEquals(List.of(), positions.handler().read(subject, params));
        assertEquals(List.of(), grants.handler().read(subject, params));
        verify(organization).unitInstances("domain");
        verify(organization).positionInstances("domain");
        verify(organization).grantInstances("domain");
        verifyNoMoreInteractions(organization);
    }

    @Test void organizationNeighborsReuseOrganizationReadAndDoNotTrustAnInputDomain() {
        var organization = mock(OrganizationDirectory.class);
        var management = mock(ManagementRequestAccess.class);
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var reads = new OntologyGovernanceNeighborReads(null, null, null, null, organization, management, null);
        var unit = "platform:OrgUnit";
        var position = "platform:OrgPosition";
        var center = Map.<String, Object>of("className", unit, "primaryKey", "org", "domainId", "other");
        var children = Map.<String, Object>of("className", unit, "primaryKey", "org", "from", unit, "to", unit,
                "direction", "both", "domainId", "other");
        var positions = Map.<String, Object>of("className", position, "primaryKey", "post", "from", unit, "to", position,
                "direction", "incoming", "domainId", "other");
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, "organization.read");
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> reads.ontologyOrgUnitChildren().handler().read(subject, children)).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> reads.ontologyOrgUnitPositions().handler().read(subject, positions)).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> reads.ontologyGovernanceCenter().handler().read(subject, center)).getStatusCode().value());
        verifyNoInteractions(organization);

        doNothing().when(management).require(subject, "organization.read");
        reads.ontologyOrgUnitChildren().handler().read(subject, children);
        reads.ontologyOrgUnitPositions().handler().read(subject, positions);
        reads.ontologyGovernanceCenter().handler().read(subject, center);
        reads.ontologyGovernanceCenter().handler().read(subject, Map.of("className", position, "primaryKey", "post"));
        verify(organization).unitChildLinks("domain", "org", true, true);
        verify(organization).unitPositionLinks("domain", "post", false);
        verify(organization).unitCenter("domain", "org");
        verify(organization).positionCenter("domain", "post");
        verifyNoMoreInteractions(organization);
    }

    @Test void organizationMemberEdgesAndNamesKeepSeparateReadGates() {
        var organization = mock(OrganizationDirectory.class);
        var members = mock(SubjectDirectory.class);
        var management = mock(ManagementRequestAccess.class);
        var subject = new SubjectContext(new VerifiedIdentity("domain", "viewer", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var reads = new OntologyGovernanceNeighborReads(members, null, null, null, organization, management, null);
        var user = "platform:User";
        var unit = "platform:OrgUnit";
        var position = "platform:OrgPosition";
        var incoming = Map.<String, Object>of("className", unit, "primaryKey", "org", "from", user, "to", unit,
                "direction", "incoming", "domainId", "outside");
        var outgoing = Map.<String, Object>of("className", user, "primaryKey", "member", "from", user, "to", position,
                "direction", "outgoing");
        var center = Map.<String, Object>of("className", user, "primaryKey", "member");
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, "members.read");
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> reads.ontologyOrganizationMemberNames().handler().read(subject, incoming)).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> reads.ontologyGovernanceCenter().handler().read(subject, center)).getStatusCode().value());
        verifyNoInteractions(organization, members);
        reads.ontologyOrgMembers().handler().read(subject, incoming);
        reads.ontologyPositionHolders().handler().read(subject, outgoing);
        verify(organization).memberLinks("domain", MemberRelation.UNIT_MEMBERSHIP, "org", false);
        verify(organization).memberLinks("domain", MemberRelation.POSITION_ASSIGNMENT, "member", true);
        verifyNoInteractions(members);

        doNothing().when(management).require(subject, "members.read");
        when(organization.linkedMemberIds("domain", MemberRelation.UNIT_MEMBERSHIP, "org"))
                .thenReturn(Set.of("member", "missing"));
        var identity = new SubjectDirectory.MemberIdentity("member", "member-login", "Name");
        when(members.memberIdentitiesInDomain("domain", Set.of("member", "missing"))).thenReturn(List.of(identity));
        assertEquals(List.of(new Name("member", "Name", "member-login")),
                reads.ontologyOrganizationMemberNames().handler().read(subject, incoming));
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, "organization.read");
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> reads.ontologyOrgMembers().handler().read(subject, incoming)).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> reads.ontologyOrganizationMemberNames().handler().read(subject, incoming)).getStatusCode().value());
        when(members.memberIdentitiesInDomain("domain", Set.of("member"))).thenReturn(List.of(identity));
        assertEquals(new OntologyGovernanceNeighborReads.Center(List.of(new Name("member", "Name", "member-login")), false),
                reads.ontologyGovernanceCenter().handler().read(subject, center));
        var self = Map.<String, Object>of("className", user, "primaryKey", "viewer");
        when(members.countInDomain("domain")).thenReturn(0L, 2L);
        assertEquals(new OntologyGovernanceNeighborReads.Center(List.of(), true),
                reads.ontologyGovernanceCenter().handler().read(subject, self));
        assertEquals(new OntologyGovernanceNeighborReads.Center(List.of(), false),
                reads.ontologyGovernanceCenter().handler().read(subject, self));
        verify(members, never()).subjectsInDomain(anyString());
    }

    @Test void grantRoleEdgesAndBothNameSourcesKeepTheirOwnReadGates() {
        var organization = mock(OrganizationDirectory.class);
        var roles = mock(PlatformAccessQuery.class);
        var grants = mock(CapabilityGrantQuery.class);
        var management = mock(ManagementRequestAccess.class);
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var reads = new OntologyGovernanceNeighborReads(null, roles, grants, null, organization, management, null);
        var grant = "platform:OrgGrant";
        var id = "position:lead";
        var scope = Map.<String, Object>of("className", grant, "primaryKey", id, "from", grant, "to", "platform:Role",
                "direction", "outgoing", "domainId", "outside");
        var edge = reads.ontologyOrgGrantRoles().handler();
        var center = reads.ontologyOrgGrantCenter().handler();
        var directory = reads.ontologyOrgGrantRoleDirectoryNames().handler();
        var workflow = reads.ontologyOrgGrantWorkflowRoleNames().handler();
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, "organization.read");
        for (var handler : List.of(edge, center, directory, workflow)) {
            assertEquals(403, assertThrows(ResponseStatusException.class,
                    () -> handler.read(subject, scope)).getStatusCode().value());
        }
        verifyNoInteractions(organization, roles, grants);
        doNothing().when(management).require(subject, "organization.read");
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, "roles.read");
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> directory.read(subject, scope)).getStatusCode().value());
        verifyNoInteractions(roles);
        edge.read(subject, scope);
        center.read(subject, scope);
        verify(organization).grantRoleLinks("domain", id, true);
        verify(organization).grantCenter("domain", id);
        when(organization.linkedGrantRoleIds("domain", id)).thenReturn(Set.of("role"));
        when(grants.grantRoleNamesInDomain("domain", Set.of("role"))).thenReturn(List.of(new RoleName("role", "Reviewer")));
        assertEquals(List.of(new RoleName("role", "Reviewer")), workflow.read(subject, scope));
        verify(grants).grantRoleNamesInDomain("domain", Set.of("role"));
        verifyNoMoreInteractions(grants);
    }

    @Test void eachEndpointReadsOnlyItsOwnDirectoryInTheCurrentDomain() throws Exception {
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("member", "domain"));
        var organization = mock(OrganizationDirectory.class);
        when(organization.snapshot("domain")).thenReturn(new OrganizationDirectory.Snapshot(
            List.of(new OrganizationDirectory.Unit("root", "Root", "R", "0")), List.of(), List.of(), List.of(), List.of()));
        var policies = mock(PermissionPolicyDirectory.class);
        when(policies.listPolicies("domain")).thenReturn(List.of(new PermissionPolicyDirectory.Policy("post", "Post", 2, false, "0")));
        when(policies.listRolePolicies("domain")).thenReturn(List.of(new PermissionPolicyDirectory.RolePolicy("role", "post")));
        when(policies.listPolicyDataPermissions("domain")).thenReturn(List.of(new PermissionPolicyDirectory.PolicyDataPermission("post", "Orders")));
        var mvc = MockMvcBuilders.standaloneSetup(new GovernanceDirectoryController(identity, organization, policies))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();

        mvc.perform(post("/platform/governance/organization").contentType(MediaType.APPLICATION_JSON)
            .content("{\"domainId\":\"other\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.units[0].id").value("root"));
        verify(organization).snapshot("domain");
        verifyNoInteractions(policies);
        mvc.perform(post("/platform/governance/policies")).andExpect(status().isOk())
            .andExpect(jsonPath("$.policies[0].id").value("post"));
        verify(policies).listPolicies("domain");
        verifyNoMoreInteractions(policies);
        mvc.perform(post("/platform/governance/role-policies")).andExpect(status().isOk())
            .andExpect(jsonPath("$.rolePolicies[0].roleId").value("role"));
        verify(policies).listRolePolicies("domain");
        verifyNoMoreInteractions(policies);
        mvc.perform(post("/platform/governance/policy-data-permissions")).andExpect(status().isOk())
            .andExpect(jsonPath("$.policyDataPermissions[0].className").value("Orders"));
        verify(policies).listPolicyDataPermissions("domain");
        verifyNoMoreInteractions(organization, policies);
    }
}
