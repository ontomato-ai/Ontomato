package io.ontomato.dataengine.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.context.annotation.DependsOn;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Resource registration is service-only; permission checks always resolve the current subject. */
@Service
@DependsOn("jdbcInitDb")
public class ProductGrantService implements InitializingBean {
    private final JdbcTemplate db;
    private final IdentityService identity;
    private final ProductPrincipalLookup principals;
    public ProductGrantService(JdbcTemplate db,IdentityService identity,ProductPrincipalLookup principals){this.db=db;this.identity=identity;this.principals=principals;}
    @Override public void afterPropertiesSet(){db.execute("""
        CREATE TABLE IF NOT EXISTS product_resource(domain_id text NOT NULL,id text NOT NULL,PRIMARY KEY(domain_id,id));
        CREATE TABLE IF NOT EXISTS product_grant(domain_id text NOT NULL,resource_id text NOT NULL,principal_kind text NOT NULL,principal_id text NOT NULL,verb text NOT NULL,PRIMARY KEY(domain_id,resource_id,principal_kind,principal_id,verb));
        CREATE INDEX IF NOT EXISTS product_grant_principal ON product_grant(domain_id,principal_kind,principal_id,verb);
        """);}
    public boolean allowed(String id,String verb){
        var user=identity.getCurrentUser();if(user==null||user.getDomainId()==null)return false;
        return allowedFor(user.getDomainId(),user.getId(),id,verb);
    }
    public boolean allowedFor(String domainId,String userId,String id,String verb){
        if(domainId==null||userId==null)return false;
        if (BuiltinProductIds.isReserved(id)) return BuiltinProductIds.isValid(id) && "use".equals(verb);
        userId=principals.productPrincipalId(userId);
        return ProductGrants.allows(resourceGrants(domainId,id),userId,principals.effectiveRoles(userId,domainId),verb);
    }

    private List<ProductGrants.Grant> resourceGrants(String domainId, String id) {
        return db.query("SELECT principal_kind,principal_id,verb FROM product_grant WHERE domain_id=? AND resource_id=?",
            (row, index) -> new ProductGrants.Grant(row.getString(1), row.getString(2), row.getString(3)), domainId, id);
    }

    public record OwnerFacts(String ownerId, String state) {}

    public Map<String, Boolean> allowedBatch(Collection<String> ids, String verb) {
        var user = identity.getCurrentUser();
        return allowedBatchFor(user == null ? null : user.getDomainId(), user == null ? null : user.getId(), ids, verb);
    }

