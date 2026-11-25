package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class PublishedAgentPresetsController {
    public static final String PATH = "/authorization/objects/published-agent-presets";
    private final AuthorizationStore store;
    private final WorkbenchServiceAuthentication workbench;
    private final JdbcTemplate jdbc;

    public PublishedAgentPresetsController(AuthorizationStore store, WorkbenchServiceAuthentication workbench, JdbcTemplate jdbc) {
        this.store = store;
        this.workbench = workbench;
        this.jdbc = jdbc;
    }

    public record Presets(String domainId, List<UUID> ids) {}

    /** Installation writes the release's selected use grant with the authority of the definition owner. */
    @PostMapping(PATH)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void initialize(HttpServletRequest request, @RequestBody Presets presets) {
        workbench.authenticate(request);
        if (presets.domainId() == null || presets.domainId().isBlank() || presets.ids() == null
                || presets.ids().stream().anyMatch(java.util.Objects::isNull))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The domain and installed agent IDs are required.");
        var policy = store.domainPolicy(presets.domainId());
        for (var id : presets.ids()) {
            if (!initialUse(presets.domainId(), id.toString())) continue;
            var target = new ObjectTarget(presets.domainId(), Kind.AGENT, id.toString());
            store.grantObject(new ObjectGrant(policy.policyId(), target, Verb.USE, null));
        }
    }
    private boolean initialUse(String domainId, String id) {
        // Older installations may have explicitly withdrawn the shipped domain grant.
        return jdbc.queryForObject("""
                SELECT NOT EXISTS (SELECT 1 FROM product_resource WHERE domain_id=? AND id=?)
                       OR EXISTS (SELECT 1 FROM product_grant
                                  WHERE domain_id=? AND resource_id=? AND principal_kind='domain'
                                    AND principal_id='*' AND verb='use')
                """, Boolean.class, domainId, id, domainId, id);
    }

}
