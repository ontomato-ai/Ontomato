package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.BuiltinProductIds;
import java.nio.charset.StandardCharsets;
import java.text.Collator;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.ProductGrants;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.DefinitionState;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.OwnerFacts;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import java.util.*;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@Service
public class ApplicationCatalog {
    private static final org.slf4j.Logger log = LoggerFactory.getLogger(ApplicationCatalog.class);
    public static final String DEFAULT_FRAME_PANEL_ID = "builtin-product-platform-frame";
    public record PanelUseLocation(String applicationId, Map<String, String> names, String useId, String path) {}
    public record EntryMenu(Map<String, String> names, List<Group> groups, List<ApplicationPanelUse> panelUses, boolean singleEntry) {}
    public record Delivery(List<String> panels, List<String> projections, List<String> packages, List<String> agents,
                           List<PageSkills.Skill> skills) {}
    private record PanelSettings(String framePanelId, JsonNode theme, Delivery delivery) {
        JSONObject json() {
            var result = new JSONObject();
            if (framePanelId != null) result.put("framePanelId", framePanelId);
            if (theme != null) result.put("theme", JSON.parseObject(theme.toString()));
            if (delivery != null) result.put("delivery", delivery);
            return result;
        }
    }
    public record Group(String key, Map<String,String> names, int sort) {}
    public record Declaration(Map<String,String> names, Map<String,String> descriptions, String icon,
                              List<Group> groups, List<PageSkills.Declaration> pageSkills,
                              List<ApplicationPanelUse> panelUses) {
        public Declaration {
            pageSkills = pageSkills == null ? List.of() : pageSkills;
            panelUses = panelUses == null ? List.of() : panelUses;
        }
    }
    public record Builtin(String id, String kind, String rail, String category, int sort, JSONObject entry,
                          String scheduleAdapter, Declaration declaration,
                          Boolean allowStandalone, String framePanelId) {
        public Builtin(String id, String kind, String rail, String category, int sort, JSONObject entry,
                       String scheduleAdapter, Declaration declaration) {
            this(id, kind, rail, category, sort, entry, scheduleAdapter, declaration, null, null);
        }

        public Builtin(String id, String kind, String rail, String category, int sort, JSONObject entry,
                       String scheduleAdapter, Declaration declaration,
                       Boolean allowStandalone) {
            this(id, kind, rail, category, sort, entry, scheduleAdapter, declaration, allowStandalone, null);
        }

        public boolean allowsStandalone() {
            return !Boolean.FALSE.equals(allowStandalone);
        }
    }

    static boolean allowsStandalone(JSONObject app) {
        return app == null || !Boolean.FALSE.equals(app.get("allowStandalone"));
    }
    private record BuiltinEntry(String applicationId, ApplicationPanelUse use) {
        String conflict(String domainId, String domainApplicationId) {
            return "Domain '" + domainId + "' application '" + domainApplicationId + "' uses page key '" + use.pageKey()
                + "', reserved by built-in application '" + applicationId + "' entry '" + use.id() + "' (" + use.path() + ")";
        }
    }

    private static final class BuiltinPageKeys {
        private final Map<String, BuiltinEntry> entries = new HashMap<>();

        BuiltinPageKeys(List<JSONObject> applications) {
            for (var app : applications) {
                if (app.getString("domainId") != null) continue;
                for (var use : app.getList("panelUses", ApplicationPanelUse.class))
                    entries.putIfAbsent(use.pageKey(), new BuiltinEntry(app.getString("id"), use));
            }
        }

        List<ApplicationPanelUse> activeUses(JSONObject app) {
            var uses = app.getList("panelUses", ApplicationPanelUse.class);
            if (app.getString("domainId") == null) return uses;
            return uses.stream().filter(use -> !entries.containsKey(use.pageKey())).toList();
        }

        String conflict(String pageKey, String domainId, String applicationId) {
            var owner = entries.get(pageKey);
            return owner == null ? null : owner.conflict(domainId, applicationId);
        }

        void reportConflicts(List<JSONObject> applications, Set<String> updatedBuiltins) {
            for (var app : applications) {
                var domain = app.getString("domainId");
                if (domain == null) continue;
                for (var use : app.getList("panelUses", ApplicationPanelUse.class)) {
                    var owner = entries.get(use.pageKey());
                    if (owner != null && updatedBuiltins.contains(owner.applicationId()))
                        log.warn("{}; the domain entry '{}' is unavailable", owner.conflict(domain, app.getString("id")), use.id());
                }
            }
        }
    }

    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    private final ApplicationAccess access;
    private final AuthorizationService authorization;
    private final JSONObject upstreams;
    private final PanelResources panels;
    private final ProductGrantService grants;
    public ApplicationCatalog(JdbcTemplate db, TransactionTemplate transactions, ApplicationAccess access,
            @Value("${ONTOMATO_APP_UPSTREAMS:{}}") String upstreams, PanelResources panels,
            ProductGrantService grants, AuthorizationService authorization) {
        this.db = db; this.transactions = transactions; this.access = access;
        this.upstreams = JSON.parseObject(upstreams);
        this.panels = panels; this.grants = grants; this.authorization = authorization;
    }
    public List<JSONObject> all() {
        return loadApplications(false);
    }

    List<JSONObject> loadApplications(boolean includeUpdatedAt) {
        return db.query("SELECT * FROM sys_application WHERE kind IS NOT NULL ORDER BY CASE rail WHEN 'top' THEN 0 WHEN 'apps' THEN 1 ELSE 2 END,sort,id",
            (row, index) -> {
                var app = JSONObject.of("id", row.getString("id"), "domainId", row.getString("domain_id"),
                    "ownerService", row.getString("owner_service"), "ownerUserId", row.getString("owner_user_id"),
                    "coauthorIds", JSON.parseArray(row.getString("coauthor_ids"), String.class),
                    "kind", row.getString("kind"), "names", JSON.parseObject(row.getString("names")),
                    "descriptions", JSON.parseObject(row.getString("descriptions")), "icon", row.getString("icon"),
                    "rail", row.getString("rail"), "category", row.getString("category"), "sort", row.getInt("sort"), "entry", JSON.parseObject(row.getString("entry")),
                    "scheduleAdapter", row.getString("schedule_adapter"),
                    "releaseId", row.getString("release_id"), "pageSkills", JSON.parseArray(row.getString("page_skills"), PageSkills.Declaration.class),
                    "panelUses", JSON.parseArray(row.getString("panel_uses"), ApplicationPanelUse.class),
                    "groups", JSON.parseArray(row.getString("groups"), Group.class),
                    "panelSettings", JSON.parseObject(row.getString("panel_settings")),
                    "allowStandalone", row.getObject("allow_standalone") instanceof Boolean flag ? flag : true);
                var updated = row.getObject("updated_at", OffsetDateTime.class);
                if (updated != null) app.put("updatedAt", updated.toInstant());
                return app;
            });
    }
    public PageSkills.Projection pageSkills(User user) {
        return pageSkills(user, null, null);
    }

    public PageSkills.Projection pageSkills(User user, PageSkills.Entrance entrance, String panelId) {
        var subject = new ApplicationSubject(user);
        var apps = applicationsInDomain(user.getDomainId());
        var pageKeys = new BuiltinPageKeys(apps);
        var mappings = new ArrayList<PageSkills.Mapping>();
        var admitted = new ArrayList<PageSkills.Entrance>();
        var registered = new LinkedHashSet<PageSkills.Skill>();
        for (var app : apps) {
            var applicationId = app.getString("id");
            var declarations = app.getList("pageSkills", PageSkills.Declaration.class);
            declarations.forEach(mapping -> registered.add(mapping.skill()));
            if (entrance != null && !applicationId.equals(entrance.applicationId())) continue;
            var byEntry = new HashMap<String, PageSkills.Declaration>();
            declarations.forEach(mapping -> byEntry.put(mapping.entryKey(), mapping));
            for (var entry : actualEntries(app, pageKeys)) {
                var locator = PanelSkills.entrance(applicationId, entry);
                if (entrance != null && !entrance.equals(locator)) continue;
                if (panelId != null && !panelId.equals(entry.panelId())) continue;
                var declaration = byEntry.get(entry.id());
                boolean panel = isPanelSkillApplication(app) && entry.panelEntry();
                if ((!panel && declaration == null) || user.getDomainId() == null
                        || !subject.decision(applicationId, entry.id()).allowed()) continue;
                admitted.add(locator);
                var defaults = new ArrayList<PageSkills.Default>();
                if (declaration != null && declaration.defaults() != null) defaults.addAll(declaration.defaults());
                if (entry.defaultAgent() != null)
                    defaults.add(new PageSkills.Default(entry.pageKey(), entry.defaultAgent()));
                mappings.add(new PageSkills.Mapping(applicationId, entry.id(), entry.pageKey(),
                    declaration == null ? null : declaration.skill(), defaults.isEmpty() ? null : List.copyOf(defaults)));
            }
        }
        return new PageSkills.Projection(List.copyOf(mappings), List.copyOf(registered), List.copyOf(admitted));
    }

