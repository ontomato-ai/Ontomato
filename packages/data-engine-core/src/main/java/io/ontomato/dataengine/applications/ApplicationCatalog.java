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
    public record Group(String key, Map<String,String> names, int sort) {}
    public record Permission(String code, Map<String,String> names, String groupKey, int sort) {}
    public record Declaration(Map<String,String> names, Map<String,String> descriptions, String icon,
                              List<Group> groups, List<Permission> permissions) {}
    public record Builtin(String id, String kind, String rail, String category, int sort, JSONObject entry,
                          List<String> entryAccess, String scheduleAdapter, Declaration declaration) {}
    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    private final ApplicationAccess access;
    private final JSONObject upstreams;
    public ApplicationCatalog(JdbcTemplate db, TransactionTemplate transactions, ApplicationAccess access,
            @Value("${ONTOMATO_APP_UPSTREAMS:{}}") String upstreams) {
        this.db = db; this.transactions = transactions; this.access = access;
        this.upstreams = JSON.parseObject(upstreams);
    }
    public List<JSONObject> all() {
        return db.query("SELECT * FROM sys_application WHERE kind IS NOT NULL ORDER BY CASE rail WHEN 'top' THEN 0 WHEN 'apps' THEN 1 ELSE 2 END,sort,id",
            (row, index) -> JSONObject.of("id", row.getString("id"), "domainId", row.getString("domain_id"),
                "ownerService", row.getString("owner_service"), "ownerUserId", row.getString("owner_user_id"),
                "kind", row.getString("kind"), "names", JSON.parseObject(row.getString("names")),
                "descriptions", JSON.parseObject(row.getString("descriptions")), "icon", row.getString("icon"),
                "rail", row.getString("rail"), "category", row.getString("category"), "sort", row.getInt("sort"), "entry", JSON.parseObject(row.getString("entry")),
                "entryAccess", JSON.parseArray(row.getString("entry_access")), "scheduleAdapter", row.getString("schedule_adapter"),
                "releaseId", row.getString("release_id")));
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
    public JSONObject view(JSONObject app) {
        var result = new JSONObject(app);
        var entry = new JSONObject(app.getJSONObject("entry"));
        entry.remove("upstream"); entry.remove("upstreamPrefix");
        result.put("entry",entry);
        return result;
    }
    public void builtins(String service, List<Builtin> declarations) {
        transactions.executeWithoutResult(tx -> {
            for (var d : declarations) {
                validateId(d.id()); validate(d.declaration());
                if (!List.of("native","link").contains(d.kind()) || !List.of("top","apps","bottom").contains(d.rail())
                    || d.category() == null || !List.of("business","build","admin").contains(d.category()))
                    throw bad("Invalid built-in application");
                var old = all().stream().filter(a -> d.id().equals(a.getString("id"))).findFirst();
                if (old.isPresent() && (!service.equals(old.get().getString("ownerService")) || old.get().getString("domainId") != null))
                    throw denied();
                save(d.id(), null, service, null, d.kind(), d.rail(), d.category(), d.sort(), d.entry(), d.entryAccess(), d.scheduleAdapter(), null, d.declaration());
                access.declare(require(d.id()), d.declaration(), old.isEmpty());
            }
        });
    }
    public JSONObject publish(String id, Declaration declaration, String releaseId, User user) {
        if (releaseId == null || !releaseId.matches("[a-zA-Z0-9_-]{1,128}")) throw bad("Invalid releaseId");
        return userApplication(id, "hosted", declaration, releaseId, user);
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
        if (!id.startsWith("app-") || user.getDomainId() == null) throw bad("A user application requires an app- ID and domain");
        for (var permission : declaration.permissions())
            if (!permission.code().startsWith("app:" + id + ":")) throw bad("Application permission prefix required");
        return transactions.execute(tx -> {
            var old = all().stream().filter(a -> id.equals(a.getString("id"))).findFirst();
            if (old.isPresent()) {
                var a = old.get();
                if (!kind.equals(a.getString("kind")) || !Objects.equals(user.getDomainId(),a.getString("domainId")) ||
                    !access.canMaintain(a,user)) throw denied();
            }
            String owner = old.isEmpty() ? user.getId() : old.get().getString("ownerUserId");
            save(id, user.getDomainId(), kind.equals("hosted") ? "workbench" : "data-engine", owner, kind, "apps", "business", 100,
                JSONObject.of("path", "/apps/" + id + "/"), List.of("app:" + id + ":entry"), null, releaseId, declaration);
            var application = require(id);
            access.declare(application, declaration, old.isEmpty());
            return JSONObject.of("applicationId", id, "releaseId", releaseId, "entryPath", "/apps/" + id + "/");
        });
    }
    private void save(String id, String domain, String service, String owner, String kind, String rail, String category, int sort,
                      JSONObject entry, List<String> entryAccess, String adapter, String releaseId, Declaration d) {
        db.update("""
            INSERT INTO sys_application(id,domain_id,owner_service,owner_user_id,kind,names,descriptions,icon,rail,category,sort,entry,entry_access,schedule_adapter,release_id,groups,entry_path,updated_at)
            VALUES(?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?::jsonb,?::jsonb,?,?,?::jsonb,?,now()) ON CONFLICT(id) DO UPDATE SET
            names=excluded.names,descriptions=excluded.descriptions,icon=excluded.icon,rail=excluded.rail,category=excluded.category,sort=excluded.sort,
            entry=excluded.entry,entry_access=excluded.entry_access,schedule_adapter=excluded.schedule_adapter,
            release_id=excluded.release_id,groups=excluded.groups,entry_path=excluded.entry_path,updated_at=now()
            """, id,domain,service,owner,kind,JSON.toJSONString(d.names()),JSON.toJSONString(d.descriptions()),d.icon(),rail,category,sort,
            entry.toJSONString(),JSON.toJSONString(entryAccess),adapter,releaseId,JSON.toJSONString(d.groups()),entry.getString("path"));
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
    }
    public static ResponseStatusException bad(String reason) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason); }
    public static ResponseStatusException denied() { return new ResponseStatusException(HttpStatus.FORBIDDEN, "Application access denied"); }
}
