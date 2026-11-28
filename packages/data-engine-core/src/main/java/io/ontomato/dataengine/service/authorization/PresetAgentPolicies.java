package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Applies the shipped object policies when an owner installs preset agent definitions. */
@Service
public class PresetAgentPolicies {
    public interface RolePolicies {
        void initialize(String domainId, List<String> ids, boolean grantRoleUse);
    }

    private final AuthorizationStore store;
    private final RolePolicies roles;

    public PresetAgentPolicies(AuthorizationStore store, RolePolicies roles) {
        this.store = store;
        this.roles = roles;
    }

    /** Workbench presets also keep their existing direct role USE grants. */
    @Transactional
    public void initialize(String domainId, List<String> ids, boolean grantRoleUse) {
        String policyId = store.domainPolicy(domainId).policyId();
        for (String id : ids) {
            store.grantObject(new ObjectGrant(policyId, new ObjectTarget(domainId, Kind.AGENT, id), Verb.USE, null));
        }
        roles.initialize(domainId, ids, grantRoleUse);
    }
}