    public List<PanelSkills.Use> panelSkillSources(String domainId) {
        return panelSkillSources(domainId, null, null);
    }

    public List<PanelSkills.Use> panelSkillSources(String domainId, String applicationId, String useId) {
        var apps = applicationsInDomain(domainId);
        var pageKeys = new BuiltinPageKeys(apps);
        return apps.stream().filter(ApplicationCatalog::isPanelSkillApplication)
            .filter(app -> applicationId == null || applicationId.equals(app.getString("id")))
            .flatMap(app -> {
                var applicationNames = app.getObject("names", new TypeReference<Map<String, String>>() {});
                return pageKeys.activeUses(app).stream()
                    .filter(ApplicationPanelUse::panelEntry)
                    .filter(use -> useId == null || useId.equals(use.id()))
                    .map(use -> PanelSkills.source(app.getString("id"), use, applicationNames));
            })
            .toList();
    }

    private static boolean isPanelSkillApplication(JSONObject app) {
        return hasPanelUseRegistration(app) && hasAssignedPanelPaths(app);
    }

    static boolean hasPanelUseRegistration(JSONObject app) {
        return panelManaged(app) || !app.getList("panelUses", ApplicationPanelUse.class).isEmpty();
    }

    private List<JSONObject> applicationsInDomain(String domainId) {
        return all().stream().filter(app -> app.getString("domainId") == null
            || Objects.equals(app.getString("domainId"), domainId)).toList();
    }
    public record ApplicationEntries(JSONObject application, List<ApplicationPanelUse> entries) {}

    public List<ApplicationEntries> entriesInDomain(String domainId) {
        var apps = applicationsInDomain(domainId);
        var pageKeys = new BuiltinPageKeys(apps);
        return apps.stream().map(app -> new ApplicationEntries(app, actualEntries(app, pageKeys))).toList();
    }

    public JSONObject require(String id) {
        return require(all(), id);
    }
    private static JSONObject require(List<JSONObject> apps, String id) {
        return apps.stream().filter(a -> id.equals(a.getString("id"))).findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Application not found"));
    }
    public boolean inDomain(JSONObject app, User user) {
        return app.getString("domainId") == null || Objects.equals(app.getString("domainId"), user.getDomainId());
    }
    public List<JSONObject> visible(User user) {
        var apps = applicationsInDomain(user.getDomainId());
        var pageKeys = new BuiltinPageKeys(apps);
        var subject = new ApplicationSubject(user);
        var visible = new ArrayList<JSONObject>();
        for (var app : apps) {
            var admitted = admittedEntries(app, subject, pageKeys);
            if (!admitted.isEmpty()) visible.add(summaryView(app, pageKeys, admitted));
        }
        return List.copyOf(visible);
    }
    private record CatalogueKey(String id, String name, Instant updatedAt) {}
    private record CatalogueRow(JSONObject app, CatalogueKey key) {}

    public JSONObject catalogue(User user, String search, String scope, String cursor, int size, String sort, Locale locale) {
        return catalogue(user, search, scope, cursor, null, size, sort, locale);
    }

    public JSONObject catalogue(User user, String search, String scope, String cursor, Integer page, int size, String sort, Locale locale) {
        if (!List.of("visible", "maintainable", "mine", "shared").contains(scope))
            throw bad("Catalogue scope must be visible, maintainable, mine or shared");
        if (size < 1 || size > 100) throw bad("Catalogue size must be between 1 and 100");
        if (page != null && page < 1) throw bad("Catalogue page must be at least 1");

        var byId = Comparator.comparing(CatalogueKey::id);
        var order = switch (sort) {
            case "id" -> byId;
            case "name" -> {
                // Compare display names in the reader's locale, respecting accents and case.
                var collator = Collator.getInstance(locale);
                collator.setStrength(Collator.TERTIARY);
                collator.setDecomposition(Collator.CANONICAL_DECOMPOSITION);
                yield Comparator.comparing(CatalogueKey::name, collator).thenComparing(byId);
            }
            case "updated" -> Comparator.comparing(CatalogueKey::updatedAt).reversed().thenComparing(byId);
            default -> throw bad("Catalogue sort must be id, name or updated");
        };
        var cursorType = "name".equals(sort) ? "name-" + locale.toLanguageTag() : sort;
        var after = cursor == null ? null : parseCatalogueCursor(cursor, sort, cursorType);
        var keyword = search.strip().toLowerCase(Locale.ROOT);
        var rows = new ArrayList<JSONObject>();
        var apps = loadApplications(true).stream()
            .filter(app -> app.getString("domainId") == null || inDomain(app, user)).toList();
        var pageKeys = new BuiltinPageKeys(apps);
        var subject = new ApplicationSubject(user);
        var ordered = apps.stream().filter(app -> matchesCatalogue(app, keyword))
            .map(app -> new CatalogueRow(app, new CatalogueKey(app.getString("id"),
                "name".equals(sort) ? catalogueName(app, locale) : null,
                app.get("updatedAt") instanceof Instant ts ? ts : Instant.EPOCH)))
            .sorted(Comparator.comparing(CatalogueRow::key, order)).toList();
        var matched = new ArrayList<CatalogueRow>();
        var maintainFlags = new ArrayList<Boolean>();
        for (var row : ordered) {
            var app = row.app();
            boolean maintain = subject.canEdit(app);
            if (!maintain && !canEnter(app, subject, pageKeys)) continue;
            boolean isMine = app.getString("domainId") != null && Objects.equals(app.getString("ownerUserId"), user.getId());
            if ("maintainable".equals(scope) && !maintain) continue;
            if ("mine".equals(scope) && !isMine) continue;
            if ("shared".equals(scope) && isMine) continue;
            matched.add(row);
            maintainFlags.add(maintain);
        }
        int total = matched.size();
        var ownerIds = matched.stream()
            .map(r -> r.app().getString("ownerUserId"))
            .filter(id -> id != null && !id.isBlank())
            .distinct().toList();
        var ownerNames = grants.principalNames(user.getDomainId(), ownerIds);
        CatalogueKey last = null;
        if (page != null && after == null) {
            int start = (page - 1) * size;
            int end = Math.min(start + size, total);
            for (int i = start; i < end; i++) {
                var row = matched.get(i);
                var app = row.app();
                boolean maintain = maintainFlags.get(i);
                rows.add(catalogueSummary(app, maintain, catalogueEntries(app, subject, maintain, pageKeys).size(), ownerNames));
                last = row.key();
            }
            if (end < total && last != null)
                return JSONObject.of("rows", rows, "total", total, "nextCursor", catalogueCursor(last, sort, cursorType));
            return JSONObject.of("rows", rows, "total", total);
        }
        for (int i = 0; i < matched.size(); i++) {
            var row = matched.get(i);
            if (after != null && order.compare(row.key(), after) <= 0) continue;
            var app = row.app();
            boolean maintain = maintainFlags.get(i);
            if (rows.size() == size)
                return JSONObject.of("rows", rows, "total", total, "nextCursor", catalogueCursor(last, sort, cursorType));
            rows.add(catalogueSummary(app, maintain, catalogueEntries(app, subject, maintain, pageKeys).size(), ownerNames));
            last = row.key();
        }
        return JSONObject.of("rows", rows, "total", total);
    }

    public JSONObject catalogueCount(User user) {
        var apps = applicationsInDomain(user.getDomainId());
        var pageKeys = new BuiltinPageKeys(apps);
        var subject = new ApplicationSubject(user);
        return JSONObject.of("total", apps.stream()
            .filter(app -> subject.canEdit(app) || canEnter(app, subject, pageKeys)).count());
    }

    private static String catalogueName(JSONObject app, Locale locale) {
        var name = localizedText(app.getJSONObject("names"), locale);
        return name != null ? name : app.getString("id");
    }

    static boolean validLocalizedNames(Map<String, String> names) {
        return names != null && !names.isEmpty()
            && names.values().stream().allMatch(value -> value != null && !value.isBlank());
    }

    static String localizedText(Map<?, ?> texts, Locale locale) {
        if (texts == null || texts.isEmpty()) return null;
        for (var tag : List.of(locale.toLanguageTag(), locale.getLanguage(), "en")) {
            if (tag != null && !tag.isEmpty() && texts.get(tag) instanceof String value && !value.isBlank()) return value;
        }
        for (var value : texts.values()) {
            if (value instanceof String text && !text.isBlank()) return text;
        }
        return null;
    }

