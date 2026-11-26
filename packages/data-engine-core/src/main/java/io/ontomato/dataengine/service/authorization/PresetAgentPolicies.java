package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.service.ProductGrantService;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Applies the shipped defaults or carries forward recorded grants at preset installation time. */
@Service
public class PresetAgentPolicies {
    public enum Source { WORKBENCH, RETRIEVER }

    public record AgentGrant(String agentId, Verb verb) {}

    public interface RolePolicies {
        void initialize(String domainId, Source source, List<String> created, Map<String, List<AgentGrant>> legacyByRole);
    }

    private final AuthorizationStore store;
    private final ProductGrantService legacy;
    private final RolePolicies roles;

    public PresetAgentPolicies(AuthorizationStore store, ProductGrantService legacy, RolePolicies roles) {
        this.store = store;
        this.legacy = legacy;
        this.roles = roles;
    }

    @Transactional
    public void initialize(String domainId, Source source, List<String> created, List<String> existing) {
        var memberUse = new ArrayList<>(created);
        var legacyByRole = new LinkedHashMap<String, List<AgentGrant>>();
        for (String id : existing) {
            for (var grant : legacy.legacyPresetGrants(domainId, id)) {
                if ("domain".equals(grant.principalKind()) && "*".equals(grant.principalId()) && "use".equals(grant.verb())) {
                    memberUse.add(id);
                }
                if ("role".equals(grant.principalKind())) {
                    Verb verb = Verb.valueOf(grant.verb().toUpperCase(Locale.ROOT));
                    legacyByRole.computeIfAbsent(grant.principalId(), key -> new ArrayList<>()).add(new AgentGrant(id, verb));
                }
            }
        }
        if (!memberUse.isEmpty()) {
            String policyId = store.domainPolicy(domainId).policyId();
            for (String id : memberUse) {
                store.grantObject(new ObjectGrant(policyId, new ObjectTarget(domainId, Kind.AGENT, id), Verb.USE, null));
            }
        }
        roles.initialize(domainId, source, created, legacyByRole);
    }
}
