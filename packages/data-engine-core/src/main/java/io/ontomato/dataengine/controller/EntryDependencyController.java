package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.applications.ApplicationEntryEvents;
import io.ontomato.dataengine.core.bean.R;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.EntryDependencyChanges;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Owned
public final class EntryDependencyController {
    public static final String AFFECTED_ROOTS = "/platform/applications/service/affected-entry-roots";
    public static final String PUBLICATION = "/permissions/service/entry-dependency-changes";
    public static final String EVENTS = "/platform/events/service";

    public record AffectedRoots(String domainId, Set<String> panelIds) {}

    private final ApplicationCatalog catalog;
    private final ApplicationEntryEvents events;
    private final EntryDependencyChanges changes;
    private final WorkbenchServiceAuthentication authentication;

    public EntryDependencyController(ApplicationCatalog catalog, ApplicationEntryEvents events,
            EntryDependencyChanges changes, WorkbenchServiceAuthentication authentication) {
        this.catalog = catalog;
        this.events = events;
        this.changes = changes;
        this.authentication = authentication;
    }

    @PostMapping(AFFECTED_ROOTS)
    public R<?> roots(HttpServletRequest request, @RequestBody AffectedRoots input) {
        authentication.authenticate(request);
        if (input.panelIds() == null || input.domainId() != null && input.domainId().isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A panel set is required");
        return R.of(Map.of("entries", catalog.affectedEntryRoots(input.domainId(), input.panelIds())));
    }

    @PostMapping(PUBLICATION)
    public Map<String, Boolean> publish(HttpServletRequest request, @RequestBody EntryDependencyChanges.Publication input) {
        authentication.authenticate(request);
        changes.apply(input);
        return Map.of("success", true);
    }

    @GetMapping(EVENTS)
    public R<ApplicationEntryEvents.Page> events(HttpServletRequest request,
            @RequestParam(defaultValue = "0") long after, @RequestParam(defaultValue = "100") int limit) {
        authentication.authenticate(request);
        return R.of(events.read(after, limit));
    }
}
