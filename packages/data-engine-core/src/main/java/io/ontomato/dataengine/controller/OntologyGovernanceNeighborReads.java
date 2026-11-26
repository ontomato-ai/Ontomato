package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.panelreads.OntologyNeighborScope;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.CapabilityGrantQuery;
import io.ontomato.dataengine.service.OntologyNeighborFacts;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Link;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Name;
import io.ontomato.dataengine.service.OrganizationDirectory;
import io.ontomato.dataengine.service.OrganizationDirectory.MemberRelation;
import io.ontomato.dataengine.service.PermissionPolicyDirectory;
import io.ontomato.dataengine.service.PermissionPolicyDirectory.PolicyDataNeighbor;
import io.ontomato.dataengine.service.PlatformAccessQuery;
import io.ontomato.dataengine.service.PlatformAccessQuery.RoleName;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Management;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectGrant;
import java.util.LinkedHashMap;
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
public class OntologyGovernanceNeighborReads {
    private static final String ONTOLOGY = "platform:OntologyType";
    private static final String USER = "platform:User";
    private static final String ROLE = "platform:Role";
    private static final String POLICY = "platform:PermissionPolicy";
    private static final String OBJECT_TYPE = "platform:ObjectType";
    private static final String APPLICATION = "platform:Application";
    private static final String ACTION = "platform:Action";
    private static final String ORG_UNIT = "platform:OrgUnit";
    private static final String ORG_POSITION = "platform:OrgPosition";
    private static final String ORG_GRANT = "platform:OrgGrant";

    public record Center(List<Name> names, boolean emptyDirectory) {}

    private final SubjectDirectory members;
    private final PlatformAccessQuery roles;
    private final CapabilityGrantQuery grants;
    private final PermissionPolicyDirectory policies;
    private final OrganizationDirectory organization;
    private final ManagementRequestAccess management;
    private final AuthorizationService authorization;

    OntologyGovernanceNeighborReads(SubjectDirectory members, PlatformAccessQuery roles, CapabilityGrantQuery grants,
            PermissionPolicyDirectory policies, OrganizationDirectory organization, ManagementRequestAccess management,
            AuthorizationService authorization) {
        this.members = members;
        this.roles = roles;
        this.grants = grants;
        this.policies = policies;
        this.organization = organization;
        this.management = management;
        this.authorization = authorization;
    }

