package io.ontomato.dataengine.applications;

import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** The entry directory for policy governance, using the same roots as entry dependency events. */
public final class PolicyEntryCatalog {
    private PolicyEntryCatalog() {}

    public record EntryRoot(String entryId, String appId, String useId, String label, List<String> panelIds,
                            List<String> agentIds, boolean entryEntitlement) {}

    public static List<EntryRoot> list(ApplicationCatalog catalog, AuthorizationSubjects subjects, String domainId,
            Set<String> entryIds, Locale locale) {
        var result = new ArrayList<EntryRoot>();
        for (var application : catalog.entriesInDomain(domainId)) {
            var app = application.application();
            var appId = app.getString("id");
            var uses = application.entries();
            var roots = ApplicationEntryEvents.roots(app, uses);
            for (var use : uses) {
                var entryId = ApplicationEntryEvents.entryId(appId, use.id());
                if (!entryIds.isEmpty() && !entryIds.contains(entryId)) continue;
                var root = roots.getOrDefault(entryId, ApplicationEntryEvents.Roots.EMPTY);
                var entitlement = subjects.entryEntitlement(new ObjectTarget(domainId, Kind.ENTRY, entryId));
                result.add(new EntryRoot(entryId, appId, use.id(), use.displayName(locale),
                        root.panelIds(), root.agentIds(), entitlement));
            }
        }
        return result;
    }
}
