package io.ontomato.dataengine.service.authorization;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class AuthorizationTypes {
    private AuthorizationTypes() {}

    public enum Kind { ENTRY, PANEL, PROJECTION, COMPONENT, AGENT, ACTION, METRIC, READ_FUNCTION, APPLICATION, WORKFLOW }
    public enum Verb { ENTER, USE, VIEW, EDIT, CREATE, EXECUTE }
    public enum PolicyKind { OBJECT, MANAGEMENT }
    public enum DefinitionState { DRAFT, PUBLISHED }

    public record ObjectTarget(String domainId, Kind kind, String id) {}
    public record OwnerFacts(String ownerId, DefinitionState state, List<String> coauthorIds) {
        public OwnerFacts {
            java.util.Objects.requireNonNull(state, "Definition state is required");
            coauthorIds = coauthorIds == null ? List.of() : List.copyOf(coauthorIds);
        }

        public OwnerFacts(String ownerId, DefinitionState state) {
            this(ownerId, state, List.of());
        }
    }

    public record PolicyRef(String roleId, String policyId, PolicyKind kind) {}

    public record ObjectGrant(String policyId, ObjectTarget target, Verb verb, GrantScope scope) {}

    public record PendingGrant(long id, String source, String changeKey, String actorId,
                               ObjectTarget entry, ObjectGrant grant) {}

    public record RoleSource(String grantId, String grantType, String sourceId, String orgId, String roleId) {}

    public record RoleResolution(
            Set<String> effectiveRoleIds,
            Set<String> directRoleIds,
            List<RoleSource> organizationGrants,
            Set<String> membershipRoots,
            Map<String, Set<String>> grantRootsByRole,
            boolean administrator) {
        public Set<String> rootsForRole(String roleId) {
            return directRoleIds.contains(roleId) ? membershipRoots : grantRootsByRole.getOrDefault(roleId, Set.of());
        }
    }
}
