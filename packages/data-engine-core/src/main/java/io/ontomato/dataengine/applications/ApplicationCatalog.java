package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@Service
public class ApplicationCatalog {
    private record PanelSkillGroup(PageSkills.Mapping mapping, PanelSkills.Source source) {}
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
                          List<String> entryAccess, String scheduleAdapter, Declaration declaration) {}
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
        return db.query("SELECT * FROM sys_application WHERE kind IS NOT NULL ORDER BY CASE rail WHEN 'top' THEN 0 WHEN 'apps' THEN 1 ELSE 2 END,sort,id",
            (row, index) -> JSONObject.of("id", row.getString("id"), "domainId", row.getString("domain_id"),
                "ownerService", row.getString("owner_service"), "ownerUserId", row.getString("owner_user_id"),
                "kind", row.getString("kind"), "names", JSON.parseObject(row.getString("names")),
                "descriptions", JSON.parseObject(row.getString("descriptions")), "icon", row.getString("icon"),
                "rail", row.getString("rail"), "category", row.getString("category"), "sort", row.getInt("sort"), "entry", JSON.parseObject(row.getString("entry")),
                "entryAccess", JSON.parseArray(row.getString("entry_access")), "scheduleAdapter", row.getString("schedule_adapter"),
                "releaseId", row.getString("release_id"), "pageSkills", JSON.parseArray(row.getString("page_skills"), PageSkills.Mapping.class),
                "panelUses", JSON.parseArray(row.getString("panel_uses"), ApplicationPanelUse.class)));
    }
    public PageSkills.Projection pageSkills(User user) {
        var domainId = user.getDomainId();
        var applications = applicationsInDomain(domainId);
        validateLocators(applications);
        var mappings = new ArrayList<>(applications.stream().filter(app -> !panelManaged(app))
            .flatMap(app -> app.getList("pageSkills", PageSkills.Mapping.class).stream()).toList());
        if (domainId != null)
            panelSkillGroups(domainId, applications).stream().map(PanelSkillGroup::mapping).forEach(mappings::add);
        return new PageSkills.Projection(access.pageSkills(mappings,user), mappings.stream().map(PageSkills.Mapping::skill).distinct().toList());
    }
    public List<PanelSkills.Source> panelSkillSources(String domainId) {
        var applications = applicationsInDomain(domainId);
        return panelSkillGroups(domainId, applications).stream().map(PanelSkillGroup::source).toList();
    }
    private List<JSONObject> applicationsInDomain(String domainId) {
        return all().stream().filter(app -> app.getString("domainId") == null
            || Objects.equals(app.getString("domainId"), domainId)).toList();
    }
    private static List<PanelSkillGroup> panelSkillGroups(String domainId, List<JSONObject> applications) {
        var groups = new LinkedHashMap<String, List<PanelSkills.LocatedUse>>();
        for (var app : applications) {
            if (!panelManaged(app)) continue;
            for (var use : app.getList("panelUses", ApplicationPanelUse.class)) {
                groups.computeIfAbsent(use.locator(), key -> new ArrayList<>()).add(new PanelSkills.LocatedUse(app.getString("id"), use));
            }
        }
        return groups.values().stream().map(uses -> {
            var first = uses.getFirst().use();
            var skill = PanelSkills.identity(domainId, first);
            var defaults = uses.stream().map(PanelSkills.LocatedUse::use).filter(use -> use.defaultAgentId() != null)
                .map(use -> new PageSkills.Default(use.pageKey(), use.defaultAgentId())).toList();
            var key = first.access().permissionCode() == null ? first.pageKey() : null;
            var mapping = new PageSkills.Mapping(first.access().permissionCode(), first.access().kind(), key, skill,
                defaults.isEmpty() ? null : defaults);
            var source = new PanelSkills.Source(skill, uses.stream().map(PanelSkills.LocatedUse::source).toList());
            return new PanelSkillGroup(mapping, source);
        }).toList();
    }
    public JSONObject require(String id) {
        return all().stream().filter(a -> id.equals(a.getString("id"))).findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Application not found"));
    }
    public boolean inDomain(JSONObject app, User user) {
        return app.getString("domainId") == null || Objects.equals(app.getString("domainId"), user.getDomainId());
    }
    public List<JSONObject> visible(User user) {
        return all().stream().filter(a -> inDomain(a,user)).filter(a ->
            access.canEnter(a,user)).map(this::view).toList();
    }
    public boolean canEnter(String id, User user) {
        var app = require(id);
        return inDomain(app,user) && access.canEnter(app,user);
    }
    public boolean canReconcileProducts(User user){return access.administrator(user)&&canEnter("app-builder",user);}
    public void updateIcon(String id,String icon,User user){
        var app=require(id);
        if(app.getString("domainId")==null||!inDomain(app,user)||!access.canMaintain(app,user))throw denied();
        if(icon==null||!icon.matches("[a-z][a-z0-9-]{0,63}"))throw bad("Invalid application icon");
        db.update("UPDATE sys_application SET icon=?,updated_at=now() WHERE id=?",icon,id);
    }
    public JSONObject view(JSONObject app) {
        var result = new JSONObject(app);
        var entry = new JSONObject(app.getJSONObject("entry"));
        entry.remove("upstream"); entry.remove("upstreamPrefix");
        result.put("entry",entry);
        return result;
    }
    /** Reconcile a service's complete builtin collection; per-file Java declarations remain incremental. */
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
                validateId(d.id()); validate(d.declaration()); validateEntry(d.entry(), d.declaration());
                if (!List.of("native","link").contains(d.kind()) || !List.of("top","apps","bottom").contains(d.rail())
                    || d.category() == null || !List.of("business","build","admin").contains(d.category()))
                    throw bad("Invalid built-in application");
                var old = all().stream().filter(a -> d.id().equals(a.getString("id"))).findFirst();
                if (old.isPresent() && (!service.equals(old.get().getString("ownerService")) || old.get().getString("domainId") != null))
                    throw denied();
                validateMappings(d.id(), null, d.entry(), d.declaration().pageSkills(), d.declaration().panelUses());
                save(d.id(), null, service, null, d.kind(), d.rail(), d.category(), d.sort(), d.entry(), d.entryAccess(), d.scheduleAdapter(), null, d.declaration());
                access.declare(require(d.id()), d.declaration(), old.isEmpty());
            }
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
            if (!permission.code().startsWith("app:" + id + ":")) throw bad("Application permission prefix required");
        return transactions.execute(tx -> {
            lockCatalog();
            var old = all().stream().filter(a -> id.equals(a.getString("id"))).findFirst();
            if (old.isPresent()) {
                var a = old.get();
                if (panelManaged(a)) throw bad("A panels application cannot use legacy publication");
                if (!kind.equals(a.getString("kind")) || !Objects.equals(user.getDomainId(),a.getString("domainId")) ||
                    !access.canMaintain(a,user)) throw denied();
            }
            String owner = old.isEmpty() ? user.getId() : old.get().getString("ownerUserId");
            String path=kind.equals("product")?"/products/"+id+"?applicationId="+id:"/apps/"+id+"/";
            save(id, user.getDomainId(), List.of("hosted","product").contains(kind) ? "workbench" : "data-engine", owner, kind, "apps", "business", 100,
                JSONObject.of("path",path), List.of("app:" + id + ":entry"), null, releaseId, declaration);
            var application = require(id);
            access.declare(application, declaration, old.isEmpty());
            return JSONObject.of("applicationId", id, "releaseId", releaseId, "entryPath",path);
        });
    }
    private void save(String id, String domain, String service, String owner, String kind, String rail, String category, int sort,
                      JSONObject entry, List<String> entryAccess, String adapter, String releaseId, Declaration d) {
        db.update("""
            INSERT INTO sys_application(id,domain_id,owner_service,owner_user_id,kind,names,descriptions,icon,rail,category,sort,entry,entry_access,schedule_adapter,release_id,groups,entry_path,page_skills,panel_uses,updated_at)
            VALUES(?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?::jsonb,?::jsonb,?,?,?::jsonb,?,?::jsonb,?::jsonb,now()) ON CONFLICT(id) DO UPDATE SET
            names=excluded.names,descriptions=excluded.descriptions,icon=excluded.icon,rail=excluded.rail,category=excluded.category,sort=excluded.sort,
            entry=excluded.entry,entry_access=excluded.entry_access,schedule_adapter=excluded.schedule_adapter,
            release_id=excluded.release_id,groups=excluded.groups,entry_path=excluded.entry_path,page_skills=excluded.page_skills,panel_uses=excluded.panel_uses,updated_at=now()
            """, id,domain,service,owner,kind,JSON.toJSONString(d.names()),JSON.toJSONString(d.descriptions()),d.icon(),rail,category,sort,
            entry.toJSONString(),JSON.toJSONString(entryAccess),adapter,releaseId,JSON.toJSONString(d.groups()),entry.getString("path"),JSON.toJSONString(d.pageSkills()),JSON.toJSONString(d.panelUses()));
    }
    public static void validateId(String id) {
        if (id == null || !id.matches("[a-z][a-z0-9-]{0,63}")) throw bad("Invalid application ID");
    }
    private static void validate(Declaration d) {
        if (d == null || d.names() == null || d.names().get("en") == null || d.names().get("en").isBlank()
            || d.descriptions() == null || d.icon() == null || d.groups() == null || d.permissions() == null) throw bad("Invalid application declaration");
        Set<String> groups = new HashSet<>(), codes = new HashSet<>();
        for (var group : d.groups()) {
            if (group.key() == null || group.names() == null || !group.names().containsKey("en") || !groups.add(group.key())) throw bad("Invalid permission group");
        }
        for (var permission : d.permissions()) {
            if (permission.code() == null || permission.names() == null || !permission.names().containsKey("en") ||
                !groups.contains(permission.groupKey()) || !codes.add(permission.code())) throw bad("Invalid permission declaration");
        }
        PageSkills.validate(d.pageSkills());
        ApplicationPanelUse.validate(d.panelUses());
        if (!d.pageSkills().isEmpty() && !d.panelUses().isEmpty()) throw bad("Panel applications cannot declare page skills");
    }

    public static boolean panelManaged(JSONObject app) {
        return "panels".equals(app.getJSONObject("entry").getString("renderer"));
    }
    private static void validateEntry(JSONObject entry, Declaration declaration) {
        if ("panels".equals(entry.getString("renderer"))) {
            if (!declaration.pageSkills().isEmpty()) throw bad("Panel applications cannot declare page skills");
        } else if (!declaration.panelUses().isEmpty()) throw bad("Panel uses require a panels entry");
    }
    private static void validateLocators(List<JSONObject> applications) {
        var locators = new HashMap<String, Boolean>();
        var panelPages = new HashSet<String>();
        for (var app : applications) {
            if (panelManaged(app)) {
                var uses = app.getList("panelUses", ApplicationPanelUse.class);
                ApplicationPanelUse.validate(uses);
                for (var use : uses) {
                    if (!panelPages.add(use.pageKey())) throw bad("Panel use page keys must be unique in the domain");
                    reserveLocator(locators, use.locator(), true, use.access().permissionCode() != null);
                }
            } else {
                var mappings = app.getList("pageSkills", PageSkills.Mapping.class);
                PageSkills.validate(mappings);
                for (var mapping : mappings) reserveLocator(locators, mapping.locator(), false, mapping.permissionCode() != null);
            }
        }
    }
    private static void reserveLocator(Map<String, Boolean> locators, String locator, boolean panel, boolean menu) {
        var previous = locators.putIfAbsent(locator, panel);
        if (previous != null && (!previous || !panel || !menu))
            throw bad("Duplicate page locator or mixed legacy/panels permission group");
    }
    private void validateMappings(String id, String domain, JSONObject entry, List<PageSkills.Mapping> pageSkills, List<ApplicationPanelUse> panelUses) {
        var apps = new ArrayList<>(all().stream().filter(app -> !id.equals(app.getString("id"))).toList());
        apps.add(JSONObject.of("id", id, "domainId", domain, "entry", entry,
            "pageSkills", pageSkills, "panelUses", panelUses));
        var domains = new HashSet<String>(); domains.add(domain);
        for (var app : apps) domains.add(app.getString("domainId"));
        for (var scope : domains) validateLocators(apps.stream().filter(app -> app.getString("domainId") == null || Objects.equals(scope, app.getString("domainId"))).toList());
    }
    public JSONObject panelUses(String id, User user) {
        var app = require(id);
        if (!panelManaged(app)) throw bad("Application is not managed by panels");
        if (!inDomain(app, user) || !access.canEnter(app, user)) throw denied();
        var uses = access.panelUses(app.getList("panelUses", ApplicationPanelUse.class), user).stream()
            .filter(use -> grants.allowed(use.panelId(), "use")).toList();
        return JSONObject.of("applicationId", id, "entry", app.getJSONObject("entry"), "panelUses", uses);
    }
    public JSONObject putPanelUses(String id, ApplicationController.PanelRegistration body, User user) {
        validateId(id);
        if (user.getDomainId() == null || !id.startsWith("app-")) throw bad("A panel application requires an app- ID and domain");
        if (body.entry() == null || body.panelUses() == null || !"panels".equals(body.entry().renderer()) || body.entry().path() == null || !body.entry().path().matches("/(?!/).*"))
            throw bad("A panels entry and local path are required");
        var existing = all().stream().filter(app -> id.equals(app.getString("id"))).findFirst();
        if (existing.isPresent() && !panelManaged(existing.get())) throw bad("Use registration cannot take over an existing application");
        var supplied = body.declaration();
        if (existing.isEmpty() && (supplied == null || body.entryAccess() == null)) throw bad("New applications require metadata and entry access");
        if (supplied != null && (!supplied.pageSkills().isEmpty() || !supplied.panelUses().isEmpty())) throw bad("Supply panelUses only once");
        ApplicationPanelUse.validate(body.panelUses());
        if (supplied != null) {
            validate(supplied);
            for (var permission : supplied.permissions()) if (!permission.code().startsWith("app:" + id + ":")) throw bad("Application permission prefix required");
        }
        if (body.entryAccess() != null && body.entryAccess().isEmpty()) throw bad("Entry access is required");
        var ids = body.panelUses().stream().map(ApplicationPanelUse::panelId).distinct().toList();
        for (var panelId : ids) if (!grants.allowed(panelId, "use")) throw denied();
        panels.requireCurrent(user.getDomainId(), ids);
        return transactions.execute(tx -> {
            lockCatalog();
            var current = all().stream().filter(app -> id.equals(app.getString("id"))).findFirst();
            if (current.isPresent() && !panelManaged(current.get())) throw bad("Use registration cannot take over an existing application");
            if (current.isPresent() && (!inDomain(current.get(), user) || !access.canMaintain(current.get(), user))) throw denied();
            var old = current.orElse(null);
            if (old == null && (supplied == null || body.entryAccess() == null)) throw bad("New applications require metadata and entry access");
            var entry = JSONObject.of("path", body.entry().path(), "renderer", "panels");
            validateMappings(id, user.getDomainId(), entry, List.of(), body.panelUses());
            var entryAccess = body.entryAccess() == null ? old.getList("entryAccess", String.class) : body.entryAccess();
            if (old != null && supplied == null) {
                db.update("UPDATE sys_application SET entry=?::jsonb,entry_path=?,entry_access=?::jsonb,panel_uses=?::jsonb,page_skills='[]'::jsonb,updated_at=now() WHERE id=?",
                    entry.toJSONString(), body.entry().path(), JSON.toJSONString(entryAccess), JSON.toJSONString(body.panelUses()), id);
            } else {
                var declaration = new Declaration(supplied.names(), supplied.descriptions(), supplied.icon(), supplied.groups(), supplied.permissions(), List.of(), body.panelUses());
                save(id, user.getDomainId(), "workbench", old == null ? user.getId() : old.getString("ownerUserId"),
                    "product", old == null ? "apps" : old.getString("rail"), old == null ? "business" : old.getString("category"),
                    old == null ? 100 : old.getIntValue("sort"), entry, entryAccess, null, null, declaration);
                access.declare(require(id), declaration, old == null);
            }
            return JSONObject.of("applicationId", id, "entry", entry, "panelUses", body.panelUses());
        });
    }
    private void lockCatalog() {
        db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", Object.class, "application-catalog");
    }
    public static ResponseStatusException bad(String reason) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason); }
    public static ResponseStatusException denied() { return new ResponseStatusException(HttpStatus.FORBIDDEN, "Application access denied"); }
}
