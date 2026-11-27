package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.controller.PreviewAccess;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.core.bean.R;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.panelreads.OntologyNeighborScope;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.context.annotation.Bean;
import org.springframework.context.i18n.LocaleContextHolder;

@RestController
@Owned
public class ApplicationController {
    static final String CONNECT_APPLICATION = "applications.connected.create";

    @Component
    static final class Operations implements ManagementOperations.Contributor {
        @Override
        public List<ManagementOperations.Operation> managementOperations() {
            return List.of(new ManagementOperations.Operation(CONNECT_APPLICATION, "Register a connected application", ManagementOperations.Access.CHANGE));
        }
    }

    public static final String DECLARATIONS = "/platform/applications/self/declarations";
    public static final String PANEL_USES_BY_PANEL = "/platform/applications/panel-uses/by-panel";
    private final ApplicationCatalog catalog;
    private final IdentityService identity;
    private final WorkbenchServiceAuthentication authentication;
    public ApplicationController(ApplicationCatalog catalog, IdentityService identity, WorkbenchServiceAuthentication authentication) {
        this.catalog = catalog; this.identity = identity; this.authentication = authentication;
    }
    private User current() {
        var user = identity.getCurrentUser();
        if (user == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        return user;
    }
    public record Batch(List<ApplicationCatalog.Builtin> applications) {}
    public record Connected(String id, ApplicationCatalog.Declaration declaration, String upstream, String upstreamPrefix) {}
    /** Domain applications submit their entry and uses inside their assigned application path. */
    public record PanelEntry(String path, String renderer) {}
    public record PanelRegistration(PanelEntry entry, List<ApplicationPanelUse> panelUses,
                                    ApplicationCatalog.Declaration declaration, List<String> initialOpenEntryIds,
                                    String framePanelId, JsonNode theme, ApplicationCatalog.Delivery delivery,
                                    Boolean allowStandalone) {
        public PanelRegistration(PanelEntry entry, List<ApplicationPanelUse> panelUses,
                                 ApplicationCatalog.Declaration declaration, List<String> initialOpenEntryIds) {
            this(entry, panelUses, declaration, initialOpenEntryIds, null, null, null, null);
        }
        public PanelRegistration(PanelEntry entry, List<ApplicationPanelUse> panelUses,
                                 ApplicationCatalog.Declaration declaration, List<String> initialOpenEntryIds,
                                 String framePanelId, JsonNode theme, ApplicationCatalog.Delivery delivery) {
            this(entry, panelUses, declaration, initialOpenEntryIds, framePanelId, theme, delivery, null);
        }
    }
    public record CatalogueFormTarget(String kind, String id, String objectType, String primaryKey) {}
    public record CatalogueFormRequest(String section, CatalogueFormTarget target, JSONObject values, String changedField, String entryId) {
        public CatalogueFormRequest(String section, CatalogueFormTarget target, JSONObject values, String changedField) {
            this(section, target, values, changedField, null);
        }
    }
    public record IdentityUpdate(Map<String, String> names, Map<String, String> descriptions, String icon, Boolean allowStandalone) {
        public IdentityUpdate(Map<String, String> names, Map<String, String> descriptions, String icon) {
            this(names, descriptions, icon, null);
        }
    }

    @GetMapping("/platform/applications/catalogue")
    public R<JSONObject> catalogue(@RequestParam(defaultValue = "") String search,
            @RequestParam(defaultValue = "visible") String scope, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer page,
            @RequestParam(defaultValue = "30") int size, @RequestParam(defaultValue = "id") String sort,
            @RequestParam(defaultValue = "false") boolean countOnly, Locale locale) {
        User user = current();
        return R.of(countOnly ? catalog.catalogueCount(user)
                : catalog.catalogue(user, search, scope, cursor, page, size, sort, locale));
    }

    @Bean
    WorkbenchPanelRead applicationPanelCount() {
        return new WorkbenchPanelRead("platform:Application", "count", (subject, parameters) ->
            catalog.catalogueCount(subject).fluentPut("rows", List.of()));
    }

    @Bean
    WorkbenchPanelRead applicationPanelNavigation() {
        return new WorkbenchPanelRead("platform:Application", "navigation", (subject, parameters) ->
            catalog.visible(subject));
    }

    @Bean
    WorkbenchPanelRead applicationScheduleTargets() {
        return new WorkbenchPanelRead("platform:Application", "scheduleTargets", (subject, parameters) ->
            catalog.scheduleTargets(subject));
    }

    @Bean
    WorkbenchPanelRead applicationBuilderProjects() {
        return new WorkbenchPanelRead("platform:Application", "builderProjects", (subject, parameters) -> {
            if (!(parameters.getOrDefault("search", "") instanceof String search))
                throw ApplicationCatalog.bad("Application search must be text");
            return catalog.builderProjects(subject, search);
        });
    }

    @Bean
    WorkbenchPanelRead applicationBuilderProjectMetadata() {
        return new WorkbenchPanelRead("platform:Application", "builderProjectMetadata", (subject, parameters) -> {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank())
                throw ApplicationCatalog.bad("An application ID is required");
            return catalog.builderProjectMetadata(id, subject, LocaleContextHolder.getLocale());
        });
    }