    @Bean
    WorkbenchPanelRead ontologyMemberRoles() {
        return new WorkbenchPanelRead(ONTOLOGY, "user.holds-role", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, USER, ROLE);
            management.require(subject, GovernanceDirectoryController.MEMBERS_READ);
            var directory = members.subjectsInDomain(subject.identity().domainId());
            var matching = directory.stream().filter(member -> scope.outgoing()
                ? scope.centerId().equals(member.id()) : member.roleIds().contains(scope.centerId())).toList();
            var links = matching.stream().flatMap(member -> member.roleIds().stream()
                .filter(roleId -> scope.outgoing() || scope.centerId().equals(roleId))
                .map(roleId -> new Link(member.id(), roleId))).toList();
            return new OntologyNeighborFacts(links, matching.stream().map(OntologyGovernanceNeighborReads::memberName).toList(),
                scope.outgoing() ? roleNames(subject, linkedIds(links, false), false) : List.of());
        });
    }

    @Bean
    WorkbenchPanelRead ontologyRolePolicies() {
        return new WorkbenchPanelRead(ONTOLOGY, "role.uses-permission-policy", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, ROLE, POLICY);
            management.require(subject, AuthorizationPolicies.READ);
            var domain = subject.identity().domainId();
            var links = policies.listRolePolicies(domain).stream().filter(link -> scope.outgoing()
                ? scope.centerId().equals(link.roleId()) : scope.centerId().equals(link.policyId()))
                .map(link -> new Link(link.roleId(), link.policyId())).toList();
            return new OntologyNeighborFacts(links, scope.outgoing() ? List.of() : roleNames(subject, linkedIds(links, true), false),
                scope.outgoing() ? policyNames(domain, linkedIds(links, false)) : List.of());
        });
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyDataNeighbors() {
        return new WorkbenchPanelRead(ONTOLOGY, "permission-policy.governs-object-type", (subject, parameters) -> {
            var scope = policyDataScope(subject, parameters);
            var rows = policies.policyDataNeighbors(subject.identity().domainId(), scope.centerId(), scope.outgoing());
            var links = rows.stream().map(row -> new Link(row.policyId(), row.className())).toList();
            var policyNames = scope.incoming() ? rows.stream()
                    .map(row -> new Name(row.policyId(), row.policyName(), null)).toList() : List.<Name>of();
            return new OntologyNeighborFacts(links, policyNames, List.of());
        });
    }

    @Bean
    WorkbenchPanelRead ontologyEntryGrantPolicyNames(AuthorizationStore store) {
        return new WorkbenchPanelRead(ONTOLOGY, "entryGrantPolicyNames", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, POLICY, APPLICATION);
            if (!scope.incoming())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected an application center");
            management.require(subject, AuthorizationPolicies.READ);
            var domain = subject.identity().domainId();
            var ids = store.applicationEntryGrants(domain, scope.centerId()).stream()
                .map(ObjectGrant::policyId).collect(Collectors.toSet());
            return scopedPolicyNames(domain, ids);
        });
    }

    @Bean
    WorkbenchPanelRead ontologyActionGrantPolicyNames(AuthorizationStore store) {
        return new WorkbenchPanelRead(ONTOLOGY, "actionGrantPolicyNames", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, POLICY, ACTION);
            if (!scope.incoming())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected an Action center");
            management.require(subject, AuthorizationPolicies.READ);
            var domain = subject.identity().domainId();
            var ids = store.actionPolicyGrants(domain, scope.centerId()).stream()
                .map(ObjectGrant::policyId).collect(Collectors.toSet());
            return scopedPolicyNames(domain, ids);
        });
    }

    @Bean
    WorkbenchPanelRead ontologyPolicyDataObjectTypeNames(AdminController model) {
        return new WorkbenchPanelRead(ONTOLOGY, "policyDataObjectTypeNames", (subject, parameters) -> {
            var scope = policyDataScope(subject, parameters);
            if (!scope.outgoing())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a permission policy center");
            management.require(subject, OntologyModelController.Operations.READ);
            var domain = subject.identity().domainId();
            var ids = policies.policyDataNeighbors(domain, scope.centerId(), true).stream()
                    .map(PolicyDataNeighbor::className).collect(Collectors.toSet());
            return model.modelObjectTypeEndpoints(domain, ids);
        });
    }

    private OntologyNeighborScope policyDataScope(SubjectContext subject, Map<String, Object> parameters) {
        var scope = OntologyNeighborScope.parse(parameters, POLICY, OBJECT_TYPE);
        management.require(subject, AuthorizationPolicies.READ);
        return scope;
    }

    @Bean
    WorkbenchPanelRead ontologyOrgUnitChildren() {
        return new WorkbenchPanelRead(ONTOLOGY, "org-unit.has-child", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, ORG_UNIT, ORG_UNIT);
            management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
            return organization.unitChildLinks(subject.identity().domainId(), scope.centerId(), scope.outgoing(), scope.incoming());
        });
    }

    @Bean
    WorkbenchPanelRead ontologyOrgUnitPositions() {
        return new WorkbenchPanelRead(ONTOLOGY, "org-unit.has-position", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, ORG_UNIT, ORG_POSITION);
            management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
            return organization.unitPositionLinks(subject.identity().domainId(), scope.centerId(), scope.outgoing());
        });
    }

    @Bean
    WorkbenchPanelRead ontologyOrgMembers() {
        return organizationMemberLinks("user.member-of-org-unit", ORG_UNIT, MemberRelation.UNIT_MEMBERSHIP);
    }

    @Bean
    WorkbenchPanelRead ontologyPositionHolders() {
        return organizationMemberLinks("user.holds-org-position", ORG_POSITION, MemberRelation.POSITION_ASSIGNMENT);
    }

    private WorkbenchPanelRead organizationMemberLinks(String name, String targetClass, MemberRelation relation) {
        return new WorkbenchPanelRead(ONTOLOGY, name, (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, USER, targetClass);
            management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
            return organization.memberLinks(subject.identity().domainId(), relation, scope.centerId(), scope.outgoing());
        });
    }

    @Bean
    WorkbenchPanelRead ontologyOrganizationMemberNames() {
        return new WorkbenchPanelRead(ONTOLOGY, "organizationMemberNames", (subject, parameters) -> {
            var centerClass = parameters.get("className");
            var relation = switch (centerClass) {
                case String type when ORG_UNIT.equals(type) -> MemberRelation.UNIT_MEMBERSHIP;
                case String type when ORG_POSITION.equals(type) -> MemberRelation.POSITION_ASSIGNMENT;
                case null, default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid organization member center");
            };
            var scope = OntologyNeighborScope.parse(parameters, USER, (String) centerClass);
            management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
            management.require(subject, GovernanceDirectoryController.MEMBERS_READ);
            var domain = subject.identity().domainId();
            return memberNames(domain, organization.linkedMemberIds(domain, relation, scope.centerId()));
        });
    }

    @Bean
    WorkbenchPanelRead ontologyOrgGrantCenter() {
        return new WorkbenchPanelRead(ONTOLOGY, "orgGrantCenter", (subject, parameters) -> {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "An organization grant ID is required");
            management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
            return organization.grantCenter(subject.identity().domainId(), id);
        });
    }

    @Bean
    WorkbenchPanelRead ontologyOrgGrantUnits() {
        return organizationGrantTargets("org-grant.applies-to-org-unit", ORG_UNIT, false);
    }

    @Bean
    WorkbenchPanelRead ontologyOrgGrantPositions() {
        return organizationGrantTargets("org-grant.applies-to-org-position", ORG_POSITION, true);
    }

    private WorkbenchPanelRead organizationGrantTargets(String name, String target, boolean position) {
        return new WorkbenchPanelRead(ONTOLOGY, name, (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, ORG_GRANT, target);
            management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
            return organization.grantRecipientLinks(subject.identity().domainId(), scope.centerId(), scope.outgoing(), position);
        });
    }

    @Bean
    WorkbenchPanelRead ontologyOrgGrantRoles() {
        return new WorkbenchPanelRead(ONTOLOGY, "org-grant.grants-role", (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, ORG_GRANT, ROLE);
            management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
            return organization.grantRoleLinks(subject.identity().domainId(), scope.centerId(), scope.outgoing());
        });
    }

    @Bean
    WorkbenchPanelRead ontologyOrgGrantRoleDirectoryNames() {
        return orgGrantRoleNames("orgGrantRoleDirectoryNames", GovernanceDirectoryController.ROLES_READ, roles::roleNamesInDomain);
    }

    @Bean
    WorkbenchPanelRead ontologyOrgGrantWorkflowRoleNames() {
        return orgGrantRoleNames("orgGrantWorkflowRoleNames", WorkflowController.READ, grants::grantRoleNamesInDomain);
    }

    private WorkbenchPanelRead orgGrantRoleNames(String name, String operation, BiFunction<String, Set<String>, List<RoleName>> directory) {
        return new WorkbenchPanelRead(ONTOLOGY, name, (subject, parameters) -> {
            var scope = OntologyNeighborScope.parse(parameters, ORG_GRANT, ROLE);
            if (!scope.outgoing()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected an organization grant center");
            management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
            management.require(subject, operation);
            var domain = subject.identity().domainId();
            var ids = organization.linkedGrantRoleIds(domain, scope.centerId());
            return ids.isEmpty() ? List.of() : directory.apply(domain, ids);
        });
    }

    @Bean
    WorkbenchPanelRead ontologyGovernanceCenter() {
        return new WorkbenchPanelRead(ONTOLOGY, "governanceCenter", (subject, parameters) -> {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank()
                    || !(parameters.get("className") instanceof String className))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "An ontology center ID is required");
            var ids = Set.of(id);
            var domain = subject.identity().domainId();
            return switch (className) {
                case USER -> {
                    management.require(subject, GovernanceDirectoryController.MEMBERS_READ);
                    var names = memberNames(domain, ids);
                    boolean emptyDirectory = names.isEmpty() && id.equals(subject.identity().userId())
                            && members.countInDomain(domain) == 0;
                    yield new Center(names, emptyDirectory);
                }
                case ROLE -> new Center(roleNames(subject, ids, true), false);
                case POLICY -> {
                    management.require(subject, AuthorizationPolicies.READ);
                    yield new Center(scopedPolicyNames(domain, ids), false);
                }
                case ORG_UNIT -> {
                    management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
                    yield new Center(organization.unitCenter(domain, id).stream()
                        .map(unit -> new Name(unit.id(), unit.name(), null, unit.code())).toList(), false);
                }
                case ORG_POSITION -> {
                    management.require(subject, GovernanceDirectoryController.ORGANIZATION_READ);
                    yield new Center(organization.positionCenter(domain, id).stream()
                        .map(position -> new Name(position.id(), position.name(), null, position.orgName())).toList(), false);
                }
                default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown ontology governance center");
            };
        });
    }

    private List<Name> memberNames(String domain, Set<String> ids) {
        return members.memberIdentitiesInDomain(domain, ids).stream()
            .map(member -> new Name(member.id(), member.displayName(), member.loginCode())).toList();
    }

    private static Name memberName(SubjectDirectory.Subject member) {
        return new Name(member.id(), member.displayName(), member.loginCode());
    }

    private static Set<String> linkedIds(List<Link> links, boolean from) {
        return links.stream().map(link -> from ? link.fromId() : link.toId()).collect(Collectors.toSet());
    }

    private List<Name> policyNames(String domain, Set<String> ids) {
        return policies.listPolicies(domain).stream().filter(policy -> ids.contains(policy.id()))
            .map(policy -> new Name(policy.id(), policy.name(), null)).toList();
    }

    private List<Name> scopedPolicyNames(String domain, Set<String> ids) {
        return policies.policyNamesInDomain(domain, ids).stream()
            .map(policy -> new Name(policy.id(), policy.name(), null)).toList();
    }

    private List<Name> roleNames(SubjectContext subject, Set<String> ids, boolean center) {
        if (ids.isEmpty()) return List.of();
        var domain = subject.identity().domainId();
        var directoryAccess = authorization.decide(subject, new Management(GovernanceDirectoryController.ROLES_READ));
        var names = new LinkedHashMap<String, String>();
        if (directoryAccess.allowed()) {
            for (var role : roles.roleNamesInDomain(domain, ids)) names.put(role.roleId(), role.roleCode());
        }
        boolean grantsAllowed = authorization.decide(subject, new Management(WorkflowController.READ)).allowed();
        if (grantsAllowed) {
            for (var grant : grants.grantRoleNamesInDomain(domain, ids)) {
                var code = names.get(grant.roleId());
                if (code == null || code.isBlank()) names.put(grant.roleId(), grant.roleCode());
            }
        }
        if (center && !directoryAccess.allowed() && names.isEmpty()
                && (!grantsAllowed || grants.countRolesInDomain(domain).total() == 0))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, directoryAccess.reason());
        return names.entrySet().stream().map(entry -> new Name(entry.getKey(), entry.getValue(), null)).toList();
    }
}
