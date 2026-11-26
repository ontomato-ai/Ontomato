package io.ontomato.dataengine.service.authorization;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import java.util.List;
import java.util.Set;

/** Each distribution supplies its own identity and the entitlements fixed by that distribution. */
public interface AuthorizationSubjects {
    RoleResolution resolveRoles(String domainId, String userId);

    boolean entryEntitlement(ObjectTarget entry);
    boolean objectEntitlement(String userId, ObjectTarget target, Verb verb);
    /** Whether the edition admits this verb for every published object of this kind in the current domain. */
    boolean domainWideObjectEntitlement(Kind kind, Verb verb);
    boolean managementEntitlement(String operationId);
    boolean unrestrictedStandaloneActions();

    List<String> organizationCodes(String domainId, Set<String> roots, GrantScope.Kind kind);
}
