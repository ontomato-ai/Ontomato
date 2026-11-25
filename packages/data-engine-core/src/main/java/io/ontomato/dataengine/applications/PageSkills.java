package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
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
    public record Declaration(String entryKey, String pageKey, Skill skill, List<Default> defaults) {}
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Mapping(String applicationId, String entryKey, String pageKey, Skill skill, List<Default> defaults) {}
    public record Entrance(String applicationId, String entryKey, String pageKey) {}
    public record Projection(List<Mapping> pageSkills, List<Skill> registeredSkills, List<Entrance> admittedEntrances) {}

    static void validate(List<Declaration> mappings) {
        Set<String> entries = new HashSet<>();
        for (var mapping : mappings) {
            if (!ApplicationCatalog.validEntryKey(mapping.entryKey())
                    || mapping.pageKey() == null || mapping.pageKey().isBlank()
                    || !entries.add(mapping.entryKey())) throw ApplicationCatalog.bad("Invalid or duplicate page skill entry");
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
                    if (!mapping.pageKey().equals(entry.pageKey()) || entry.defaultAgent() == null
                        || !pages.add(entry.pageKey())) throw ApplicationCatalog.bad("Invalid page skill default");
            }
        }
    }
}
