package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Applies the shipped object policies when Workbench installs preset definitions. */
@Service
public class PresetAgentPolicies {
    public interface RolePolicies {
        void initialize(String domainId, List<String> ids);
    }

    private final AuthorizationStore store;
    private final RolePolicies roles;

    public PresetAgentPolicies(AuthorizationStore store, RolePolicies roles) {
        this.store = store;
        this.roles = roles;
    }

    @Transactional
    public void initialize(String domainId, List<String> ids) {
        String policyId = store.domainPolicy(domainId).policyId();
        for (String id : ids) {
            store.grantObject(new ObjectGrant(policyId, new ObjectTarget(domainId, Kind.AGENT, id), Verb.USE, null));
        }
        roles.initialize(domainId, ids);
    }
}
