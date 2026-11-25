package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;

public final class PanelSkills {
    private PanelSkills() {}

    /** A registered application use with its complete canonical route. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Use(String applicationId, String useId, String panelId, String path, PageSkills.Entrance entrance,
                      Map<String, String> names, Map<String, String> applicationNames) {}

    static Use source(String applicationId, ApplicationPanelUse use, Map<String, String> applicationNames) {
        return new Use(applicationId, use.id(), use.panelId(), use.path(), entrance(applicationId, use), use.names(), applicationNames);
    }

    static PageSkills.Entrance entrance(String applicationId, ApplicationPanelUse use) {
        return new PageSkills.Entrance(applicationId, use.id(), use.pageKey());
    }
}