    public Map<String, Boolean> allowedBatchFor(String domainId, String userId, Collection<String> ids, String verb) {
        var allowed = new LinkedHashMap<String, Boolean>();
        for (String id : ids) allowed.put(id, false);
        if (domainId == null || userId == null || !ProductGrants.isValidVerb(verb)) return allowed;

        var domainIds = new ArrayList<String>();
        for (String id : allowed.keySet()) {
            if (BuiltinProductIds.isReserved(id)) allowed.put(id, BuiltinProductIds.isValid(id) && "use".equals(verb));
            else domainIds.add(id);
        }
        if (domainIds.isEmpty()) return allowed;

        String principalId = principals.productPrincipalId(userId);
        var roles = principals.effectiveRoles(userId, domainId);
        var parameters = new ArrayList<String>(domainIds.size() + 1);
        parameters.add(domainId);
        parameters.addAll(domainIds);
        String placeholders = String.join(", ", Collections.nCopies(domainIds.size(), "?"));
        var grants = db.query(
            "SELECT resource_id, principal_kind, principal_id, verb FROM product_grant WHERE domain_id = ? AND resource_id IN (" + placeholders + ")",
            rows -> {
                var byId = new HashMap<String, List<ProductGrants.Grant>>();
                while (rows.next()) {
                    byId.computeIfAbsent(rows.getString(1), key -> new ArrayList<>())
                        .add(new ProductGrants.Grant(rows.getString(2), rows.getString(3), rows.getString(4)));
                }
                return byId;
            }, parameters.toArray());
        for (String id : domainIds)
            allowed.put(id, ProductGrants.allows(grants.getOrDefault(id, List.of()), principalId, roles, verb));
        return allowed;
    }
    public List<String> resources(String verb){
        var user=identity.getCurrentUser();if(user==null||user.getDomainId()==null)return List.of();
        return resourcesFor(user.getDomainId(),user.getId(),verb);
    }
    public List<String> resourcesFor(String domainId,String userId,String verb){
        if(domainId==null||userId==null)throw new IllegalArgumentException("Product subject is required");
        String principalId=principals.productPrincipalId(userId);
        if(!ProductGrants.isValidVerb(verb))throw new IllegalArgumentException("Invalid product permission");
        var roles=principals.effectiveRoles(userId,domainId);
        var rows=db.queryForList("SELECT resource_id,principal_kind,principal_id FROM product_grant WHERE domain_id=? AND verb=?",domainId,verb);
        return rows.stream()
            .filter(row -> !BuiltinProductIds.isReserved((String) row.get("resource_id")))
            .filter(row -> ProductGrants.allows(List.of(new ProductGrants.Grant(
                (String) row.get("principal_kind"), (String) row.get("principal_id"), verb)), principalId, roles, verb))
            .map(row -> (String) row.get("resource_id")).distinct().sorted().toList();
    }
    /** The owning product service imports author and sharing facts; request bodies cannot select the acting user. */
    @Transactional public boolean register(String domainId,String id,String ownerId,boolean shared){
        return register(domainId, id, ownerId, shared, List.of("use", "edit"));
    }

    @Transactional
    public boolean register(String domainId, String id, String ownerId, boolean shared, Collection<String> verbs) {
        return register(domainId, id, ownerId, shared, verbs, false);
    }

    @Transactional
    public boolean register(String domainId, String id, String ownerId, boolean shared, Collection<String> verbs,
            boolean grantAdmin) {
        boolean hasOwner = ownerId != null && !ownerId.isBlank();
        if (domainId == null || domainId.isBlank() || id == null || id.isBlank() || (!hasOwner && !shared && !grantAdmin))
            throw new IllegalArgumentException("Product identity is required");
        requireDomainGrantResource(id);
        var permissions = verbs == null || verbs.isEmpty() ? List.of("use", "edit") : verbs;
        requireValidVerbs(permissions);
        lockResource(domainId,id);
        if (db.update("INSERT INTO product_resource(domain_id,id) VALUES(?,?) ON CONFLICT DO NOTHING", domainId, id) == 0)
            return false;
        if (hasOwner)
            for (String verb : permissions) insert(domainId, id, new ProductGrants.Grant("principal", ownerId, verb));
        if (grantAdmin)
            for (var grant : principals.defaultAdminGrants(domainId, permissions)) insert(domainId, id, grant);
        if (shared) insert(domainId, id, new ProductGrants.Grant("domain", "*", "use"));
        return true;
    }
    @Transactional public void unregister(String domainId, String id) {
        requireDomainGrantResource(id);
        lockResource(domainId, id);
        db.update("DELETE FROM product_grant WHERE domain_id=? AND resource_id=?", domainId, id);
        db.update("DELETE FROM product_resource WHERE domain_id=? AND id=?", domainId, id);
    }

    @Transactional public void retireApplication(String domainId, String id) {
        unregister(domainId, id);
    }

    private static void requireDomainGrantResource(String id) {
        if (BuiltinProductIds.isReserved(id))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Platform products do not have domain grants");
    }

    private void lockResource(String domainId, String id) {
        db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", Object.class, "product-grant:" + domainId + ":" + id);
    }