    @Bean
    WorkbenchPanelRead applicationPanelNavigationCount() {
        return new WorkbenchPanelRead("platform:Application", "navigationCount", (subject, parameters) ->
            catalog.navigationCount(subject));
    }

    @Bean
    WorkbenchPanelRead applicationPanelNeighbors() {
        return new WorkbenchPanelRead("platform:OntologyType", "application.uses-panel", (subject, parameters) ->
            catalog.panelNeighborFacts(subject, OntologyNeighborScope.parse(parameters, "platform:Application", "platform:ProductPanel"),
                !Boolean.FALSE.equals(parameters.get("includeLinks"))));
    }

    @Bean
    WorkbenchPanelRead applicationPanelQuery() {
        return new WorkbenchPanelRead("platform:Application", "query", (subject, parameters) ->
            catalog.catalogue(subject, (String) parameters.getOrDefault("search", ""), (String) parameters.getOrDefault("scope", "visible"),
                (String) parameters.get("cursor"), (Integer) parameters.get("page"), (Integer) parameters.getOrDefault("size", 30),
                (String) parameters.getOrDefault("sort", "id"), LocaleContextHolder.getLocale()));
    }

    @Bean
    WorkbenchPanelRead applicationPanelRecord() {
        return applicationDetailRead("record", catalog::cataloguePanelRecord);
    }

    @Bean
    WorkbenchPanelRead applicationDeleteAvailability() {
        return applicationDetailRead("deleteAvailability", catalog::catalogueDeleteAvailability);
    }

    @Bean
    WorkbenchPanelRead applicationPanelUsedPanels() {
        return applicationDetailRead("usedPanels", catalog::catalogueUsedPanels);
    }

    @Bean
    WorkbenchPanelRead applicationPanelReferenceGraph() {
        return applicationDetailRead("referenceGraph", catalog::catalogueReferenceGraph);
    }

    @Bean
    WorkbenchPanelRead applicationPanelEntries() {
        return applicationEntriesRead("entries");
    }

    @Bean
    WorkbenchPanelRead applicationPanelEntryRows() {
        return applicationEntriesRead("entryRows");
    }

    private WorkbenchPanelRead applicationEntriesRead(String name) {
        return applicationDetailRead(name, (id, subject, locale) -> catalog.cataloguePanelEntries(id, subject, locale, "entryRows".equals(name)));
    }

    @FunctionalInterface
    private interface ApplicationDetailReader {
        JSONObject read(String id, SubjectContext subject, Locale locale);
    }

