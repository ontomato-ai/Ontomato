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
import java.util.*;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriUtils;
import org.springframework.http.HttpStatus;

@Service
public class ApplicationCatalog {
    private static final org.slf4j.Logger log = LoggerFactory.getLogger(ApplicationCatalog.class);
    public record PanelUseLocation(String applicationId, Map<String, String> names, String useId, String path) {}
    public record EntryMenu(List<Group> groups, List<ApplicationPanelUse> panelUses) {}
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
    public static final String DOMAIN_MEMBER_ENTRY = "domain-member";
    private static final String OBJECT_DETAIL_ROOT = "/browser/detail/";
    private static final String OBJECT_DETAIL_KEY_PREFIX = "browser-detail:";
    private static final int OBJECT_DETAIL_CLASS_MAX_LENGTH = 200 - OBJECT_DETAIL_KEY_PREFIX.length();
    public record Group(String key, Map<String,String> names, int sort) {}
    public record Permission(String code, Map<String,String> names, String groupKey, int sort) {}
    public record Declaration(Map<String,String> names, Map<String,String> descriptions, String icon,
                              List<Group> groups, List<Permission> permissions, List<PageSkills.Mapping> pageSkills,
                              List<ApplicationPanelUse> panelUses) {
        public Declaration {
            pageSkills = pageSkills == null ? List.of() : pageSkills;
            panelUses = panelUses == null ? List.of() : panelUses;
        }
    }
    public record Builtin(String id, String kind, String rail, String category, int sort, JSONObject entry,
                          List<String> entryAccess, String scheduleAdapter, Declaration declaration, String framePanelId) {
        public Builtin(String id, String kind, String rail, String category, int sort, JSONObject entry,
                       List<String> entryAccess, String scheduleAdapter, Declaration declaration) {
            this(id, kind, rail, category, sort, entry, entryAccess, scheduleAdapter, declaration, null);
        }
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
    private final JSONObject upstreams;
    private final PanelResources panels;
    private final io.ontomato.dataengine.service.ProductGrantService grants;
    public ApplicationCatalog(JdbcTemplate db, TransactionTemplate transactions, ApplicationAccess access,
            @Value("${ONTOMATO_APP_UPSTREAMS:{}}") String upstreams, PanelResources panels,
            io.ontomato.dataengine.service.ProductGrantService grants) {
        this.db = db; this.transactions = transactions; this.access = access;
        this.upstreams = JSON.parseObject(upstreams);
        this.panels = panels; this.grants = grants;
    }
    public List<JSONObject> all() {
        return loadApplications(false);
    }

    private List<JSONObject> loadApplications(boolean includeUpdatedAt) {
        return db.query("SELECT * FROM sys_application WHERE kind IS NOT NULL ORDER BY CASE rail WHEN 'top' THEN 0 WHEN 'apps' THEN 1 ELSE 2 END,sort,id",
            (row, index) -> {
                var app = JSONObject.of("id", row.getString("id"), "domainId", row.getString("domain_id"),
                    "ownerService", row.getString("owner_service"), "ownerUserId", row.getString("owner_user_id"),
                    "kind", row.getString("kind"), "names", JSON.parseObject(row.getString("names")),
                    "descriptions", JSON.parseObject(row.getString("descriptions")), "icon", row.getString("icon"),
                    "rail", row.getString("rail"), "category", row.getString("category"), "sort", row.getInt("sort"), "entry", JSON.parseObject(row.getString("entry")),
                    "entryAccess", JSON.parseArray(row.getString("entry_access")), "scheduleAdapter", row.getString("schedule_adapter"),
                    "releaseId", row.getString("release_id"), "pageSkills", JSON.parseArray(row.getString("page_skills"), PageSkills.Mapping.class),
                    "panelUses", JSON.parseArray(row.getString("panel_uses"), ApplicationPanelUse.class),
                    "groups", JSON.parseArray(row.getString("groups"), Group.class),
                    "permissions", JSON.parseArray(row.getString("declaration_permissions"), Permission.class),
                    "panelSettings", JSON.parseObject(row.getString("panel_settings")));
                var updated = row.getObject("updated_at", OffsetDateTime.class);
                if (updated != null) app.put("updatedAt", updated.toInstant());
                return app;
            });
    }
    public PageSkills.Projection pageSkills(User user) {
        var domainId = user.getDomainId();
        var applications = applicationsInDomain(domainId);
        var pageKeys = new BuiltinPageKeys(applications);
        validateLocators(applications, pageKeys);
        var nativeMappings = applications.stream()
            .flatMap(app -> app.getList("pageSkills", PageSkills.Mapping.class).stream()).toList();
        var admittedUses = domainId == null ? List.<ApplicationPanelUse>of() : applications.stream()
            .filter(app -> isPanelSkillApplication(app) && canEnter(app, user))
            .flatMap(app -> entryAdmittedPanelUses(app, user, pageKeys).stream()).toList();
        var mappings = new LinkedHashMap<String, PageSkills.Mapping>();
        for (var mapping : access.pageSkills(nativeMappings, user)) mappings.put(mapping.locator(), mapping);
        for (var group : PanelSkills.groups(admittedUses))
            mappings.merge(group.locator(), group, PageSkills::withPanelDefaults);
        return new PageSkills.Projection(List.copyOf(mappings.values()), nativeMappings.stream().map(PageSkills.Mapping::skill).distinct().toList(),
            admittedUses.stream().map(PanelSkills::entrance).toList());
    }

    public List<PanelSkills.Use> panelSkillSources(String domainId) {
        var apps = applicationsInDomain(domainId);
        var pageKeys = new BuiltinPageKeys(apps);
        return apps.stream().filter(ApplicationCatalog::isPanelSkillApplication)
            .flatMap(app -> pageKeys.activeUses(app).stream()
                .map(use -> PanelSkills.source(app.getString("id"), use)))
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
        return apps.stream().filter(app -> canEnter(app, user) && hasAssignedPanelPaths(app))
            .map(app -> view(app, user, pageKeys)).toList();
    }
    private record CatalogueKey(String id, String name, Instant updatedAt) {}
    private record CatalogueRow(JSONObject app, CatalogueKey key) {}

    public JSONObject catalogue(User user, String search, String scope, String cursor, int size, String sort, Locale locale) {
        if (!"visible".equals(scope) && !"maintainable".equals(scope))
            throw bad("Catalogue scope must be visible or maintainable");
        if (size < 1 || size > 100) throw bad("Catalogue size must be between 1 and 100");

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
        var ordered = apps.stream().filter(app -> matchesCatalogue(app, keyword))
            .map(app -> new CatalogueRow(app, new CatalogueKey(app.getString("id"),
                "name".equals(sort) ? catalogueName(app, locale) : null,
                app.get("updatedAt") instanceof Instant ts ? ts : Instant.EPOCH)))
            .sorted(Comparator.comparing(CatalogueRow::key, order)).toList();
        var matched = new ArrayList<CatalogueRow>();
        var maintainFlags = new ArrayList<Boolean>();
        for (var row : ordered) {
            var app = row.app();
            boolean maintain = canMaintainCatalogue(app, user);
            if (!maintain && ("maintainable".equals(scope) || !canEnter(app, user))) continue;
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
        for (int i = 0; i < matched.size(); i++) {
            var row = matched.get(i);
            if (after != null && order.compare(row.key(), after) <= 0) continue;
            var app = row.app();
            boolean maintain = maintainFlags.get(i);
            if (rows.size() == size)
                return JSONObject.of("rows", rows, "total", total, "nextCursor", catalogueCursor(last, sort, cursorType));
            rows.add(catalogueSummary(app, user, maintain, catalogueEntries(app, user, maintain, pageKeys).size(), ownerNames));
            last = row.key();
        }
        return JSONObject.of("rows", rows, "total", total);
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
        boolean maintain = canMaintainCatalogue(app, user);
        if (!maintain && !canEnter(app, user))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, ApplicationCatalogueForm.notFoundMessage(locale));
        var uses = catalogueEntries(app, user, maintain, new BuiltinPageKeys(apps));
        var ownerId = app.getString("ownerUserId");
        var ownerNames = ownerId != null && !ownerId.isBlank()
            ? grants.principalNames(user.getDomainId(), List.of(ownerId))
            : Map.<String, String>of();
        var result = catalogueSummary(app, user, maintain, uses.size(), ownerNames);
        result.put("entry", publicEntry(app));
        result.put("panelUses", uses);
        var groups = app.getList("groups", Group.class);
        if (maintain) {
            result.put("groups", groups);
            result.put("entryAccess", app.getList("entryAccess", String.class));
            result.putAll(app.getJSONObject("panelSettings"));
        } else {
            var usedGroups = new HashSet<>(uses.stream().map(ApplicationPanelUse::groupKey).toList());
            result.put("groups", groups.stream().filter(group -> usedGroups.contains(group.key())).toList());
            var settings = app.getJSONObject("panelSettings");
            if (settings != null && settings.containsKey("framePanelId")) {
                var framePanelId = settings.getString("framePanelId");
                if (panelManaged(app) || BuiltinProductIds.isValid(framePanelId)) result.put("framePanelId", framePanelId);
            }
        }
        return result;
    }

    private boolean canMaintainCatalogue(JSONObject app, User user) {
        return app.getString("domainId") != null && inDomain(app, user) && access.canMaintain(app, user);
    }

    private List<ApplicationPanelUse> catalogueEntries(JSONObject app, User user, boolean maintain, BuiltinPageKeys pageKeys) {
        if (maintain) return app.getList("panelUses", ApplicationPanelUse.class);
        return isPanelSkillApplication(app) ? visiblePanelUses(app, user, pageKeys) : List.of();
    }

    private JSONObject catalogueSummary(JSONObject app, User user, boolean maintain, int entryCount, Map<String, String> ownerNames) {
        var id = app.getString("id");
        boolean builtin = app.getString("domainId") == null;
        var summary = JSONObject.of("id", id, "names", app.getJSONObject("names"), "descriptions", app.getJSONObject("descriptions"),
            "icon", app.getString("icon"), "source", builtin ? "builtin" : "domain", "canMaintain", maintain,
            "canGrant", !builtin && grants.allowedFor(user.getDomainId(), user.getId(), id, "edit"),
            "canEditEntries", maintain && panelManaged(app), "entryCount", entryCount);
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
            if (!"draft".equals(target.kind()) || user.getDomainId() == null) throw bad("A domain application draft is required");
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

    public ApplicationController.IdentityUpdate updateIdentity(String id, ApplicationController.IdentityUpdate update, User user) {
        return transactions.execute(tx -> {
            lockCatalog();
            var current = require(id);
            requireDomainMaintainer(current, user);
            var errors = ApplicationCatalogueForm.identityErrors(JSONObject.of(
                "names", update.names(), "descriptions", update.descriptions(), "icon", update.icon()));
            if (!errors.isEmpty()) throw bad(errors.getFirst().get("message").asText());
            requireIconChange(current, update.icon(), user);
            db.update("UPDATE sys_application SET names=?::jsonb,descriptions=?::jsonb,icon=?,updated_at=now() WHERE id=? AND domain_id=?",
                JSON.toJSONString(update.names()), JSON.toJSONString(update.descriptions()), update.icon(), id, user.getDomainId());
            return update;
        });
    }

    public boolean canEnter(String id, User user) {
        return canEnter(require(id), user);
    }
    public boolean canEnter(JSONObject app, User user) {
        return inDomain(app,user) && access.canEnter(app,user);
    }
    public boolean canReconcileProducts(User user){return access.administrator(user)&&canEnter("app-builder",user);}
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

    private void requireIconChange(JSONObject application, String icon, User user) {
        var changed = changedIcon(application, icon);
        if (changed != null) panels.requireCurrent(user.getDomainId(), null, List.of(), null, null, changed, null);
    }
    public JSONObject view(JSONObject app, User user) {
        return view(app, user, new BuiltinPageKeys(all()));
    }

    private JSONObject view(JSONObject app, User user, BuiltinPageKeys pageKeys) {
        var result = new JSONObject(app);
        result.put("entry", publicEntry(app));
        result.remove("permissions");
        var settings = app.getJSONObject("panelSettings");
        result.remove("panelSettings");
        if (settings != null && settings.containsKey("framePanelId")) {
            var framePanelId = settings.getString("framePanelId");
            if (panelManaged(app) || BuiltinProductIds.isValid(framePanelId)) result.put("framePanelId", framePanelId);
        }
        if (panelManaged(app)) result.put("panelUses", visiblePanelUses(app, user, pageKeys));
        else if (hasPanelUseRegistration(app))
            result.put("panelUses", canEnter(app, user) ? visiblePanelUses(app, user, pageKeys) : List.of());
        return result;
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
                var declaration = new Declaration(raw.names(), raw.descriptions(), raw.icon(), raw.groups(),
                    raw.permissions(), raw.pageSkills(), ApplicationPanelUse.canonical(raw.panelUses()));
                if (!List.of("native","link").contains(d.kind()) || !List.of("top","apps","bottom").contains(d.rail())
                    || d.category() == null || !List.of("business","build","admin").contains(d.category()))
                    throw bad("Invalid built-in application");
                var old = all().stream().filter(a -> d.id().equals(a.getString("id"))).findFirst();
                if (old.isPresent() && (!service.equals(old.get().getString("ownerService")) || old.get().getString("domainId") != null))
                    throw denied();
                for (var use : declaration.panelUses())
                    if (!BuiltinProductIds.isValid(use.panelId()))
                        throw bad("Built-in application entry " + use.pageKey() + " must reference a platform panel: " + use.panelId());
                if (d.framePanelId() != null && !BuiltinProductIds.isValid(d.framePanelId()))
                    throw bad("Built-in application " + d.id() + " framePanelId must reference a platform panel: " + d.framePanelId());
                var root = builtinPanelRoot(d.entry());
                if ((root != null && inAssignedSpace(root)) || declaration.panelUses().stream().anyMatch(use -> inAssignedSpace(use.path())))
                    throw bad("Built-in applications cannot occupy the assigned application space");
                var editionCodes = access.builtinPermissions(d.id()).stream().map(Permission::code).toList();
                var codes = new HashSet<>(d.entryAccess());
                codes.addAll(editionCodes);
                declaration.permissions().stream().map(Permission::code).forEach(codes::add);
                codes.remove(DOMAIN_MEMBER_ENTRY);
                validateUsePermissions(declaration.panelUses(), codes);
                validateUseGroups(declaration.panelUses(), declaration.groups());
                var claimed = new HashSet<>(declaration.permissions().stream().map(Permission::code).toList());
                declaration.panelUses().stream().map(use -> use.access().permissionCode()).filter(Objects::nonNull).forEach(claimed::add);
                var ownedCodes = new HashSet<>(editionCodes);
                if (!claimed.isEmpty() && "data-engine".equals(service) && old.isPresent()) {
                    // A retained native group owns its menu; another app may only reference it in entryAccess.
                    var priorGroups = old.get().getList("pageSkills", PageSkills.Mapping.class);
                    declaration.pageSkills().stream().filter(priorGroups::contains).map(PageSkills.Mapping::permissionCode)
                        .filter(Objects::nonNull).forEach(ownedCodes::add);
                }
                validateBuiltinPermissionOwnership(d.id(), claimed, ownedCodes);
                validateMappings(d.id(), null, d.entry(), declaration.pageSkills(), declaration.panelUses());
                var panelSettings = d.framePanelId() != null ? JSONObject.of("framePanelId", d.framePanelId()) : new JSONObject();
                save(d.id(), null, service, null, d.kind(), d.rail(), d.category(), d.sort(), d.entry(), d.entryAccess(), d.scheduleAdapter(), null, declaration, panelSettings);
                access.declare(require(d.id()), declaration, old.isEmpty());
            }
            var apps = all();
            new BuiltinPageKeys(apps).reportConflicts(apps,
                Set.copyOf(declarations.stream().map(Builtin::id).toList()));
        });
    }
    public JSONObject publish(String id, Declaration declaration, String releaseId, User user) {
        if (releaseId == null || !releaseId.matches("[a-zA-Z0-9_-]{1,128}")) throw bad("Invalid releaseId");
        return userApplication(id, "hosted", declaration, releaseId, user);
    }
    public JSONObject publishProduct(String id,Declaration declaration,String releaseId,User user){
        if(releaseId==null||!releaseId.matches("[a-zA-Z0-9_-]{1,128}"))throw bad("Invalid releaseId");
        return userApplication(id,"product",declaration,releaseId,user);
    }
    public JSONObject connected(String id, Declaration declaration, String upstream, String upstreamPrefix, User user) {
        access.requireConnectedRegistration(user);
        var allowed = upstreams.getJSONArray(user.getDomainId());
        if (allowed == null || !allowed.contains(upstream)) throw bad("Upstream is not allowed in this domain");
        if (upstreamPrefix == null || !upstreamPrefix.matches("/(?:[a-zA-Z0-9_-]+/)*"))
            throw bad("Invalid upstream prefix");
        return transactions.execute(tx -> {
            var result = userApplication(id, "connected", declaration, null, user);
            db.update("UPDATE sys_application SET entry=entry || ?::jsonb WHERE id=?",
                JSONObject.of("upstream", upstream, "upstreamPrefix", upstreamPrefix).toJSONString(), id);
            return result;
        });
    }
    public JSONObject userApplication(String id, String kind, Declaration declaration, String releaseId, User user) {
        validateId(id); validate(declaration);
        if (!declaration.pageSkills().isEmpty() || !declaration.panelUses().isEmpty()) throw bad("Use the panel application registration for panel relations");
        if(!List.of("hosted","connected","product").contains(kind))throw bad("Invalid user application kind");
        if (!id.startsWith("app-") || user.getDomainId() == null) throw bad("A user application requires an app- ID and domain");
        for (var permission : declaration.permissions())
            if (!ownsPermissionCode(id, permission.code())) throw bad("Application permission prefix required");
        return transactions.execute(tx -> {
            lockCatalog();
            var old = all().stream().filter(a -> id.equals(a.getString("id"))).findFirst();
            if (old.isPresent()) {
                var a = old.get();
                if (panelManaged(a)) throw bad("A panels application cannot use legacy publication");
                if (!kind.equals(a.getString("kind")) || !Objects.equals(user.getDomainId(),a.getString("domainId")) ||
                    !access.canMaintain(a,user)) throw denied();
            }
            requireIconChange(old.orElse(null), declaration.icon(), user);
            String owner = old.isEmpty() ? user.getId() : old.get().getString("ownerUserId");
            String path=kind.equals("product")?"/products/"+id+"?applicationId="+id:"/apps/"+id+"/";
            save(id, user.getDomainId(), List.of("hosted","product").contains(kind) ? "workbench" : "data-engine", owner, kind, "apps", "business", 100,
                JSONObject.of("path",path), List.of(permissionPrefix(id) + "entry"), null, releaseId, declaration);
            var application = require(id);
            access.declare(application, declaration, old.isEmpty());
            return JSONObject.of("applicationId", id, "releaseId", releaseId, "entryPath",path);
        });
    }
    private void validateBuiltinPermissionOwnership(String id, Set<String> codes, Set<String> ownedCodes) {
        if (codes.isEmpty()) return;
        for (var app : applicationsInDomain(null)) {
            var owner = app.getString("id");
            if (id.equals(owner)) continue;
            var declared = new HashSet<>(app.getList("permissions", Permission.class).stream().map(Permission::code).toList());
            access.builtinPermissions(owner).stream().map(Permission::code).forEach(declared::add);
            var entryAccess = app.getList("entryAccess", String.class);
            for (var code : codes) {
                if (declared.contains(code) || (entryAccess.contains(code) && !ownedCodes.contains(code)))
                    throw bad("Permission " + code + " belongs to " + owner);
            }
        }
    }

    static void validateUsePermissions(List<ApplicationPanelUse> uses, Set<String> codes) {
        for (var use : uses) {
            var code = use.access().permissionCode();
            if (code != null && !codes.contains(code))
                throw bad("Panel entry " + use.pageKey() + " must use this application's declared permission: " + code);
        }
    }

    static void validateUseGroups(List<ApplicationPanelUse> uses, List<Group> groups) {
        var keys = new HashSet<>(groups.stream().map(Group::key).toList());
        for (var use : uses) {
            if (use.groupKey() != null && !keys.contains(use.groupKey()))
                throw bad("Unknown group " + use.groupKey() + " on panel entry " + use.pageKey());
        }
    }

    private void save(String id, String domain, String service, String owner, String kind, String rail, String category, int sort,
                      JSONObject entry, List<String> entryAccess, String adapter, String releaseId, Declaration d) {
        save(id, domain, service, owner, kind, rail, category, sort, entry, entryAccess, adapter, releaseId, d, new JSONObject());
    }

    private void save(String id, String domain, String service, String owner, String kind, String rail, String category, int sort,
                      JSONObject entry, List<String> entryAccess, String adapter, String releaseId, Declaration d, JSONObject panelSettings) {
        db.update("""
            INSERT INTO sys_application(id,domain_id,owner_service,owner_user_id,kind,names,descriptions,icon,rail,category,sort,entry,entry_access,schedule_adapter,release_id,groups,entry_path,page_skills,panel_uses,declaration_permissions,panel_settings,updated_at)
            VALUES(?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?::jsonb,?::jsonb,?,?,?::jsonb,?,?::jsonb,?::jsonb,?::jsonb,?::jsonb,now()) ON CONFLICT(id) DO UPDATE SET
            names=excluded.names,descriptions=excluded.descriptions,icon=excluded.icon,rail=excluded.rail,category=excluded.category,sort=excluded.sort,
            entry=excluded.entry,entry_access=excluded.entry_access,schedule_adapter=excluded.schedule_adapter,
            release_id=excluded.release_id,groups=excluded.groups,entry_path=excluded.entry_path,page_skills=excluded.page_skills,panel_uses=excluded.panel_uses,declaration_permissions=excluded.declaration_permissions,panel_settings=excluded.panel_settings,updated_at=now()
            """, id,domain,service,owner,kind,JSON.toJSONString(d.names()),JSON.toJSONString(d.descriptions()),d.icon(),rail,category,sort,
            entry.toJSONString(),JSON.toJSONString(entryAccess),adapter,releaseId,JSON.toJSONString(d.groups()),entry.getString("path"),JSON.toJSONString(d.pageSkills()),JSON.toJSONString(d.panelUses(), JSONWriter.Feature.WriteMapNullValue),JSON.toJSONString(d.permissions()),panelSettings.toJSONString());
    }
    public static void validateId(String id) {
        if (id == null || !id.matches("[a-z][a-z0-9-]{0,63}")) throw bad("Invalid application ID");
    }
    static void validate(Declaration d) {
        if (d == null || !validLocalizedNames(d.names())
            || d.descriptions() == null || d.icon() == null || d.groups() == null || d.permissions() == null) throw bad("Invalid application declaration");
        Set<String> groups = new HashSet<>(), codes = new HashSet<>();
        for (var group : d.groups()) {
            if (group.key() == null || !validLocalizedNames(group.names()) || !groups.add(group.key())) throw bad("Invalid permission group");
        }
        for (var permission : d.permissions()) {
            if (permission.code() == null || DOMAIN_MEMBER_ENTRY.equals(permission.code()) || !validLocalizedNames(permission.names()) ||
                !groups.contains(permission.groupKey()) || !codes.add(permission.code())) throw bad("Invalid permission declaration");
        }
        PageSkills.validate(d.pageSkills());
    }

    public static boolean panelManaged(JSONObject app) {
        return "panels".equals(app.getJSONObject("entry").getString("renderer"));
    }
    private record LocatorDefault(String locator, String pageKey) {}

    private static void validateLocators(List<JSONObject> applications, BuiltinPageKeys pageKeys) {
        var nativeOwners = new HashMap<String, String>();
        var panelOwners = new HashMap<String, Set<String>>();
        var panelPages = new HashSet<String>();
        var defaults = new HashSet<LocatorDefault>();
        for (var app : applications) {
            var applicationId = app.getString("id");
            var mappings = app.getList("pageSkills", PageSkills.Mapping.class);
            PageSkills.validate(mappings);
            for (var mapping : mappings) {
                var locator = mapping.locator();
                if (nativeOwners.putIfAbsent(locator, applicationId) != null) throw bad("Duplicate page locator");
                if (mapping.defaults() != null)
                    for (var entry : mapping.defaults())
                        reserveDefault(defaults, locator, entry.pageKey());
            }

            var uses = pageKeys.activeUses(app);
            ApplicationPanelUse.validate(uses);
            for (var use : uses) {
                if (!panelPages.add(use.pageKey())) throw bad("Panel use page keys must be unique in the domain");
                panelOwners.computeIfAbsent(use.locator(), ignored -> new HashSet<>()).add(applicationId);
                if (use.defaultAgent() != null) reserveDefault(defaults, use.locator(), use.pageKey());
            }
        }
        // A built-in can add panel members to its own native menu group while the native page is still in service.
        for (var entry : nativeOwners.entrySet()) {
            var owners = panelOwners.get(entry.getKey());
            if (owners != null && (!entry.getKey().startsWith("permission:") || !owners.equals(Set.of(entry.getValue()))))
                throw bad("Duplicate page locator or panel use of another application's native permission group");
        }
    }

    private static void reserveDefault(Set<LocatorDefault> defaults, String locator, String pageKey) {
        if (!defaults.add(new LocatorDefault(locator, pageKey)))
            throw bad("Duplicate page skill default for " + pageKey);
    }

    private void validateMappings(String id, String domain, JSONObject entry, List<PageSkills.Mapping> pageSkills, List<ApplicationPanelUse> panelUses) {
        var apps = new ArrayList<>(all().stream().filter(app -> !id.equals(app.getString("id"))).toList());
        apps.add(JSONObject.of("id", id, "domainId", domain, "kind", domain == null ? "native" : "product", "entry", entry,
            "pageSkills", pageSkills, "panelUses", panelUses));
        var pageKeys = new BuiltinPageKeys(apps);
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
            validateLocators(visible, pageKeys);
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
                if (objectDetailClass(use.path()) != null)
                    throw bad("Panel path belongs to the object detail resolver: " + use.path());
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
                .filter(use -> panelId.equals(use.panelId()))
                .map(use -> new PanelUseLocation(app.getString("id"),
                    app.getObject("names", new TypeReference<Map<String, String>>() {}), use.id(), use.path())))
            .toList();
    }

    public void deleteDomainApplication(String id, User user) {
        transactions.executeWithoutResult(tx -> {
            lockCatalog();
            var app = require(id);
            requireDomainMaintainer(app, user);
            access.retire(app);
            // The entry table is stored in this application row.
            db.update("DELETE FROM sys_application WHERE id=? AND domain_id=?", id, user.getDomainId());
        });
    }

    private void requireDomainMaintainer(JSONObject app, User user) {
        if (app.getString("domainId") == null || !inDomain(app, user) || !access.canMaintain(app, user))
            throw denied();
    }

    public JSONObject resolveEntry(String path, User user) {
        var canonical = ApplicationPanelUse.canonicalPath(path);
        var apps = applicationsInDomain(user.getDomainId());
        var pageKeys = new BuiltinPageKeys(apps);
        var detailClass = objectDetailClass(canonical);
        if (detailClass != null) return resolveObjectDetail(canonical, detailClass, user, apps, pageKeys);
        for (var app : apps) {
            if (!hasAssignedPanelPaths(app)) continue;
            var declared = pageKeys.activeUses(app).stream().filter(use -> canonical.equals(use.path())).findFirst();
            if (declared.isPresent()) return resolveDeclaredEntry(app, declared.get().id(), user, pageKeys);
        }
        throw entryNotFound();
    }

    public JSONObject resolveEntry(String applicationId, String useId, User user) {
        if ("browser".equals(applicationId) && useId.startsWith(OBJECT_DETAIL_KEY_PREFIX)) {
            var className = useId.substring(OBJECT_DETAIL_KEY_PREFIX.length());
            if (className.isEmpty()) throw entryNotFound();
            var path = OBJECT_DETAIL_ROOT + UriUtils.encodePathSegment(className, StandardCharsets.UTF_8);
            return resolveEntry(path, user);
        }
        var apps = all();
        var app = require(apps, applicationId);
        if (!inDomain(app, user)) throw denied();
        var pageKeys = new BuiltinPageKeys(apps);
        if (!hasAssignedPanelPaths(app) || pageKeys.activeUses(app).stream().noneMatch(use -> useId.equals(use.id())))
            throw entryNotFound();
        return resolveDeclaredEntry(app, useId, user, pageKeys);
    }

    private JSONObject resolveDeclaredEntry(JSONObject app, String useId, User user, BuiltinPageKeys pageKeys) {
        if (!access.canEnter(app, user)) throw denied();
        var allowed = visiblePanelUses(app, user, pageKeys);
        var use = allowed.stream().filter(entry -> useId.equals(entry.id())).findFirst().orElseThrow(ApplicationCatalog::denied);
        return entryResolution(app, use, allowed);
    }

    private static String objectDetailClass(String path) {
        if (!path.startsWith(OBJECT_DETAIL_ROOT)) return null;
        var segment = path.substring(OBJECT_DETAIL_ROOT.length());
        if (segment.isEmpty() || segment.contains("/")) return null;
        return UriUtils.decode(segment, StandardCharsets.UTF_8);
    }

    private JSONObject resolveObjectDetail(String path, String className, User user, List<JSONObject> apps, BuiltinPageKeys pageKeys) {
        if (className.length() > OBJECT_DETAIL_CLASS_MAX_LENGTH)
            throw bad("Object detail class names must be at most " + OBJECT_DETAIL_CLASS_MAX_LENGTH + " UTF-16 code units");
        var browser = require(apps, "browser");
        if (user.getDomainId() == null || !canEnter(browser, user)) throw denied();
        var panelId = panels.objectDetailPanel(user.getDomainId(), className);
        if (panelId == null) throw entryNotFound();
        if (!grants.allowed(panelId, "use")) throw denied();
        var key = OBJECT_DETAIL_KEY_PREFIX + className;
        var permission = browser.getList("entryAccess", String.class).getFirst();
        var use = new ApplicationPanelUse(key, key, panelId, path, new ApplicationPanelUse.Access(permission, null), null, null);
        return entryResolution(browser, use, visiblePanelUses(browser, user, pageKeys));
    }

    private static JSONObject entryResolution(JSONObject app, ApplicationPanelUse use, List<ApplicationPanelUse> allowed) {
        boolean panels = panelManaged(app);
        var named = allowed.stream().filter(entry -> entry.names() != null)
            .map(entry -> panels ? entry : entry.withoutInputs()).toList();
        var groupKeys = new HashSet<>(named.stream().map(ApplicationPanelUse::groupKey).toList());
        var groups = app.getList("groups", Group.class).stream().filter(group -> groupKeys.contains(group.key()))
            .sorted(Comparator.comparingInt(Group::sort)).toList();
        var result = JSONObject.of("applicationId", app.getString("id"), "use", panels ? use : use.withoutInputs(),
            "menu", new EntryMenu(groups, named));
        var settings = app.getJSONObject("panelSettings");
        if (settings != null && settings.containsKey("framePanelId")) {
            var framePanelId = settings.getString("framePanelId");
            if (panels || BuiltinProductIds.isValid(framePanelId)) result.put("framePanelId", framePanelId);
        }
        if (!panels) return result;
        if (settings != null && settings.containsKey("theme")) result.put("theme", settings.getJSONObject("theme"));
        return result;
    }

    private static ResponseStatusException entryNotFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Panel entry not found");
    }

    public JSONObject panelUses(String id, User user) {
        var apps = all();
        var app = require(apps, id);
        if (!hasPanelUseRegistration(app)) throw bad("Application has no panel use registration");
        if (!inDomain(app, user) || !access.canEnter(app, user)) throw denied();
        return JSONObject.of("applicationId", id, "entry", app.getJSONObject("entry"),
            "panelUses", visiblePanelUses(app, user, new BuiltinPageKeys(apps)));
    }
    public JSONObject managePanelUses(String id, User user) {
        var app = require(id);
        if (!inDomain(app, user) || !access.canMaintain(app, user)) throw denied();
        if (!hasPanelUseRegistration(app)) throw bad("Application has no panel use registration");
        var declaration = JSONObject.of("names", app.getJSONObject("names"), "descriptions", app.getJSONObject("descriptions"),
            "icon", app.getString("icon"), "groups", app.getList("groups", Group.class),
            "permissions", app.getList("permissions", Permission.class));
        var result = JSONObject.of("applicationId", id, "entry", app.getJSONObject("entry"),
            "panelUses", app.getList("panelUses", ApplicationPanelUse.class), "declaration", declaration,
            "entryAccess", app.getList("entryAccess", String.class));
        result.putAll(app.getJSONObject("panelSettings"));
        return result;
    }

    private static void validatePanelSettings(PanelSettings settings) {
        if (settings.framePanelId() != null && settings.framePanelId().isBlank())
            throw bad("framePanelId must be nonblank");
        var delivery = settings.delivery();
        if (delivery != null && (delivery.panels() == null || delivery.projections() == null || delivery.packages() == null
            || delivery.agents() == null || delivery.skills() == null))
            throw bad("Delivery requires panels, projections, packages, agents and skills");
    }

    private List<ApplicationPanelUse> visiblePanelUses(JSONObject app, User user, BuiltinPageKeys pageKeys) {
        if (!hasAssignedPanelPaths(app))
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "Panel application " + app.getString("id") + " must be re-registered with complete canonical paths");
        return entryAdmittedPanelUses(app, user, pageKeys).stream()
            .filter(use -> grants.allowed(use.panelId(), "use")).toList();
    }

    private List<ApplicationPanelUse> entryAdmittedPanelUses(JSONObject app, User user, BuiltinPageKeys pageKeys) {
        return access.panelUses(pageKeys.activeUses(app), user);
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
        if (existing.isEmpty() && (supplied == null || body.entryAccess() == null)) throw bad("New applications require metadata and entry access");
        if (supplied != null && (!supplied.pageSkills().isEmpty() || !supplied.panelUses().isEmpty())) throw bad("Supply panelUses only once");
        if (supplied != null) {
            validate(supplied);
            for (var permission : supplied.permissions()) if (!ownsPermissionCode(id, permission.code())) throw bad("Application permission prefix required");
        }
        for (var use : uses) {
            var code = use.access().permissionCode();
            if (code != null && !ownsPermissionCode(id, code))
                throw bad("Panel entry " + use.pageKey() + " requires this application's permission prefix: " + code);
        }
        var settings = new PanelSettings(body.framePanelId(), body.theme(), body.delivery());
        validatePanelSettings(settings);
        existing.ifPresent(app -> requireDomainMaintainer(app, user));
        var ids = new HashSet<>(uses.stream().map(ApplicationPanelUse::panelId).toList());
        if (settings.framePanelId() != null) ids.add(settings.framePanelId());
        for (var panelId : ids) if (!grants.allowed(panelId, "use")) throw denied();
        return transactions.execute(tx -> {
            lockCatalog();
            var current = all().stream().filter(app -> id.equals(app.getString("id"))).findFirst();
            if (createOnly && current.isPresent()) throw applicationAlreadyExists(id);
            if (current.isPresent() && current.get().getString("domainId") == null) throw denied();
            if (current.isPresent() && !panelManaged(current.get())) throw bad("Use registration cannot take over an existing application");
            current.ifPresent(app -> requireDomainMaintainer(app, user));
            var old = current.orElse(null);
            if (old == null && (supplied == null || body.entryAccess() == null)) throw bad("New applications require metadata and entry access");
            var entryAccess = body.entryAccess() == null ? old.getList("entryAccess", String.class) : body.entryAccess();
            if (entryAccess.size() != 1 || !(DOMAIN_MEMBER_ENTRY.equals(entryAccess.getFirst()) || ownsPermissionCode(id, entryAccess.getFirst())))
                throw bad("Entry access must be domain-member or one permission of this application");
            if (uses.stream().anyMatch(use -> use.access().permissionCode() != null)) {
                var permissions = supplied == null ? old.getList("permissions", Permission.class) : supplied.permissions();
                validateUsePermissions(uses, new HashSet<>(permissions.stream().map(Permission::code).toList()));
            }
            if (uses.stream().anyMatch(use -> use.groupKey() != null))
                validateUseGroups(uses, supplied == null ? old.getList("groups", Group.class) : supplied.groups());
            var entry = JSONObject.of("path", entryPath, "renderer", "panels");
            validateMappings(id, user.getDomainId(), entry, List.of(), uses);
            panels.requireCurrent(user.getDomainId(), settings.framePanelId(), uses, settings.delivery(), settings.theme(),
                supplied == null ? null : changedIcon(old, supplied.icon()), locale);
            if (old != null && supplied == null) {
                db.update("UPDATE sys_application SET entry=?::jsonb,entry_path=?,entry_access=?::jsonb,panel_uses=?::jsonb,panel_settings=?::jsonb,page_skills='[]'::jsonb,updated_at=now() WHERE id=?",
                    entry.toJSONString(), entryPath, JSON.toJSONString(entryAccess), JSON.toJSONString(uses, JSONWriter.Feature.WriteMapNullValue),
                    settings.json().toJSONString(), id);
            } else {
                var declaration = new Declaration(supplied.names(), supplied.descriptions(), supplied.icon(), supplied.groups(), supplied.permissions(), List.of(), uses);
                save(id, user.getDomainId(), "workbench", old == null ? user.getId() : old.getString("ownerUserId"),
                    "product", old == null ? "apps" : old.getString("rail"), old == null ? "business" : old.getString("category"),
                    old == null ? 100 : old.getIntValue("sort"), entry, entryAccess, null, null, declaration, settings.json());
                access.declare(require(id), declaration, old == null);
                if (old == null && body.shared() != null) {
                    grants.share(id, Boolean.TRUE.equals(body.shared()));
                }
            }
            return JSONObject.of("applicationId", id, "entry", entry, "panelUses", uses);
        });
    }
    public static String permissionPrefix(String applicationId) { return "app:" + applicationId + ":"; }

    public static boolean ownsPermissionCode(String applicationId, String code) {
        var prefix = permissionPrefix(applicationId);
        return code != null && code.length() > prefix.length() && code.startsWith(prefix);
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