    private void insert(String domain,String id,ProductGrants.Grant grant){db.update("INSERT INTO product_grant(domain_id,resource_id,principal_kind,principal_id,verb) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",domain,id,grant.principalKind(),grant.principalId(),grant.verb());}
    @Transactional public void grant(String id,ProductGrants.Grant grant,boolean remove){
        requireDomainGrantResource(id);
        var current=identity.getCurrentUser();
        if(current!=null)lockResource(current.getDomainId(),id);
        if(!allowed(id,"edit"))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Product edit Grant required");
        if(!ProductGrants.isValidVerb(grant.verb())||!List.of("principal","role").contains(grant.principalKind())||grant.principalId()==null||grant.principalId().isBlank())throw new IllegalArgumentException("Invalid product Grant");
        String domain=identity.getCurrentUser().getDomainId();
        changeGrant(domain, id, grant, remove);
    }

    private void changeGrant(String domain, String id, ProductGrants.Grant grant, boolean remove) {
        if(remove)db.update("DELETE FROM product_grant WHERE domain_id=? AND resource_id=? AND principal_kind=? AND principal_id=? AND verb=?",domain,id,grant.principalKind(),grant.principalId(),grant.verb());
        else insert(domain,id,grant);
    }
    private static void requireValidVerbs(Collection<String> verbs) {
        if (verbs.stream().anyMatch(verb -> !ProductGrants.isValidVerb(verb)))
            throw new IllegalArgumentException("Invalid product permission");
    }

    @Transactional
    public void setGrants(String id, String principalKind, String principalId, Collection<String> verbs) {
        requireDomainGrantResource(id);
        if (!("principal".equals(principalKind) || "role".equals(principalKind)) || principalId == null || principalId.isBlank())
            throw new IllegalArgumentException("Invalid product Grant");
        requireValidVerbs(verbs);
        var current = identity.getCurrentUser();
        if (current != null && current.getDomainId() != null) lockResource(current.getDomainId(), id);
        if (!allowed(id, "edit")) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Product edit Grant required");
        String domain = current.getDomainId();
        db.update("DELETE FROM product_grant WHERE domain_id=? AND resource_id=? AND principal_kind=? AND principal_id=?",
            domain, id, principalKind, principalId);
        for (String verb : new LinkedHashSet<>(verbs)) insert(domain, id, new ProductGrants.Grant(principalKind, principalId, verb));
    }

    @Transactional public void share(String id,boolean shared){
        requireDomainGrantResource(id);
        var current=identity.getCurrentUser();
        if(current!=null)lockResource(current.getDomainId(),id);
        if(!allowed(id,"edit"))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Product edit Grant required");
        String domain=identity.getCurrentUser().getDomainId();
        db.update("DELETE FROM product_grant WHERE domain_id=? AND resource_id=? AND principal_kind='domain'",domain,id);
        if(shared)insert(domain,id,new ProductGrants.Grant("domain","*","use"));
    }

    @Transactional
    public void shareApplicationUse(String domain, String id, boolean shared) {
        lockResource(domain, id);
        if (shared) insert(domain, id, new ProductGrants.Grant("domain", "*", "use"));
        else db.update("""
            DELETE FROM product_grant WHERE domain_id=? AND resource_id=? AND principal_kind='domain'
            AND principal_id='*' AND verb='use'
            """, domain, id);
    }

