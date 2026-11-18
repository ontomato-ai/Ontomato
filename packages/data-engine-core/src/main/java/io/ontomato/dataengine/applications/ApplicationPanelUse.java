package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.*;

/** Java owns entry facts; panels retain only their shared content and manifest. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApplicationPanelUse(String id, String pageKey, String panelId, String path,
                                  Access access, String defaultAgentId, Map<String,String> names) {
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Access(String permissionCode, String kind) {}

    public String locator() { return PageSkills.locator(access.permissionCode(), access.kind(), pageKey); }

    public static void validate(List<ApplicationPanelUse> uses) {
        var ids = new HashSet<String>();
        var pages = new HashSet<String>();
        var paths = new HashSet<String>();
        for (var use : uses) {
            if (use.id() == null || use.id().isBlank() || !ids.add(use.id())
                || use.pageKey() == null || use.pageKey().isBlank() || !pages.add(use.pageKey())
                || use.panelId() == null || use.panelId().isBlank()
                || use.path() == null || !use.path().matches("/(?!/).*" ) || !paths.add(use.path())
                || use.access() == null || (use.access().permissionCode() == null) == (use.access().kind() == null)
                || use.access().permissionCode() != null && use.access().permissionCode().isBlank()
                || use.access().kind() != null && !use.access().kind().equals("domain-member")
                || use.defaultAgentId() != null && use.defaultAgentId().isBlank())
                throw ApplicationCatalog.bad("Invalid or duplicate panel use");
            if (use.names() != null && (use.names().get("en") == null || use.names().get("en").isBlank()
                || use.names().values().stream().anyMatch(name -> name == null || name.isEmpty())))
                throw ApplicationCatalog.bad("A panel use's names require a nonblank English name and nonempty translations");
        }
    }
}
