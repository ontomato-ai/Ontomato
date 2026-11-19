package io.ontomato.dataengine.service;

import java.util.List;
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
        CREATE TABLE IF NOT EXISTS product_resource(domain_id text NOT NULL,id text NOT NULL,owner_id text NOT NULL,PRIMARY KEY(domain_id,id));
        CREATE TABLE IF NOT EXISTS product_grant(domain_id text NOT NULL,resource_id text NOT NULL,principal_kind text NOT NULL,principal_id text NOT NULL,verb text NOT NULL,PRIMARY KEY(domain_id,resource_id,principal_kind,principal_id,verb));
        CREATE INDEX IF NOT EXISTS product_grant_principal ON product_grant(domain_id,principal_kind,principal_id,verb);
        CREATE TABLE IF NOT EXISTS product_application_grant_migration(domain_id text NOT NULL,id text NOT NULL,PRIMARY KEY(domain_id,id));
        """);}
    public boolean allowed(String id,String verb){
        var user=identity.getCurrentUser();if(user==null||user.getDomainId()==null)return false;
        return allowedFor(user.getDomainId(),user.getId(),id,verb);
    }
    public boolean allowedFor(String domainId,String userId,String id,String verb){
        if(domainId==null||userId==null)return false;
        userId=principals.productPrincipalId(userId);
        var grants=db.query("SELECT principal_kind,principal_id,verb FROM product_grant WHERE domain_id=? AND resource_id=?",(row,index)->new ProductGrants.Grant(row.getString(1),row.getString(2),row.getString(3)),domainId,id);
        return ProductGrants.allows(grants,userId,principals.effectiveRoles(userId,domainId),verb);
    }
    @Transactional public void migrateApplication(String domainId,String id){
        lockResource(domainId,id);
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM product_application_grant_migration WHERE domain_id=? AND id=?)",Boolean.class,domainId,id)))return;
        var authors=db.queryForList("SELECT owner_user_id FROM sys_application WHERE domain_id=? AND id=? AND owner_user_id IS NOT NULL",String.class,domainId,id);
        if(authors.isEmpty())return;
        db.update("INSERT INTO product_resource(domain_id,id,owner_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",domainId,id,authors.getFirst());
        for(var grant:principals.legacyApplicationGrants(domainId,id))insert(domainId,id,grant);
        db.update("INSERT INTO product_application_grant_migration(domain_id,id) VALUES(?,?)",domainId,id);
    }
    public List<String> resources(String verb){
        var user=identity.getCurrentUser();if(user==null||user.getDomainId()==null)return List.of();
        return resourcesFor(user.getDomainId(),user.getId(),verb);
    }
    public List<String> resourcesFor(String domainId,String userId,String verb){
        if(domainId==null||userId==null)throw new IllegalArgumentException("Product subject is required");
        String principalId=principals.productPrincipalId(userId);
        if(!List.of("use","edit").contains(verb))throw new IllegalArgumentException("Invalid product permission");
        var roles=principals.effectiveRoles(userId,domainId);
        var rows=db.queryForList("SELECT resource_id,principal_kind,principal_id FROM product_grant WHERE domain_id=? AND verb=?",domainId,verb);
        return rows.stream().filter(row->ProductGrants.allows(List.of(new ProductGrants.Grant((String)row.get("principal_kind"),(String)row.get("principal_id"),verb)),principalId,roles,verb)).map(row->(String)row.get("resource_id")).distinct().sorted().toList();
    }
    /** The owning product service imports author and sharing facts; request bodies cannot select the acting user. */
    @Transactional public void register(String domainId,String id,String ownerId,boolean shared){
        if(domainId==null||domainId.isBlank()||id==null||id.isBlank()||ownerId==null||ownerId.isBlank())throw new IllegalArgumentException("Product identity is required");
        lockResource(domainId,id);
        var owners=db.queryForList("SELECT owner_id FROM product_resource WHERE domain_id=? AND id=?",String.class,domainId,id);
        if(!owners.isEmpty()&&!owners.getFirst().equals(ownerId))throw new ResponseStatusException(HttpStatus.CONFLICT,"Product owner changed");
        db.update("INSERT INTO product_resource(domain_id,id,owner_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",domainId,id,ownerId);
        if(owners.isEmpty())for(String verb:List.of("use","edit"))insert(domainId,id,new ProductGrants.Grant("principal",ownerId,verb));
        if(owners.isEmpty()&&shared)insert(domainId,id,new ProductGrants.Grant("domain","*","use"));
    }
    @Transactional public void unregister(String domainId, String id) {
        lockResource(domainId, id);
        db.update("DELETE FROM product_grant WHERE domain_id=? AND resource_id=?", domainId, id);
        db.update("DELETE FROM product_resource WHERE domain_id=? AND id=?", domainId, id);
    }

    private void lockResource(String domainId, String id) {
        db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", Object.class, "product-grant:" + domainId + ":" + id);
    }

    private void insert(String domain,String id,ProductGrants.Grant grant){db.update("INSERT INTO product_grant(domain_id,resource_id,principal_kind,principal_id,verb) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",domain,id,grant.principalKind(),grant.principalId(),grant.verb());}
    @Transactional public void grant(String id,ProductGrants.Grant grant,boolean remove){
        var current=identity.getCurrentUser();
        if(current!=null)lockResource(current.getDomainId(),id);
        if(!allowed(id,"edit"))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Product edit Grant required");
        if(!List.of("use","edit").contains(grant.verb())||!List.of("principal","role").contains(grant.principalKind())||grant.principalId()==null||grant.principalId().isBlank())throw new IllegalArgumentException("Invalid product Grant");
        String domain=identity.getCurrentUser().getDomainId();
        if(remove)db.update("DELETE FROM product_grant WHERE domain_id=? AND resource_id=? AND principal_kind=? AND principal_id=? AND verb=?",domain,id,grant.principalKind(),grant.principalId(),grant.verb());
        else insert(domain,id,grant);
    }
    @Transactional public void share(String id,boolean shared){
        var current=identity.getCurrentUser();
        if(current!=null)lockResource(current.getDomainId(),id);
        if(!allowed(id,"edit"))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Product edit Grant required");
        String domain=identity.getCurrentUser().getDomainId();
        db.update("DELETE FROM product_grant WHERE domain_id=? AND resource_id=? AND principal_kind='domain'",domain,id);
        if(shared)insert(domain,id,new ProductGrants.Grant("domain","*","use"));
    }
    public List<ProductGrants.Grant> grants(String id){
        if(!allowed(id,"edit"))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Product edit Grant required");
        return db.query("SELECT principal_kind,principal_id,verb FROM product_grant WHERE domain_id=? AND resource_id=? ORDER BY principal_kind,principal_id,verb",(row,index)->new ProductGrants.Grant(row.getString(1),row.getString(2),row.getString(3)),identity.getCurrentUser().getDomainId(),id);
    }
}
