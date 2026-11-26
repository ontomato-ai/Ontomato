package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.PresetAgentPolicies;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Owned
public class PublishedAgentPresetsController {
    public static final String PATH = "/authorization/objects/published-agent-presets";
    private final PresetAgentPolicies policies;
    private final WorkbenchServiceAuthentication workbench;

    public PublishedAgentPresetsController(PresetAgentPolicies policies, WorkbenchServiceAuthentication workbench) {
        this.policies = policies;
        this.workbench = workbench;
    }

    public record Presets(String domainId, List<UUID> ids) {}

    @PostMapping(PATH)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void initialize(HttpServletRequest request, @RequestBody Presets presets) {
        workbench.authenticate(request);
        if (presets.domainId() == null || presets.domainId().isBlank() || presets.ids() == null
                || presets.ids().stream().anyMatch(Objects::isNull)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The domain and installed agent IDs are required.");
        }
        if (!presets.ids().isEmpty()) {
            policies.initialize(presets.domainId(), presets.ids().stream().distinct().map(UUID::toString).toList());
        }
    }
}
