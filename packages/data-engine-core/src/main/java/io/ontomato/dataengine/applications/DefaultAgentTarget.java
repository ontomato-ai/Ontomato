package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;

/** The declared agent target, resolved against the caller's candidates by the host. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record DefaultAgentTarget(String kind, String id, String agentKind) {
    public DefaultAgentTarget {
        boolean concrete = "id".equals(kind) && id != null && !id.isBlank() && agentKind == null;
        boolean preset = "preset".equals(kind) && agentKind != null && !agentKind.isBlank() && id == null;
        if (!concrete && !preset) throw ApplicationCatalog.bad("Invalid default agent target");
    }
}
