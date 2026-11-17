package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.*;

/** Java owns entry facts; panels retain only their shared content and manifest. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApplicationPanelUse(String id, String pageKey, String panelId, String path,
                                  Access access, PageSkills.Skill skill, String defaultAgentId) {
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Access(String permissionCode, String kind) {}

    public static List<PageSkills.Mapping> project(List<ApplicationPanelUse> uses) {
        var ids = new HashSet<String>();
        var pages = new HashSet<String>();
        var paths = new HashSet<String>();
        var mappings = new LinkedHashMap<String, PageSkills.Mapping>();
        for (var use : uses) {
            if (use.id() == null || use.id().isBlank() || !ids.add(use.id())
                || use.pageKey() == null || use.pageKey().isBlank() || !pages.add(use.pageKey())
                || use.panelId() == null || use.panelId().isBlank()
                || use.path() == null || !use.path().matches("/(?!/).*" ) || !paths.add(use.path())
                || use.access() == null || (use.access().permissionCode() == null) == (use.access().kind() == null)
                || use.defaultAgentId() != null && use.defaultAgentId().isBlank())
                throw ApplicationCatalog.bad("Invalid or duplicate panel use");
            var access = use.access();
            var defaults = use.defaultAgentId() == null ? List.<PageSkills.Default>of()
                : List.of(new PageSkills.Default(use.pageKey(), use.defaultAgentId()));
            var mapping = new PageSkills.Mapping(access.permissionCode(), access.kind(),
                access.kind() == null ? null : use.pageKey(), use.skill(), defaults);
            PageSkills.validate(List.of(mapping));
            var previous = mappings.get(mapping.locator());
            if (previous != null) {
                if (!previous.skill().equals(mapping.skill())) throw ApplicationCatalog.bad("A menu permission has one skill package");
                var combined = new ArrayList<>(previous.defaults()); combined.addAll(defaults);
                mapping = new PageSkills.Mapping(mapping.permissionCode(), mapping.access(), mapping.pageKey(), mapping.skill(), combined);
            }
            mappings.put(mapping.locator(), mapping);
        }
        return List.copyOf(mappings.values());
    }
}
