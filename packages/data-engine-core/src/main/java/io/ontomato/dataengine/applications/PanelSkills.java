package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class PanelSkills {
    private PanelSkills() {}

    /** A registered application use with its complete canonical route. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Use(String applicationId, String useId, String panelId, String path, PageSkills.Entrance entrance,
                      Map<String, String> names, Map<String, String> applicationNames) {}

    static Use source(String applicationId, ApplicationPanelUse use, Map<String, String> applicationNames) {
        return new Use(applicationId, use.id(), use.panelId(), use.path(), entrance(use), use.names(), applicationNames);
    }

    static PageSkills.Entrance entrance(ApplicationPanelUse use) {
        return new PageSkills.Entrance(use.access().permissionCode(), use.access().kind(), use.pageKey());
    }

    /** Preserve locator groups and per-page defaults for admitted entries. */
    static List<PageSkills.Mapping> groups(List<ApplicationPanelUse> admittedUses) {
        var byLocator = new LinkedHashMap<String, List<ApplicationPanelUse>>();
        for (var use : admittedUses)
            byLocator.computeIfAbsent(use.locator(), ignored -> new ArrayList<>()).add(use);

        return byLocator.values().stream().map(uses -> {
            var first = uses.getFirst();
            var defaults = uses.stream().filter(use -> use.defaultAgent() != null)
                .map(use -> new PageSkills.Default(use.pageKey(), use.defaultAgent())).toList();
            var pageKey = first.access().permissionCode() == null ? first.pageKey() : null;
            return new PageSkills.Mapping(first.access().permissionCode(), first.access().kind(), pageKey,
                null, defaults.isEmpty() ? null : defaults);
        }).toList();
    }
}