    public List<ProductGrants.Grant> grants(String id){
        if(!allowed(id,"edit"))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Product edit Grant required");
        return db.query("SELECT principal_kind,principal_id,verb FROM product_grant WHERE domain_id=? AND resource_id=? ORDER BY principal_kind,principal_id,verb",(row,index)->new ProductGrants.Grant(row.getString(1),row.getString(2),row.getString(3)),identity.getCurrentUser().getDomainId(),id);
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record GrantView(String principalKind, String principalId, String principalName, String verb) {}

    public List<GrantView> grantViews(String id) {
        var records = grants(id);
        return grantViews(identity.getCurrentUser().getDomainId(), records);
    }

    // The application catalogue authorizes these legacy use operations against the registered application.
    @Transactional
    public void changeApplicationUseGrant(String domainId, String id, ProductGrants.Grant grant, boolean remove) {
        lockResource(domainId, id);
        changeGrant(domainId, id, grant, remove);
    }

    public List<GrantView> applicationUseGrants(String domainId, String id) {
        var records = db.query("""
            SELECT principal_kind,principal_id,verb FROM product_grant
            WHERE domain_id=? AND resource_id=? AND verb='use' ORDER BY principal_kind,principal_id
            """, (row, index) -> new ProductGrants.Grant(row.getString(1), row.getString(2), row.getString(3)), domainId, id);
        return grantViews(domainId, records);
    }

    private List<GrantView> grantViews(String domainId, List<ProductGrants.Grant> records) {
        var names = grantNames(domainId, records);
        return records.stream().map(g -> new GrantView(
            g.principalKind(), g.principalId(), names.resolve(g), g.verb())).toList();
    }

    public record DomainGrantView(String resourceId, String principalKind, String principalId,
        @JsonInclude(JsonInclude.Include.NON_NULL) String principalName, String verb) {}

    private record ResourceGrant(String resourceId, ProductGrants.Grant grant) {}

    public List<DomainGrantView> domainGrants(String principalKind, String principalId) {
        String domain = identity.getCurrentUser().getDomainId();
        var sql = new StringBuilder("SELECT resource_id, principal_kind, principal_id, verb FROM product_grant WHERE domain_id=?");
        var parameters = new ArrayList<String>();
        parameters.add(domain);
        if (principalKind != null) {
            sql.append(" AND principal_kind=?");
            parameters.add(principalKind);
        }
        if (principalId != null) {
            sql.append(" AND principal_id=?");
            parameters.add(principalId);
        }
        sql.append(" ORDER BY resource_id, principal_kind, principal_id, verb");
        var records = db.query(sql.toString(), (row, index) -> new ResourceGrant(row.getString(1),
            new ProductGrants.Grant(row.getString(2), row.getString(3), row.getString(4))), parameters.toArray())
            .stream().filter(row -> !BuiltinProductIds.isReserved(row.resourceId())).toList();
        var names = grantNames(domain, records.stream().map(ResourceGrant::grant).toList());
        return records.stream().map(row -> {
            var grant = row.grant();
            return new DomainGrantView(row.resourceId(), grant.principalKind(), grant.principalId(), names.resolve(grant), grant.verb());
        }).toList();
    }

    private GrantNames grantNames(String domain, List<ProductGrants.Grant> records) {
        var userIds = records.stream().filter(g -> "principal".equals(g.principalKind())).map(ProductGrants.Grant::principalId).distinct().toList();
        var roleIds = records.stream().filter(g -> "role".equals(g.principalKind())).map(ProductGrants.Grant::principalId).distinct().toList();
        return new GrantNames(userIds.isEmpty() ? Map.of() : principals.principalNames(domain, userIds),
            roleIds.isEmpty() ? Map.of() : principals.roleNames(domain, roleIds));
    }

    private record GrantNames(Map<String, String> users, Map<String, String> roles) {
        String resolve(ProductGrants.Grant grant) {
            String name = switch (grant.principalKind()) {
                case "principal" -> users.get(grant.principalId());
                case "role" -> roles.get(grant.principalId());
                default -> null;
            };
            return name != null && !name.isBlank() ? name : null;
        }
    }

    public Map<String, String> principalNames(String domainId, Collection<String> principalIds) {
        if (domainId == null || principalIds == null || principalIds.isEmpty()) return Map.of();
        return principals.principalNames(domainId, principalIds);
    }

    public List<ProductPrincipalLookup.PrincipalOption> searchPrincipals(String kind, String keyword, int limit) {
        var user = identity.getCurrentUser();
        if (user == null || user.getDomainId() == null)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
        int capped = Math.max(1, Math.min(limit, 100));
        String term = keyword == null ? "" : keyword.strip();
        return switch (kind) {
            case "principal" -> principals.searchPrincipals(user.getDomainId(), term, capped);
            case "role" -> principals.searchRoles(user.getDomainId(), term, capped);
            default -> throw new IllegalArgumentException("Expected principal or role kind");
        };
    }
}