    private WorkbenchPanelRead applicationDetailRead(String name, ApplicationDetailReader reader) {
        return new WorkbenchPanelRead("platform:Application", name, (subject, parameters) -> {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank())
                throw ApplicationCatalog.bad("An application ID is required");
            return reader.read(id, subject, LocaleContextHolder.getLocale());
        });
    }

    @Bean
    WorkbenchPanelRead applicationPanelForm(ObjectMapper json) {
        return applicationPanelFormRead(false, json);
    }

    @Bean
    WorkbenchPanelRead applicationPanelCreateForm(ObjectMapper json) {
        return applicationPanelFormRead(true, json);
    }

    private WorkbenchPanelRead applicationPanelFormRead(boolean draft, ObjectMapper json) {
        return new WorkbenchPanelRead("platform:Application", draft ? "createForm" : "form", (subject, parameters) -> {
            var input = new JSONObject(parameters);
            var targetKind = draft ? "draft" : "object";
            if (!(input.get("target") instanceof Map<?, ?> target) || !targetKind.equals(target.get("kind"))
                    || input.containsKey("values") && !(input.get("values") instanceof Map<?, ?>))
                throw ApplicationCatalog.bad("An application " + targetKind + " form target and optional values object are required");

            var locale = LocaleContextHolder.getLocale();
            var formTarget = input.getJSONObject("target").toJavaObject(CatalogueFormTarget.class);
            var section = draft ? "create" : (String) input.get("section");
            var entryId = (String) input.get("entryId");
            var values = input.getJSONObject("values");
            if (Boolean.TRUE.equals(input.get("mergeCurrentValues"))) {
                if (values == null || "create".equals(section))
                    throw ApplicationCatalog.bad("Only an edit form with values can merge current values");
                var current = catalog.catalogueForm(new CatalogueFormRequest(section, formTarget, null, null, entryId), subject, locale);
                // Use the same JSON shape as the HTTP form, including nested entry records.
                var merged = json.convertValue(current.get("values"), JSONObject.class);
                merged.putAll(values);
                values = merged;
            }
            return catalog.catalogueForm(new CatalogueFormRequest(
                section, formTarget, values, (String) input.get("changedField"), entryId), subject, locale);
        });
    }

    @GetMapping("/platform/applications/catalogue/{id}")
    public R<JSONObject> catalogueRecord(@PathVariable String id, Locale locale) {
        return R.of(catalog.catalogueRecord(id, current(), locale));
    }

    @PostMapping("/platform/applications/catalogue/form")
    public R<JSONObject> catalogueForm(@RequestBody CatalogueFormRequest body, Locale locale) {
        return R.of(catalog.catalogueForm(body, current(), locale));
    }

    @GetMapping("/platform/applications/{id}/legacy-maintenance")
    public R<?> legacyMaintenance(@PathVariable String id) {
        return R.of(Map.of("legacyWritable", catalog.legacyMaintenance(id, current())));
    }

    @PutMapping("/platform/applications/{id}/identity")
    public R<IdentityUpdate> updateIdentity(@PathVariable String id, @RequestBody IdentityUpdate body) {
        return R.of(catalog.updateIdentity(id, body, current()));
    }

    @GetMapping("/platform/applications/resolve-entry")
    public R<JSONObject> resolveEntry(@RequestParam(required = false) String path,
            @RequestParam(required = false) String applicationId, @RequestParam(required = false) String useId) {
        if (path != null && applicationId == null && useId == null)
            return R.of(catalog.resolveEntry(path, current()));
        if (path == null && applicationId != null && !applicationId.isBlank() && useId != null && !useId.isBlank())
            return R.of(catalog.resolveEntry(applicationId, useId, current()));
        throw ApplicationCatalog.bad("Supply either path or both applicationId and useId");
    }

    @PreviewAccess
    @GetMapping("/platform/applications/registered-entry")
    public R<JSONObject> registeredEntry(HttpServletRequest request, @RequestParam String applicationId,
            @RequestParam String useId) {
        authentication.authenticate(request);
        return R.of(catalog.registeredEntry(applicationId, useId, current()));
    }

    @GetMapping("/platform/applications/{id}/panel-uses")
    public R<JSONObject> panelUses(@PathVariable String id) { return R.of(catalog.panelUses(id, current())); }
    @GetMapping(value = "/platform/applications/{id}/panel-uses", params = "purpose=management")
    public R<JSONObject> managePanelUses(@PathVariable String id) {
        return R.of(catalog.managePanelUses(id, current()));
    }

    @PutMapping("/platform/applications/{id}/panel-uses")
    public R<JSONObject> putPanelUses(@PathVariable String id, @RequestBody PanelRegistration body,
            @RequestParam(defaultValue = "false") boolean create, Locale locale) {
        return R.of(catalog.putPanelUses(id, body, current(), create, locale));
    }
    public record DomainOpening(JsonNode open) {}

    @PutMapping("/platform/applications/{id}/entries/{entryKey}/domain-opening")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void requestDomainEntryOpening(@PathVariable String id, @PathVariable String entryKey, @RequestBody DomainOpening body) {
        if (body.open() == null || !body.open().isBoolean()) throw ApplicationCatalog.bad("An open boolean is required");
        catalog.requestDomainEntryOpening(id, entryKey, body.open().booleanValue(), current());
    }

    @DeleteMapping("/platform/applications/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        catalog.deleteDomainApplication(id, current());
    }

    @Bean
    WorkbenchPanelRead productPanelUsedByRows() {
        return productPanelUsers("usedByRows");
    }

    @Bean
    WorkbenchPanelRead productPanelReferenceGraph() {
        return productPanelUsers("referenceGraph");
    }

    private WorkbenchPanelRead productPanelUsers(String name) {
        return new WorkbenchPanelRead("platform:ProductPanel", name, (subject, parameters) -> {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank())
                throw ApplicationCatalog.bad("A panel ID is required");
            return catalog.panelUsesByPanel(subject.identity().domainId(), id);
        });
    }

    @GetMapping(PANEL_USES_BY_PANEL)
    public R<List<ApplicationCatalog.PanelUseLocation>> panelUsesByPanel(HttpServletRequest request,
            @RequestParam String domainId, @RequestParam String panelId) {
        authentication.authenticate(request);
        if (domainId.isBlank() || panelId.isBlank()) throw ApplicationCatalog.bad("A domain and panel are required");
        return R.of(catalog.panelUsesByPanel(domainId, panelId));
    }

    @PostMapping("/platform/applications/connected")
    @Owned
    public R<JSONObject> connected(@RequestBody Connected body) {
        return R.of(catalog.connected(body.id(), body.declaration(), body.upstream(), body.upstreamPrefix(), current()));
    }
    @PostMapping(DECLARATIONS)
    public R<?> declare(HttpServletRequest request, @RequestBody Batch batch) {
        String service = authentication.authenticate(request);
        catalog.reconcileBuiltins(service, batch.applications());
        return R.of(Map.of("serviceId", service, "applicationIds", batch.applications().stream().map(ApplicationCatalog.Builtin::id).toList()));
    }
    @PreviewAccess
    @GetMapping(value = "/platform/applications", params = "purpose=navigation")
    public R<?> navigation(@RequestParam(defaultValue = "false") boolean countOnly) {
        var user = current();
        return R.of(countOnly ? catalog.navigationCount(user) : catalog.visible(user));
    }

    @GetMapping("/platform/applications")
    public R<?> list(@RequestParam(defaultValue="navigation") String purpose) {
        if (!purpose.equals("schedules")) return navigation(false);
        return R.of(catalog.scheduleTargets(current()));
    }
    @GetMapping("/platform/applications/{id}")
    public R<?> get(@PathVariable String id) {
        return R.of(catalog.view(id, current()));
    }
    public record IconUpdate(String icon) {}
    @PutMapping("/platform/applications/{id}/icon") public R<?> updateIcon(@PathVariable String id,@RequestBody IconUpdate body){catalog.updateIcon(id,body.icon(),current());return R.of(Map.of("icon",body.icon()));}
}