    private static String catalogueCursor(CatalogueKey key, String sort, String cursorType) {
        if ("id".equals(sort)) return key.id();
        var value = "name".equals(sort) ? key.name() : key.updatedAt().toString();
        return cursorType + "." + key.id() + "." +
            Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static CatalogueKey parseCatalogueCursor(String cursor, String sort, String cursorType) {
        if ("id".equals(sort)) {
            validateId(cursor);
            return new CatalogueKey(cursor, null, null);
        }
        var parts = cursor.split("\\.", 3);
        if (parts.length != 3 || !cursorType.equals(parts[0]) || parts[2].isEmpty())
            throw bad("Invalid catalogue cursor for this sort and locale");
        validateId(parts[1]);
        try {
            var value = new String(Base64.getUrlDecoder().decode(parts[2]), StandardCharsets.UTF_8);
            return "name".equals(sort) ? new CatalogueKey(parts[1], value, null)
                : new CatalogueKey(parts[1], null, Instant.parse(value));
        } catch (IllegalArgumentException | DateTimeParseException ex) {
            throw bad("Invalid catalogue cursor");
        }
    }

    public JSONObject catalogueRecord(String id, User user) {
        return catalogueRecord(id, user, Locale.ENGLISH);
    }

    public JSONObject catalogueRecord(String id, User user, Locale locale) {
        var apps = all();
        var app = apps.stream().filter(a -> id.equals(a.getString("id"))).findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, ApplicationCatalogueForm.notFoundMessage(locale)));
        var subject = new ApplicationSubject(user);
        boolean maintain = subject.canEdit(app);
        var pageKeys = new BuiltinPageKeys(apps);
        if (!maintain && !canEnter(app, subject, pageKeys))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, ApplicationCatalogueForm.notFoundMessage(locale));
        var uses = catalogueEntries(app, subject, maintain, pageKeys);
        var ownerId = app.getString("ownerUserId");
        var ownerNames = ownerId != null && !ownerId.isBlank()
            ? grants.principalNames(user.getDomainId(), List.of(ownerId))
            : Map.<String, String>of();
        var result = catalogueSummary(app, maintain, uses.size(), ownerNames);
        result.put("entry", maintain ? publicEntry(app) : publicEntry(app, admittedEntries(app, subject, pageKeys)));
        result.put("panelUses", uses);
        var groups = app.getList("groups", Group.class);
        if (maintain) {
            result.put("groups", groups);
            result.putAll(app.getJSONObject("panelSettings"));
        } else {
            var usedGroups = new HashSet<>(uses.stream().map(ApplicationPanelUse::groupKey).toList());
            result.put("groups", groups.stream().filter(group -> usedGroups.contains(group.key())).toList());
            var settings = app.getJSONObject("panelSettings");
            if (settings != null && settings.containsKey("framePanelId")) {
                var framePanelId = settings.getString("framePanelId");
                if (panelManaged(app) || BuiltinProductIds.isValid(framePanelId)) result.put("framePanelId", framePanelId);
            }
            if (settings != null && settings.containsKey("theme") && settings.get("theme") != null) {
                result.put("theme", settings.get("theme"));
            }
        }
        return result;
    }

    private List<ApplicationPanelUse> catalogueEntries(JSONObject app, ApplicationSubject subject, boolean maintain, BuiltinPageKeys pageKeys) {
        if (maintain) return app.getList("panelUses", ApplicationPanelUse.class);
        return isPanelSkillApplication(app) ? visiblePanelUses(app, subject, pageKeys) : List.of();
    }

    private JSONObject catalogueSummary(JSONObject app, boolean maintain, int entryCount, Map<String, String> ownerNames) {
        var id = app.getString("id");
        boolean builtin = app.getString("domainId") == null;
        var summary = JSONObject.of("id", id, "names", app.getJSONObject("names"), "descriptions", app.getJSONObject("descriptions"),
            "icon", app.getString("icon"), "source", builtin ? "builtin" : "domain", "canMaintain", maintain,
            "canGrant", maintain,
            "canEditEntries", maintain && panelManaged(app), "entryCount", entryCount,
            "allowStandalone", allowsStandalone(app));
        if (app.get("updatedAt") instanceof Instant ts) summary.put("updatedAt", ts.toString());
        var ownerId = app.getString("ownerUserId");
        if (!builtin && ownerId != null && !ownerId.isBlank()) {
            var resolved = ownerNames.get(ownerId);
            summary.put("ownerName", resolved != null && !resolved.isBlank() ? resolved : ownerId);
        }
        return summary;
    }

    private static boolean matchesCatalogue(JSONObject app, String keyword) {
        return keyword.isEmpty() || app.getString("id").contains(keyword)
            || containsCatalogueText(app.getJSONObject("names"), keyword)
            || containsCatalogueText(app.getJSONObject("descriptions"), keyword);
    }

    private static boolean containsCatalogueText(JSONObject translations, String keyword) {
        return translations.values().stream()
            .anyMatch(value -> value instanceof String text && text.toLowerCase(Locale.ROOT).contains(keyword));
    }

    public JSONObject catalogueForm(ApplicationController.CatalogueFormRequest request, User user, Locale locale) {
        var form = new ApplicationCatalogueForm(locale);
        var target = request.target();
        if (target == null || request.section() == null) throw bad("A catalogue form section and target are required");
        if ("create".equals(request.section())) {
            if (user.getDomainId() == null) throw bad("A domain application draft is required");
            if ("object".equals(target.kind()) && "platform:Application".equals(target.objectType())) {
                validateId(target.primaryKey());
                var apps = all();
                var source = require(apps, target.primaryKey());
                var subject = new ApplicationSubject(user);
                boolean maintain = subject.canEdit(source);
                var pageKeys = new BuiltinPageKeys(apps);
                if (!maintain && !canEnter(source, subject, pageKeys))
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, ApplicationCatalogueForm.notFoundMessage(locale));
                var newId = resolveCopyDraftId(request.values(), target.id());
                validateId(newId);
                if (!newId.startsWith("app-")) throw bad("A domain application requires an app- ID");
                var values = request.values() != null
                    ? request.values()
                    : buildCopyDraft(source, newId, subject, maintain, pageKeys);
                return form.create(newId, values, key -> pageKeys.conflict(key, user.getDomainId(), newId));
            }
            if (!"draft".equals(target.kind())) throw bad("A domain application draft is required");
            var id = target.id() == null ? "app-" + UUID.randomUUID() : target.id();
            validateId(id);
            if (!id.startsWith("app-")) throw bad("A domain application requires an app- ID");
            var pageKeys = new BuiltinPageKeys(all());
            return form.create(id, request.values(), key -> pageKeys.conflict(key, user.getDomainId(), id));
        }

        if (!"object".equals(target.kind()) || !"platform:Application".equals(target.objectType()))
            throw bad("An application object target is required");
        validateId(target.primaryKey());
        var apps = all();
        var app = require(apps, target.primaryKey());
        requireDomainMaintainer(app, user);
        return switch (request.section()) {
            case "identity" -> form.identity(app, request.values());
            case "entries" -> {
                if (!panelManaged(app)) throw bad("Only panel applications can edit their entry table");
                var pageKeys = new BuiltinPageKeys(apps);
                yield form.entries(app, request.values(),
                    key -> pageKeys.conflict(key, user.getDomainId(), app.getString("id")));
            }
            case "entry" -> {
                if (!panelManaged(app)) throw bad("Only panel applications can edit their entry table");
                var pageKeys = new BuiltinPageKeys(apps);
                yield form.entry(app, request.entryId(), request.values(),
                    key -> pageKeys.conflict(key, user.getDomainId(), app.getString("id")));
            }
            default -> throw bad("Unknown application catalogue form section");
        };
    }

    private static String resolveCopyDraftId(JSONObject values, String targetId) {
        if (values != null) {
            if (values.get("entry") instanceof Map<?, ?> entry && entry.get("path") instanceof String path
                    && path.startsWith("/applications/app-")) {
                var candidate = path.substring("/applications/".length());
                if (!candidate.contains("/")) return candidate;
            }
            if (values.get("id") instanceof String id && id.startsWith("app-")) return id;
        }
        return targetId != null && !targetId.isBlank() ? targetId : "app-" + UUID.randomUUID();
    }

    private JSONObject buildCopyDraft(JSONObject source, String newId, ApplicationSubject subject, boolean maintain, BuiltinPageKeys pageKeys) {
        var root = assignedPanelRoot(newId);
        var sourceEntry = publicEntry(source);
        var sourceRoot = sourceEntry != null && sourceEntry.get("path") instanceof String p ? p : "";
        var visibleUses = catalogueEntries(source, subject, maintain, pageKeys);
        var copiedUses = new ArrayList<JSONObject>();
        var usedPaths = new HashSet<String>();
        var usedGroupKeys = new HashSet<String>();
        for (var use : visibleUses) {
            if (!use.panelEntry() || use.panelId() == null || use.panelId().isBlank()) continue;
            var suffix = relativeCopyEntrySuffix(use.path(), sourceRoot, use.id());
            var candidatePath = suffix.isEmpty() ? root : root + "/" + suffix;
            if (!usedPaths.add(candidatePath)) {
                candidatePath = root + "/" + use.id();
                usedPaths.add(candidatePath);
            }
            var entry = JSONObject.of(
                "id", use.id(),
                "pageKey", newId + ":" + use.id(),
                "panelId", use.panelId(),
                "path", candidatePath);
            if (use.names() != null && !use.names().isEmpty()) entry.put("names", new JSONObject(use.names()));
            if (use.descriptions() != null && !use.descriptions().isEmpty()) entry.put("descriptions", new JSONObject(use.descriptions()));
            if (use.icon() != null && !use.icon().isBlank()) entry.put("icon", use.icon());
            if (use.groupKey() != null && !use.groupKey().isBlank()) {
                entry.put("groupKey", use.groupKey());
                usedGroupKeys.add(use.groupKey());
            }
            if (use.inputs() != null && !use.inputs().isEmpty()) entry.put("inputs", JSONObject.from(use.inputs()));
            if (use.defaultAgent() != null) entry.put("defaultAgent", JSONObject.from(use.defaultAgent()));
            if (use.pageComposer() != null && !use.pageComposer().isBlank()) entry.put("pageComposer", use.pageComposer());
            copiedUses.add(entry);
        }
        var sourceGroups = source.getList("groups", Group.class);
        var copiedGroups = new ArrayList<JSONObject>();
        if (sourceGroups != null) {
            for (var group : sourceGroups) {
                if (maintain || usedGroupKeys.contains(group.key())) {
                    copiedGroups.add(JSONObject.of("key", group.key(), "names", new JSONObject(group.names()), "sort", group.sort()));
                }
            }
        }
        var names = source.getJSONObject("names") != null ? new JSONObject(source.getJSONObject("names")) : new JSONObject();
        var descriptions = source.getJSONObject("descriptions") != null ? new JSONObject(source.getJSONObject("descriptions")) : new JSONObject();
        var icon = source.getString("icon");
        if (icon == null || icon.isBlank()) icon = "pages";
        var draft = JSONObject.of(
            "declaration", JSONObject.of(
                "names", names,
                "descriptions", descriptions,
                "icon", icon,
                "groups", copiedGroups),
            "shared", false,
            "allowStandalone", allowsStandalone(source),
            "entry", JSONObject.of("path", root, "renderer", "panels"),
            "initialOpenEntryIds", List.of(),
            "panelUses", copiedUses);
        var settings = source.getJSONObject("panelSettings");
        if (settings != null) {
            if (settings.containsKey("framePanelId")) {
                var framePanelId = settings.getString("framePanelId");
                if (framePanelId != null && !framePanelId.isBlank() && (maintain || panelManaged(source) || BuiltinProductIds.isValid(framePanelId))) {
                    draft.put("framePanelId", framePanelId);
                }
            }
            if (settings.containsKey("theme") && settings.get("theme") != null) {
                draft.put("theme", settings.get("theme"));
            }
        }
        return draft;
    }

    private static String relativeCopyEntrySuffix(String path, String sourceRoot, String fallbackId) {
        if (path == null || path.isBlank()) return fallbackId;
        String tail = path;
        if (sourceRoot != null && !sourceRoot.isBlank()) {
            var normalizedRoot = sourceRoot.endsWith("/") ? sourceRoot.substring(0, sourceRoot.length() - 1) : sourceRoot;
            if (tail.equals(normalizedRoot)) return "";
            if (tail.startsWith(normalizedRoot + "/")) tail = tail.substring(normalizedRoot.length() + 1);
        }
        while (tail.startsWith("/")) tail = tail.substring(1);
        while (tail.endsWith("/")) tail = tail.substring(0, tail.length() - 1);
        return tail;
    }

    public ApplicationController.IdentityUpdate updateIdentity(String id, ApplicationController.IdentityUpdate update, User user) {
        return transactions.execute(tx -> {
            lockCatalog();
            var current = require(id);
            requireDomainMaintainer(current, user);
            var candidate = JSONObject.of("names", update.names(), "descriptions", update.descriptions(), "icon", update.icon());
            if (update.allowStandalone() != null) candidate.put("allowStandalone", update.allowStandalone());
            var errors = ApplicationCatalogueForm.identityErrors(candidate);
            if (!errors.isEmpty()) throw bad(errors.getFirst().get("message").asText());
            requireIconChange(current, update.icon(), user);
            boolean allowStandalone = update.allowStandalone() != null ? update.allowStandalone() : allowsStandalone(current);
            db.update("UPDATE sys_application SET names=?::jsonb,descriptions=?::jsonb,icon=?,allow_standalone=?,updated_at=now() WHERE id=? AND domain_id=?",
                JSON.toJSONString(update.names()), JSON.toJSONString(update.descriptions()), update.icon(), allowStandalone, id, user.getDomainId());
            return new ApplicationController.IdentityUpdate(update.names(), update.descriptions(), update.icon(), allowStandalone);
        });
    }

    private final class ApplicationSubject {
        private final User user;
        private final CredentialLimit limit;
        private final Map<String, Decision> decisions = new HashMap<>();
        private SubjectContext context;

        private ApplicationSubject(User user) {
            this.user = user;
            if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
                var request = attributes.getRequest();
                if (request.getAttribute(QueryGrantService.ATTRIBUTE) != null) {
                    limit = ignored -> false;
                } else if (request.getHeader(DataSandboxService.HEADER) != null) {
                    // The MVC interceptor admits only the designated no-business-data endpoints.
                    limit = requestToDecide -> requestToDecide instanceof Entry;
                } else {
                    limit = CredentialLimit.UNRESTRICTED;
                }
            } else {
                limit = CredentialLimit.UNRESTRICTED;
            }
        }

        private SubjectContext context() {
            if (context == null)
                context = authorization.resolveSubject(new VerifiedIdentity(user.getDomainId(), user.getId(), limit));
            return context;
        }

        private boolean canEdit(JSONObject app) {
            if (app.getString("domainId") == null || !inDomain(app, user)) return false;
            var facts = new OwnerFacts(app.getString("ownerUserId"), DefinitionState.PUBLISHED,
                app.getList("coauthorIds", String.class));
            return authorization.decide(context(), new ObjectAccess(applicationTarget(app), Verb.EDIT, facts)).allowed();
        }

        private void requireEdit(JSONObject app) {
            if (!canEdit(app)) throw denied();
        }

        private Decision decision(String applicationId, String entryKey) {
            var subject = context();
            var targetKey = ApplicationEntryEvents.entryId(applicationId, entryKey);
            return decisions.computeIfAbsent(targetKey, key ->
                authorization.decide(subject, new Entry(new ObjectTarget(user.getDomainId(), Kind.ENTRY, key))));
        }

        private void require(String applicationId, String entryKey) {
            var result = decision(applicationId, entryKey);
            if (!result.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, result.reason());
        }
    }

    static boolean validEntryKey(String key) {
        return key != null && !key.isBlank() && key.indexOf('/') == -1;
    }

    static final String LEGACY_ENTRY_KEY = "main";

    private static List<ApplicationPanelUse> actualEntries(JSONObject app, BuiltinPageKeys pageKeys) {
        if (!hasAssignedPanelPaths(app)) return List.of();
        var entry = app.getJSONObject("entry");
        var uses = pageKeys.activeUses(app);
        var entryKey = entry.getString("entryKey");
        if (entryKey == null || panelManaged(app)) return uses;
        var home = entry.getString("home");
        if (!uses.isEmpty() && (home == null || uses.stream().anyMatch(use -> use.id().equals(entryKey)
                || use.path().equals(home)))) return uses;
        var pageKey = entry.getString("pageKey");
        if (pageKey == null) {
            pageKey = app.getList("pageSkills", PageSkills.Declaration.class).stream()
                .filter(item -> entryKey.equals(item.entryKey())).findFirst()
                .map(PageSkills.Declaration::pageKey).orElse(entryKey);
        }
        var nativeEntry = new ApplicationPanelUse(entryKey, pageKey, null, home == null ? entry.getString("path") : home,
            null, null, null, null, null, null, ApplicationPanelUse.NATIVE_KIND);
        var entries = new ArrayList<>(uses);
        entries.add(nativeEntry);
        return entries;
    }

    private List<ApplicationPanelUse> admittedEntries(JSONObject app, ApplicationSubject subject, BuiltinPageKeys pageKeys) {
        if (subject.user.getDomainId() == null || !inDomain(app, subject.user)) return List.of();
        var id = app.getString("id");
        return actualEntries(app, pageKeys).stream().filter(entry -> subject.decision(id, entry.id()).allowed()).toList();
    }

    private boolean canEnter(JSONObject app, ApplicationSubject subject, BuiltinPageKeys pageKeys) {
        return !admittedEntries(app, subject, pageKeys).isEmpty();
    }

    public boolean canEnter(String id, User user) {
        var apps = all();
        return canEnter(require(apps, id), new ApplicationSubject(user), new BuiltinPageKeys(apps));
    }

    JSONObject proxyApplication(String id, User user) {
        var apps = applicationsInDomain(user.getDomainId());
        var app = apps.stream().filter(a -> id.equals(a.getString("id"))).findFirst().orElseThrow(ApplicationCatalog::denied);
        if (!List.of("hosted", "connected").contains(app.getString("kind"))) throw denied();
        var entries = actualEntries(app, new BuiltinPageKeys(apps));
        if (entries.size() != 1 || user.getDomainId() == null) throw denied();
        new ApplicationSubject(user).require(id, entries.getFirst().id());
        return app;
    }

    public void updateIcon(String id, String icon, User user) {
        transactions.executeWithoutResult(tx -> {
            lockCatalog();
            var app = require(id);
            requireDomainMaintainer(app, user);
            if (icon == null) throw bad("An application icon is required");
            requireIconChange(app, icon, user);
            db.update("UPDATE sys_application SET icon=?,updated_at=now() WHERE id=?", icon, id);
        });
    }

    private static String changedIcon(JSONObject application, String icon) {
        return application != null && Objects.equals(application.getString("icon"), icon) ? null : icon;
    }

    private static List<ApplicationPanelUse> withChangedIcons(JSONObject old, List<ApplicationPanelUse> uses) {
        if (old == null) return uses;
        var priorIcons = new HashMap<String, String>();
        var priorUses = old.getList("panelUses", ApplicationPanelUse.class);
        if (priorUses != null) {
            for (var prior : priorUses) {
                if (prior.icon() != null) priorIcons.put(prior.id(), prior.icon());
            }
        }
        return uses.stream().map(use -> use.icon() != null && Objects.equals(priorIcons.get(use.id()), use.icon())
            ? new ApplicationPanelUse(use.id(), use.pageKey(), use.panelId(), use.path(),
                use.defaultAgent(), use.names(), use.descriptions(), use.inputs(), use.groupKey(), null, use.kind(), use.pageComposer())
            : use).toList();
    }

    private void requireIconChange(JSONObject application, String icon, User user) {
        var changed = changedIcon(application, icon);
        if (changed != null) panels.requireCurrent(user.getDomainId(), null, List.of(), null, null, changed, null);
    }
    public JSONObject view(String id, User user) {
        var apps = all();
        return view(require(apps, id), user, new BuiltinPageKeys(apps));
    }

    public JSONObject view(JSONObject app, User user) {
        return view(app, user, new BuiltinPageKeys(all()));
    }

    private JSONObject view(JSONObject app, User user, BuiltinPageKeys pageKeys) {
        var subject = new ApplicationSubject(user);
        var admitted = admittedEntries(app, subject, pageKeys);
        if (admitted.isEmpty()) throw denied();
        if (!hasPanelUseRegistration(app)) return summaryView(app, pageKeys, admitted);
        var usable = usablePanelUses(app, user, admitted);
        var result = summaryView(app, pageKeys, admitted);
        result.put("entry", publicEntry(app, usable));
        result.put("panelUses", usable);
        return result;
    }

    private static JSONObject summaryView(JSONObject app, BuiltinPageKeys pageKeys, List<ApplicationPanelUse> admitted) {
        var result = new JSONObject(app);
        result.remove("coauthorIds");
        result.put("entry", publicEntry(app, admitted));
        result.put("entryPaths", admitted.stream().map(ApplicationPanelUse::path).toList());
        result.put("singleEntry", singleEntry(app, pageKeys));
        result.put("allowStandalone", allowsStandalone(app));
        var settings = app.getJSONObject("panelSettings");
        result.remove("panelSettings");
        result.remove("panelUses");
        result.remove("pageSkills");
        String resolvedFrame = null;
        if (settings != null && settings.containsKey("framePanelId")) {
            var framePanelId = settings.getString("framePanelId");
            if (panelManaged(app) || BuiltinProductIds.isValid(framePanelId)) resolvedFrame = framePanelId;
        }
        if (resolvedFrame != null) result.put("framePanelId", resolvedFrame);
        else if (panelManaged(app)) result.put("framePanelId", DEFAULT_FRAME_PANEL_ID);
        return result;
    }

    private static JSONObject publicEntry(JSONObject app, List<ApplicationPanelUse> admitted) {
        var entry = publicEntry(app);
        if (hasPanelUseRegistration(app)) {
            if (admitted.isEmpty()) {
                entry.remove("home");
                entry.remove("entryKey");
                return entry;
            }
            var home = entry.getString("home");
            if (home == null) home = entry.getString("path");
            var requestedHome = home;
            var selected = admitted.stream().filter(use -> use.path().equals(requestedHome)).findFirst()
                .orElseGet(() -> admitted.stream().filter(use -> use.names() != null).findFirst().orElse(admitted.getFirst()));
            entry.put("home", selected.path());
            entry.put("entryKey", selected.id());
        }
        return entry;
    }

    private static JSONObject publicEntry(JSONObject app) {
        var entry = new JSONObject(app.getJSONObject("entry"));
        entry.remove("upstream");
        entry.remove("upstreamPrefix");
        return entry;
    }

    /** Reconcile a service's complete builtin collection; retired builtins of that service are removed. */
    public void reconcileBuiltins(String service, List<Builtin> declarations) {
        transactions.executeWithoutResult(tx -> {
            db.update("""
                DELETE FROM sys_application
                WHERE owner_service=? AND domain_id IS NULL AND kind IN ('native','link')
                  AND id NOT IN (SELECT jsonb_array_elements_text(?::jsonb))
                """, service, JSON.toJSONString(declarations.stream().map(Builtin::id).toList()));
            builtins(service, declarations);
        });
    }
    public void builtins(String service, List<Builtin> declarations) {
        transactions.executeWithoutResult(tx -> {
            lockCatalog();
            for (var d : declarations) {
                validateId(d.id());
                var raw = d.declaration();
                validate(raw);
                var mergedUses = new ArrayList<>(raw.panelUses());
                mergedUses.addAll(access.builtinEntries(d.id()));
                var declaration = new Declaration(raw.names(), raw.descriptions(), raw.icon(), raw.groups(),
                    raw.pageSkills(), ApplicationPanelUse.canonical(mergedUses, true));
                if (!List.of("native","link").contains(d.kind()) || !List.of("top","apps","bottom").contains(d.rail())
                    || d.category() == null || !List.of("business","build","admin").contains(d.category()))
                    throw bad("Invalid built-in application");
                var old = all().stream().filter(a -> d.id().equals(a.getString("id"))).findFirst();
                if (old.isPresent() && (!service.equals(old.get().getString("ownerService")) || old.get().getString("domainId") != null))
                    throw denied();
                for (var use : declaration.panelUses())
                    if (use.panelEntry() && !BuiltinProductIds.isValid(use.panelId()))
                        throw bad("Built-in application entry " + use.pageKey() + " must reference a platform panel: " + use.panelId());
                if (d.framePanelId() != null && !BuiltinProductIds.isValid(d.framePanelId()))
                    throw bad("Built-in application " + d.id() + " framePanelId must reference a platform panel: " + d.framePanelId());
                requireConversationFrame(declaration.panelUses(), d.framePanelId());
                if (d.entry() == null || !(d.entry().get("path") instanceof String path) || path.isBlank())
                    throw bad("A built-in requires an entry path");
                var root = builtinPanelRoot(d.entry());
                if ((root != null && inAssignedSpace(root)) || declaration.panelUses().stream().anyMatch(use -> inAssignedSpace(use.path())))
                    throw bad("Built-in applications cannot occupy the assigned application space");
                var entryKey = d.entry().get("entryKey");
                if ((entryKey != null || declaration.panelUses().isEmpty())
                        && (!(entryKey instanceof String key) || !validEntryKey(key)))
                    throw bad("A native or link entry requires a valid entry.entryKey");
                validateUseGroups(declaration.panelUses(), declaration.groups());
                validateMappings(d.id(), null, d.entry(), declaration.pageSkills(), declaration.panelUses());
                var panelSettings = d.framePanelId() != null ? JSONObject.of("framePanelId", d.framePanelId()) : new JSONObject();
                save(d.id(), null, service, null, d.kind(), d.rail(), d.category(), d.sort(), d.entry(), d.scheduleAdapter(), null, declaration, panelSettings, d.allowsStandalone());
                access.declare(require(d.id()), declaration, old.isEmpty());
            }
            var apps = all();
            new BuiltinPageKeys(apps).reportConflicts(apps,
                Set.copyOf(declarations.stream().map(Builtin::id).toList()));
        });
    }
    public JSONObject connected(String id, Declaration declaration, String upstream, String upstreamPrefix, User user) {
        var allowed = upstreams.getJSONArray(user.getDomainId());
        if (allowed == null || !allowed.contains(upstream)) throw bad("Upstream is not allowed in this domain");
        if (upstreamPrefix == null || !upstreamPrefix.matches("/(?:[a-zA-Z0-9_-]+/)*"))
            throw bad("Invalid upstream prefix");
        return transactions.execute(tx -> {
            var result = userApplication(id, declaration, user);
            db.update("UPDATE sys_application SET entry=entry || ?::jsonb WHERE id=?",
                JSONObject.of("upstream", upstream, "upstreamPrefix", upstreamPrefix).toJSONString(), id);
            return result;
        });
    }
    private JSONObject userApplication(String id, Declaration declaration, User user) {
        validateId(id); validate(declaration);
        if (!declaration.pageSkills().isEmpty() || !declaration.panelUses().isEmpty()) throw bad("Use the panel application registration for panel relations");
        if (!id.startsWith("app-") || user.getDomainId() == null) throw bad("A user application requires an app- ID and domain");
        return transactions.execute(tx -> {
            lockCatalog();
            var old = all().stream().filter(a -> id.equals(a.getString("id"))).findFirst();
            if (old.isPresent()) {
                var a = old.get();
                if (panelManaged(a)) throw bad("A panels application cannot use legacy publication");
                if (!"connected".equals(a.getString("kind"))) throw denied();
                requireDomainMaintainer(a, user);
            } else {
                var subject = new ApplicationSubject(user);
                var decision = authorization.decide(subject.context(), new Management(ApplicationController.CONNECT_APPLICATION));
                if (!decision.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, decision.reason());
            }
            requireIconChange(old.orElse(null), declaration.icon(), user);
            String owner = old.isEmpty() ? user.getId() : old.get().getString("ownerUserId");
            boolean allowStandalone = old.map(ApplicationCatalog::allowsStandalone).orElse(true);
            String path="/apps/"+id+"/";
            var entryKey = old.map(app -> app.getJSONObject("entry").getString("entryKey")).orElse(LEGACY_ENTRY_KEY);
            save(id, user.getDomainId(), "data-engine", owner, "connected", "apps", "business", 100,
                JSONObject.of("path", path, "entryKey", entryKey), null, null, declaration, new JSONObject(), allowStandalone);
            var application = require(id);
            access.declare(application, declaration, old.isEmpty());
            return JSONObject.of("applicationId", id, "entryPath", path);
        });
    }
    static void validateUseGroups(List<ApplicationPanelUse> uses, List<Group> groups) {
        var keys = new HashSet<>(groups.stream().map(Group::key).toList());
        for (var use : uses) {
            if (use.groupKey() != null && !keys.contains(use.groupKey()))
                throw bad("Unknown group " + use.groupKey() + " on panel entry " + use.pageKey());
        }
    }

    private void save(String id, String domain, String service, String owner, String kind, String rail, String category, int sort,
                      JSONObject entry, String adapter, String releaseId, Declaration d, JSONObject panelSettings, boolean allowStandalone) {
        db.update("""
            INSERT INTO sys_application(id,domain_id,owner_service,owner_user_id,kind,names,descriptions,icon,rail,category,sort,entry,schedule_adapter,release_id,groups,entry_path,page_skills,panel_uses,panel_settings,allow_standalone,updated_at)
            VALUES(?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?::jsonb,?::jsonb,?::jsonb,?,now()) ON CONFLICT(id) DO UPDATE SET
            names=excluded.names,descriptions=excluded.descriptions,icon=excluded.icon,rail=excluded.rail,category=excluded.category,sort=excluded.sort,
            entry=excluded.entry,schedule_adapter=excluded.schedule_adapter,
            release_id=excluded.release_id,groups=excluded.groups,entry_path=excluded.entry_path,page_skills=excluded.page_skills,panel_uses=excluded.panel_uses,panel_settings=excluded.panel_settings,allow_standalone=excluded.allow_standalone,updated_at=now()
            """, id,domain,service,owner,kind,JSON.toJSONString(d.names()),JSON.toJSONString(d.descriptions()),d.icon(),rail,category,sort,
            entry.toJSONString(),adapter,releaseId,JSON.toJSONString(d.groups()),entry.getString("path"),JSON.toJSONString(d.pageSkills()),JSON.toJSONString(d.panelUses(), JSONWriter.Feature.WriteMapNullValue),panelSettings.toJSONString(),allowStandalone);
    }
    public static void validateId(String id) {
        if (id == null || !id.matches("[a-z][a-z0-9-]{0,63}")) throw bad("Invalid application ID");
    }
    static void validate(Declaration d) {
        if (d == null || !validLocalizedNames(d.names())
            || d.descriptions() == null || d.icon() == null || d.groups() == null) throw bad("Invalid application declaration");
        Set<String> groups = new HashSet<>();
        for (var group : d.groups()) {
            if (group.key() == null || !validLocalizedNames(group.names()) || !groups.add(group.key())) throw bad("Invalid application group");
        }
        PageSkills.validate(d.pageSkills());
    }

    public static boolean panelManaged(JSONObject app) {
        return "panels".equals(app.getJSONObject("entry").getString("renderer"));
    }
    private static void validatePageKeys(List<JSONObject> applications, BuiltinPageKeys pageKeys) {
        var panelPages = new HashSet<String>();
        for (var app : applications)
            for (var use : pageKeys.activeUses(app))
                if (!panelPages.add(use.pageKey())) throw bad("Panel use page keys must be unique in the domain");
    }

    private void validateMappings(String id, String domain, JSONObject entry, List<PageSkills.Declaration> pageSkills, List<ApplicationPanelUse> panelUses) {
        var apps = new ArrayList<>(all().stream().filter(app -> !id.equals(app.getString("id"))).toList());
        apps.add(JSONObject.of("id", id, "domainId", domain, "kind", domain == null ? "native" : "product", "entry", entry,
            "pageSkills", pageSkills, "panelUses", panelUses));
        var pageKeys = new BuiltinPageKeys(apps);
        var entries = actualEntries(apps.getLast(), pageKeys);
        for (var mapping : pageSkills) {
            var use = entries.stream().filter(item -> mapping.entryKey().equals(item.id()) && mapping.pageKey().equals(item.pageKey()))
                .findFirst().orElseThrow(() -> bad("Page skill must identify an actual application entry"));
            if (use.defaultAgent() != null && mapping.defaults() != null && !mapping.defaults().isEmpty())
                throw bad("An entry may declare only one page skill default");
        }
        if (domain != null) {
            for (var use : panelUses) {
                var conflict = pageKeys.conflict(use.pageKey(), domain, id);
                if (conflict != null) throw bad(conflict);
            }
        }
        var domains = new HashSet<String>(); domains.add(domain);
        for (var app : apps) domains.add(app.getString("domainId"));
        for (var scope : domains) {
            var visible = apps.stream().filter(app -> app.getString("domainId") == null || Objects.equals(scope, app.getString("domainId"))).toList();
            validatePageKeys(visible, pageKeys);
            validatePanelPaths(visible, pageKeys);
        }
    }
    private static String builtinPanelRoot(JSONObject entry) {
        var path = entry.getString("path");
        return path.startsWith("/") && !path.equals("/") ? ApplicationPanelUse.canonicalPath(path) : null;
    }

    private static void validatePanelPaths(List<JSONObject> applications, BuiltinPageKeys pageKeys) {
        var roots = new HashMap<String, String>();
        for (var app : applications) {
            var kind = app.getString("kind");
            if (app.getString("domainId") != null || !("native".equals(kind) || "link".equals(kind))) continue;
            var root = builtinPanelRoot(app.getJSONObject("entry"));
            if (root != null) roots.put(app.getString("id"), root);
        }
        var paths = new HashSet<String>();
        for (var app : applications) {
            if (!hasAssignedPanelPaths(app)) continue;
            for (var use : pageKeys.activeUses(app)) {
                if (!paths.add(use.path())) throw bad("Duplicate panel path: " + use.path());
                for (var root : roots.entrySet())
                    if (!root.getKey().equals(app.getString("id")) && !inAssignedSpace(use.path()) && ApplicationPanelUse.under(use.path(), root.getValue()))
                        throw bad("Panel path belongs to " + root.getKey() + ": " + use.path());
            }
        }
    }

    public List<PanelUseLocation> panelUsesByPanel(String domainId, String panelId) {
        return applicationsInDomain(domainId).stream().filter(ApplicationCatalog::isPanelSkillApplication)
            .flatMap(app -> app.getList("panelUses", ApplicationPanelUse.class).stream()
                .filter(use -> use.panelEntry() && panelId.equals(use.panelId()))
                .map(use -> new PanelUseLocation(app.getString("id"),
                    app.getObject("names", new TypeReference<Map<String, String>>() {}), use.id(), use.path())))
            .toList();
    }

    public List<ApplicationEntryEvents.EntryRoots> affectedEntryRoots(String domainId, Set<String> panelIds) {
        var applications = applicationsInDomain(domainId);
        var pageKeys = new BuiltinPageKeys(applications);
        return applications.stream()
            .filter(ApplicationCatalog::hasPanelUseRegistration)
            .flatMap(app -> ApplicationEntryEvents.roots(app, pageKeys.activeUses(app)).entrySet().stream())
            .filter(entry -> entry.getValue().panelIds().stream().anyMatch(panelIds::contains))
            .map(entry -> new ApplicationEntryEvents.EntryRoots(entry.getKey(), entry.getValue()))
            .toList();
    }

    public boolean ownsEntry(String domainId, String entryId) {
        var apps = applicationsInDomain(domainId);
        var pageKeys = new BuiltinPageKeys(apps);
        return apps.stream().anyMatch(app -> actualEntries(app, pageKeys).stream().anyMatch(use ->
            ApplicationEntryEvents.entryId(app.getString("id"), use.id()).equals(entryId)));
    }

    public void deleteDomainApplication(String id, User user) {
        transactions.executeWithoutResult(tx -> {
            lockCatalog();
            var app = require(id);
            requireDomainMaintainer(app, user);
            access.retire(app);
            var entries = app.getList("panelUses", ApplicationPanelUse.class);
            var entryKey = app.getJSONObject("entry").getString("entryKey");
            var keys = entryTargets(id, entries.stream().map(ApplicationPanelUse::id).toList());
            if (!hasPanelUseRegistration(app) && entryKey != null)
                keys = Set.of(ApplicationEntryEvents.entryId(id, entryKey));
            if (!keys.isEmpty()) access.retireEntries(user.getDomainId(), keys);
            ApplicationEntryEvents.append(db, user.getDomainId(), user.getId(), ApplicationEntryEvents.roots(app), Map.of());
            // The entry table is stored in this application row.
            db.update("DELETE FROM sys_application WHERE id=? AND domain_id=?", id, user.getDomainId());
        });
    }

    public static ObjectTarget applicationTarget(JSONObject app) {
        return new ObjectTarget(app.getString("domainId"), Kind.APPLICATION, app.getString("id"));
    }

    private void requireDomainMaintainer(JSONObject app, User user) {
        new ApplicationSubject(user).requireEdit(app);
    }

    public void requireLegacyGrantChange(String id, User user) {
        applicationsInDomain(user.getDomainId()).stream()
            .filter(app -> id.equals(app.getString("id")) && app.getString("domainId") != null)
            .findFirst().ifPresent(app -> {
                requireDomainMaintainer(app, user);
                if (panelManaged(app)) throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Use the application use-grants endpoints for a panel application");
            });
    }

    public boolean legacyMaintenance(String id, User user) {
        var app = require(id);
        requireDomainMaintainer(app, user);
        return !panelManaged(app);
    }

    public List<ProductGrantService.GrantView> applicationUseGrants(String id, User user) {
        var app = require(id);
        requireDomainMaintainer(app, user);
        return grants.applicationUseGrants(app.getString("domainId"), id);
    }

    public void changeApplicationUseGrant(String id, ProductGrants.Grant grant, boolean remove, User user) {
        transactions.executeWithoutResult(tx -> {
            lockCatalog();
            var app = require(id);
            requireDomainMaintainer(app, user);
            grants.changeApplicationUseGrant(app.getString("domainId"), id, grant, remove);
        });
    }

    public void shareApplicationUse(String id, boolean shared, User user) {
        transactions.executeWithoutResult(tx -> {
            lockCatalog();
            var app = require(id);
            requireDomainMaintainer(app, user);
            grants.shareApplicationUse(app.getString("domainId"), id, shared);
        });
    }

    public void requestDomainEntryOpening(String id, String entryKey, boolean open, User user) {
        transactions.executeWithoutResult(tx -> {
            lockCatalog();
            var apps = all();
            var app = require(apps, id);
            requireDomainMaintainer(app, user);
            if (actualEntries(app, new BuiltinPageKeys(apps)).stream().noneMatch(use -> entryKey.equals(use.id())))
                throw entryNotFound();
            access.requestDomainEntryOpening(user, ApplicationEntryEvents.entryId(id, entryKey), open);
        });
    }

    public JSONObject resolveEntry(String path, User user) {
        var canonical = ApplicationPanelUse.canonicalPath(path);
        var apps = applicationsInDomain(user.getDomainId());
        var pageKeys = new BuiltinPageKeys(apps);
        var subject = new ApplicationSubject(user);
        for (var app : apps) {
            var declared = actualEntries(app, pageKeys).stream()
                .filter(use -> canonical.equals(pathWithoutQuery(use.path()))).findFirst();
            if (declared.isPresent()) return resolveDeclaredEntry(app, declared.get(), subject, pageKeys);
        }
        for (var app : apps) {
            if (!hasPanelUseRegistration(app) || !canonical.equals(app.getJSONObject("entry").getString("path"))) continue;
            var allowed = visiblePanelUses(app, subject, pageKeys);
            if (allowed.isEmpty()) throw denied();
            var home = publicEntry(app, allowed).getString("entryKey");
            var use = allowed.stream().filter(entry -> entry.id().equals(home)).findFirst().orElseThrow();
            return entryResolution(app, use, allowed, pageKeys);
        }
        throw entryNotFound();
    }

    private static String pathWithoutQuery(String path) {
        int query = path.indexOf('?');
        var address = query < 0 ? path : path.substring(0, query);
        return address.length() > 1 && address.endsWith("/") ? address.substring(0, address.length() - 1) : address;
    }

    public JSONObject resolveEntry(String applicationId, String useId, User user) {
        var apps = all();
        var app = require(apps, applicationId);
        if (!inDomain(app, user)) throw denied();
        var pageKeys = new BuiltinPageKeys(apps);
        var use = actualEntries(app, pageKeys).stream().filter(entry -> useId.equals(entry.id()))
            .findFirst().orElseThrow(ApplicationCatalog::entryNotFound);
        return resolveDeclaredEntry(app, use, new ApplicationSubject(user), pageKeys);
    }

    /** Registration facts for the authenticated workbench. The object owner separately checks use. */
    public JSONObject registeredEntry(String applicationId, String useId, User user) {
        var apps = applicationsInDomain(user.getDomainId());
        var app = apps.stream().filter(item -> applicationId.equals(item.getString("id"))).findFirst()
            .orElseThrow(ApplicationCatalog::entryNotFound);
        var use = declaredPanelEntry(app, useId, new BuiltinPageKeys(apps));
        return JSONObject.of("applicationId", applicationId, "use", use, "framePanelId", entryFramePanelId(app));
    }

    private static ApplicationPanelUse declaredPanelEntry(JSONObject app, String useId, BuiltinPageKeys pageKeys) {
        if (!hasAssignedPanelPaths(app)) throw entryNotFound();
        return pageKeys.activeUses(app).stream().filter(use -> !use.nativeEntry() && useId.equals(use.id()))
            .findFirst().orElseThrow(ApplicationCatalog::entryNotFound);
    }

    private JSONObject resolveDeclaredEntry(JSONObject app, ApplicationPanelUse use, ApplicationSubject subject, BuiltinPageKeys pageKeys) {
        if (subject.user.getDomainId() == null) throw denied();
        subject.require(app.getString("id"), use.id());
        var allowed = usablePanelUses(app, subject.user, admittedEntries(app, subject, pageKeys));
        if (!allowed.contains(use)) throw denied();
        return entryResolution(app, use, allowed, pageKeys);
    }

    private static boolean singleEntry(JSONObject app, BuiltinPageKeys pageKeys) {
        return pageKeys.activeUses(app).stream().filter(entry -> entry.names() != null).count() <= 1;
    }

    private static JSONObject entryResolution(JSONObject app, ApplicationPanelUse use, List<ApplicationPanelUse> allowed,
                                             BuiltinPageKeys pageKeys) {
        var named = allowed.stream().filter(entry -> entry.names() != null).toList();
        var menuUses = allowed.stream().filter(entry -> entry.names() != null || entry.frameConversationEntry()).toList();
        var groupKeys = new HashSet<>(named.stream().map(ApplicationPanelUse::groupKey).toList());
        var groups = app.getList("groups", Group.class).stream().filter(group -> groupKeys.contains(group.key()))
            .sorted(Comparator.comparingInt(Group::sort)).toList();
        var appNames = app.getObject("names", new TypeReference<Map<String, String>>() {});
        var result = JSONObject.of("applicationId", app.getString("id"), "use", use, "framePanelId", entryFramePanelId(app),
            "menu", new EntryMenu(appNames, groups, menuUses, singleEntry(app, pageKeys)));
        var settings = app.getJSONObject("panelSettings");
        if (panelManaged(app) && settings != null && settings.containsKey("theme"))
            result.put("theme", settings.getJSONObject("theme"));
        return result;
    }

    static String entryFramePanelId(JSONObject app) {
        var settings = app.getJSONObject("panelSettings");
        return entryFramePanelId(panelManaged(app), settings == null ? null : settings.getString("framePanelId"));
    }

    private static String entryFramePanelId(boolean panelManaged, String framePanelId) {
        if (framePanelId != null && (panelManaged || BuiltinProductIds.isValid(framePanelId))) return framePanelId;
        return DEFAULT_FRAME_PANEL_ID;
    }

    private static ResponseStatusException entryNotFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Panel entry not found");
    }

    public JSONObject panelUses(String id, User user) {
        var apps = all();
        var app = require(apps, id);
        if (!inDomain(app, user)) throw denied();
        if (!hasPanelUseRegistration(app)) throw bad("Application has no panel use registration");
        if (!hasAssignedPanelPaths(app))
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "Panel application " + id + " must be re-registered with complete canonical paths");
        var subject = new ApplicationSubject(user);
        var pageKeys = new BuiltinPageKeys(apps);
        var admitted = admittedEntries(app, subject, pageKeys);
        if (admitted.isEmpty()) throw denied();
        var usable = usablePanelUses(app, user, admitted);
        return JSONObject.of("applicationId", id, "entry", publicEntry(app, usable), "panelUses", usable);
    }
    public JSONObject managePanelUses(String id, User user) {
        var app = require(id);
        requireDomainMaintainer(app, user);
        if (!hasPanelUseRegistration(app)) throw bad("Application has no panel use registration");
        var declaration = JSONObject.of("names", app.getJSONObject("names"), "descriptions", app.getJSONObject("descriptions"),
            "icon", app.getString("icon"), "groups", app.getList("groups", Group.class));
        var result = JSONObject.of("applicationId", id, "entry", app.getJSONObject("entry"),
            "panelUses", app.getList("panelUses", ApplicationPanelUse.class), "declaration", declaration,
            "allowStandalone", allowsStandalone(app));
        result.putAll(app.getJSONObject("panelSettings"));
        return result;
    }

    private static void requireConversationFrame(List<ApplicationPanelUse> uses, String framePanelId) {
        if (framePanelId == null && uses.stream().anyMatch(ApplicationPanelUse::frameConversationEntry))
            throw bad("Frame conversation entry requires an application frame containing AgentChat");
    }

    private static void validatePanelSettings(PanelSettings settings) {
        if (settings.framePanelId() != null && settings.framePanelId().isBlank())
            throw bad("framePanelId must be nonblank");
        var delivery = settings.delivery();
        if (delivery != null && (delivery.panels() == null || delivery.projections() == null || delivery.packages() == null
            || delivery.agents() == null || delivery.skills() == null))
            throw bad("Delivery requires panels, projections, packages, agents and skills");
    }

    private List<ApplicationPanelUse> visiblePanelUses(JSONObject app, ApplicationSubject subject, BuiltinPageKeys pageKeys) {
        return usablePanelUses(app, subject.user, admittedEntries(app, subject, pageKeys));
    }

    private List<ApplicationPanelUse> usablePanelUses(JSONObject app, User user, List<ApplicationPanelUse> uses) {
        var panelIds = uses.stream().filter(use -> !use.nativeEntry())
            .map(use -> use.frameConversationEntry() ? app.getJSONObject("panelSettings").getString("framePanelId") : use.panelId())
            .distinct().toList();
        if (panelIds.isEmpty()) return uses;
        var allowed = grants.allowedBatchFor(user.getDomainId(), user.getId(), panelIds, "use");
        return uses.stream().filter(use -> use.nativeEntry() || Boolean.TRUE.equals(allowed.get(
            use.frameConversationEntry() ? app.getJSONObject("panelSettings").getString("framePanelId") : use.panelId()
        ))).toList();
    }

    public JSONObject putPanelUses(String id, ApplicationController.PanelRegistration body, User user) {
        return putPanelUses(id, body, user, false, null);
    }

    public JSONObject putPanelUses(String id, ApplicationController.PanelRegistration body, User user, boolean createOnly, Locale locale) {
        validateId(id);
        if (user.getDomainId() == null || !id.startsWith("app-")) throw bad("A panel application requires an app- ID and domain");
        if (body.entry() == null || body.panelUses() == null || !"panels".equals(body.entry().renderer()))
            throw bad("A panels entry and local path are required");
        var existing = all().stream().filter(app -> id.equals(app.getString("id"))).findFirst();
        if (createOnly && existing.isPresent()) throw applicationAlreadyExists(id);
        if (existing.isPresent() && existing.get().getString("domainId") == null) throw denied();
        if (existing.isPresent() && !panelManaged(existing.get())) throw bad("Use registration cannot take over an existing application");
        var root = assignedPanelRoot(id);
        var entryPath = ApplicationPanelUse.canonicalPath(body.entry().path());
        var uses = ApplicationPanelUse.canonical(body.panelUses());
        if (!ApplicationPanelUse.under(entryPath, root) || uses.stream().anyMatch(use -> !ApplicationPanelUse.under(use.path(), root)))
            throw bad("Panel entry and uses must be in the assigned application space: " + root);
        var supplied = body.declaration();
        if (existing.isEmpty() && (supplied == null || body.initialOpenEntryIds() == null)) throw bad("New applications require metadata and initialOpenEntryIds");
        if (supplied != null && (!supplied.pageSkills().isEmpty() || !supplied.panelUses().isEmpty())) throw bad("Supply panelUses only once");
        if (supplied != null) validate(supplied);
        var settings = new PanelSettings(body.framePanelId(), body.theme(), body.delivery());
        validatePanelSettings(settings);
        requireConversationFrame(uses, settings.framePanelId());
        var subject = new ApplicationSubject(user);
        existing.ifPresent(subject::requireEdit);
        var ids = new HashSet<>(uses.stream().filter(ApplicationPanelUse::panelEntry).map(ApplicationPanelUse::panelId).toList());
        if (settings.framePanelId() != null) ids.add(settings.framePanelId());
        for (var panelId : ids) if (!grants.allowed(panelId, "use")) throw denied();
        return transactions.execute(tx -> {
            lockCatalog();
            var current = all().stream().filter(app -> id.equals(app.getString("id"))).findFirst();
            if (createOnly && current.isPresent()) throw applicationAlreadyExists(id);
            if (current.isPresent() && current.get().getString("domainId") == null) throw denied();
            if (current.isPresent() && !panelManaged(current.get())) throw bad("Use registration cannot take over an existing application");
            current.ifPresent(subject::requireEdit);
            var old = current.orElse(null);
            if (old == null && (supplied == null || body.initialOpenEntryIds() == null)) throw bad("New applications require metadata and initialOpenEntryIds");
            var useIds = new HashSet<>(uses.stream().map(ApplicationPanelUse::id).toList());
            if (old == null && !useIds.containsAll(body.initialOpenEntryIds()))
                throw bad("initialOpenEntryIds must identify declared entries");
            if (uses.stream().anyMatch(use -> use.groupKey() != null))
                validateUseGroups(uses, supplied == null ? old.getList("groups", Group.class) : supplied.groups());
            var entry = JSONObject.of("path", entryPath, "renderer", "panels");
            validateMappings(id, user.getDomainId(), entry, List.of(), uses);
            panels.requireCurrent(user.getDomainId(), settings.framePanelId(), withChangedIcons(old, uses), settings.delivery(), settings.theme(),
                supplied == null ? null : changedIcon(old, supplied.icon()), locale);
            boolean allowStandalone = body.allowStandalone() != null ? body.allowStandalone() : (old == null || allowsStandalone(old));
            JSONObject stored;
            if (old != null && supplied == null) {
                db.update("UPDATE sys_application SET entry=?::jsonb,entry_path=?,panel_uses=?::jsonb,panel_settings=?::jsonb,allow_standalone=?,page_skills='[]'::jsonb,updated_at=now() WHERE id=?",
                    entry.toJSONString(), entryPath, JSON.toJSONString(uses, JSONWriter.Feature.WriteMapNullValue),
                    settings.json().toJSONString(), allowStandalone, id);
                stored = require(id);
            } else {
                var declaration = new Declaration(supplied.names(), supplied.descriptions(), supplied.icon(), supplied.groups(), List.of(), uses);
                save(id, user.getDomainId(), "workbench", old == null ? user.getId() : old.getString("ownerUserId"),
                    "product", old == null ? "apps" : old.getString("rail"), old == null ? "business" : old.getString("category"),
                    old == null ? 100 : old.getIntValue("sort"), entry, null, null, declaration, settings.json(), allowStandalone);
                stored = require(id);
                access.declare(stored, declaration, old == null);
                if (old == null && body.shared() != null) {
                    grants.shareApplicationUse(user.getDomainId(), id, body.shared());
                }
            }
            if (old == null) {
                access.initialOpenEntries(user, entryTargets(id, body.initialOpenEntryIds()));
            } else {
                var removed = old.getList("panelUses", ApplicationPanelUse.class).stream().map(ApplicationPanelUse::id)
                    .filter(key -> !useIds.contains(key)).toList();
                if (!removed.isEmpty()) access.retireEntries(user.getDomainId(), entryTargets(id, removed));
            }
            ApplicationEntryEvents.append(db, user.getDomainId(), user.getId(),
                old == null ? Map.of() : ApplicationEntryEvents.roots(old),
                ApplicationEntryEvents.roots(stored));
            return JSONObject.of("applicationId", id, "entry", entry, "panelUses", uses);
        });
    }
    private static Set<String> entryTargets(String id, Collection<String> keys) {
        return keys.stream().map(key -> ApplicationEntryEvents.entryId(id, key))
            .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    private static ResponseStatusException applicationAlreadyExists(String id) {
        return new ResponseStatusException(HttpStatus.CONFLICT, "Application " + id + " already exists");
    }

    static String assignedPanelRoot(String id) { return "/applications/" + id; }
    /** Below /applications/ only domain applications live; the bare /applications stays the built-in gallery's entry. */
    private static boolean inAssignedSpace(String path) { return path.startsWith("/applications/"); }

    private static boolean hasAssignedPanelPaths(JSONObject app) {
        if (!panelManaged(app) || app.getString("domainId") == null) return true;
        var root = assignedPanelRoot(app.getString("id"));
        return ApplicationPanelUse.under(app.getJSONObject("entry").getString("path"), root)
            && app.getList("panelUses", ApplicationPanelUse.class).stream().allMatch(use -> ApplicationPanelUse.under(use.path(), root));
    }

    private void lockCatalog() {
        db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", Object.class, "application-catalog");
    }
    public static ResponseStatusException bad(String reason) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason); }
    public static ResponseStatusException denied() { return new ResponseStatusException(HttpStatus.FORBIDDEN, "Application access denied"); }
}
