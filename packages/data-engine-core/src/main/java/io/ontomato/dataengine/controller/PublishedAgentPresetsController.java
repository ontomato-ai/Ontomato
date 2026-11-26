package io.ontomato.dataengine.controller;

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
public class PublishedAgentPresetsController {
    public static final String PATH = "/authorization/objects/published-agent-presets";
    private final PresetAgentPolicies policies;
    private final WorkbenchServiceAuthentication workbench;

    public PublishedAgentPresetsController(PresetAgentPolicies policies, WorkbenchServiceAuthentication workbench) {
        this.policies = policies;
        this.workbench = workbench;
    }

    public record Presets(String domainId, List<UUID> ids, List<UUID> createdIds) {}

    @PostMapping(PATH)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void initialize(HttpServletRequest request, @RequestBody Presets presets) {
        workbench.authenticate(request);
        if (presets.domainId() == null || presets.domainId().isBlank() || presets.ids() == null
                || presets.createdIds() == null || presets.ids().stream().anyMatch(Objects::isNull)
                || !presets.ids().containsAll(presets.createdIds())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The domain, preset IDs and their newly installed subset are required.");
        }
        var created = presets.createdIds().stream().distinct().map(UUID::toString).toList();
        var existing = presets.ids().stream().distinct().filter(id -> !presets.createdIds().contains(id))
                .map(UUID::toString).toList();
        policies.initialize(presets.domainId(), PresetAgentPolicies.Source.WORKBENCH, created, existing);
    }
}
