package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Wire values owned by application declarations. */
public final class PageSkills {
    private PageSkills() {}
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Namespace(String kind, String provider, String domainId) {}
    public record Skill(Namespace namespace, String name) {}
    public record Default(String pageKey, DefaultAgentTarget defaultAgent) {}
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Mapping(String permissionCode, String access, String pageKey, Skill skill, List<Default> defaults) {
        public String locator() { return PageSkills.locator(permissionCode, access, pageKey); }
    }
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Entrance(String permissionCode, String access, String pageKey) {}
    public record Projection(List<Mapping> pageSkills, List<Skill> registeredSkills, List<Entrance> admittedEntrances) {}

    static Mapping withPanelDefaults(Mapping nativeMapping, Mapping panelGroup) {
        if (panelGroup.defaults() == null) return nativeMapping;
        var defaults = new ArrayList<Default>();
        if (nativeMapping.defaults() != null) defaults.addAll(nativeMapping.defaults());
        defaults.addAll(panelGroup.defaults());
        return new Mapping(nativeMapping.permissionCode(), nativeMapping.access(), nativeMapping.pageKey(),
            nativeMapping.skill(), defaults);
    }

    public static String locator(String permissionCode, String access, String pageKey) {
        return permissionCode != null ? "permission:" + permissionCode : "access:" + access + ":" + pageKey;
    }

    /** Validate declarations and persisted catalog data at their ingestion boundary. */
    public static void validate(List<Mapping> mappings) {
        Set<String> locators = new HashSet<>();
        for (var mapping : mappings) {
            if ((mapping.permissionCode() == null) == (mapping.access() == null)
                || mapping.permissionCode() != null && mapping.permissionCode().isBlank()
                || mapping.access() != null && !mapping.access().equals("domain-member")
                || mapping.access() != null && (mapping.pageKey() == null || mapping.pageKey().isBlank())
                || mapping.permissionCode() != null && mapping.pageKey() != null
                || !locators.add(mapping.locator())) throw ApplicationCatalog.bad("Invalid or duplicate page skill locator");
            var skill = mapping.skill();
            if (skill == null || skill.namespace() == null || skill.name() == null
                || !skill.name().matches("[a-z0-9]+(?:-[a-z0-9]+)*") || skill.name().length() > 64)
                throw ApplicationCatalog.bad("Invalid page skill identity");
            var namespace = skill.namespace();
            if (!("provider".equals(namespace.kind()) && namespace.provider() != null && !namespace.provider().isBlank() && namespace.domainId() == null
                || "domain".equals(namespace.kind()) && namespace.domainId() != null && !namespace.domainId().isBlank() && namespace.provider() == null))
                throw ApplicationCatalog.bad("Invalid page skill namespace");
            if (mapping.defaults() != null) {
                Set<String> pages = new HashSet<>();
                for (var entry : mapping.defaults())
                    if (entry.pageKey() == null || entry.pageKey().isBlank() || entry.defaultAgent() == null
                        || !pages.add(entry.pageKey())) throw ApplicationCatalog.bad("Invalid page skill default");
            }
        }
    }
}
