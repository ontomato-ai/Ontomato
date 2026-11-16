package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.core.bean.User;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.DependsOn;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Governance owns service subjects; product Profiles never supply role assignments. */
@Service
@DependsOn("jdbcInitDb")
public class AgentPrincipalService implements InitializingBean {
    public static final String ATTRIBUTE=AgentPrincipalService.class.getName();
    private final JdbcTemplate db;
    private final String signingKey;
    public AgentPrincipalService(JdbcTemplate db,@Value("${ONTOMATO_QUERY_SIGNING_KEY:}") String signingKey){this.db=db;this.signingKey=signingKey;}
    @Override public void afterPropertiesSet(){db.execute("""
        CREATE TABLE IF NOT EXISTS agent_principal(domain_id text NOT NULL,id text NOT NULL,name text NOT NULL,enabled boolean NOT NULL DEFAULT true,revision bigint NOT NULL DEFAULT 1,PRIMARY KEY(domain_id,id));
        CREATE TABLE IF NOT EXISTS agent_principal_role(domain_id text NOT NULL,principal_id text NOT NULL,role_id text NOT NULL,PRIMARY KEY(domain_id,principal_id,role_id),FOREIGN KEY(domain_id,principal_id) REFERENCES agent_principal(domain_id,id) ON DELETE CASCADE);
        """);}
    public record Principal(String id,String domainId,String userName,long revision) implements User {
        public String getId(){return id;}
        public String getDomainId(){return domainId;}
        public String getUserName(){return userName;}
        public String getLoginCode(){return id;}
        public boolean isEnable(){return true;}
    }
    public record Execution(Principal principal,long expiresAt) {}
    public Principal find(String domain,String id){
        var rows=db.query("SELECT name,revision FROM agent_principal WHERE domain_id=? AND id=? AND enabled=true",(row,index)->new Principal(id,domain,row.getString(1),row.getLong(2)),domain,id);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public boolean exists(String domain,String id){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM agent_principal WHERE domain_id=? AND id=?)",Boolean.class,domain,id));}
    public void lockIdentity(String id){db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,"agent-principal:"+id);}
    public record Registration(String id,String name,boolean enabled,List<String> roleIds) {}
    public List<Registration> list(String domain){
        var assignments=new java.util.LinkedHashMap<String,List<String>>();
        db.query("SELECT principal_id,role_id FROM agent_principal_role WHERE domain_id=? ORDER BY role_id",row->{assignments.computeIfAbsent(row.getString(1),ignored->new java.util.ArrayList<>()).add(row.getString(2));},domain);
        return db.query("SELECT id,name,enabled FROM agent_principal WHERE domain_id=? ORDER BY name,id",(row,index)->new Registration(row.getString(1),row.getString(2),row.getBoolean(3),assignments.getOrDefault(row.getString(1),List.of())),domain);
    }
    @org.springframework.transaction.annotation.Transactional
    public void save(String domain,String id,String name,boolean enabled,List<String> roles){
        if(domain==null||domain.isBlank()||id==null||!id.matches("[a-zA-Z0-9][a-zA-Z0-9:_-]{0,199}")||name==null||name.isBlank()||name.length()>200||roles==null)throw new IllegalArgumentException("Invalid agent principal");
        lockIdentity(id);
        db.update("INSERT INTO agent_principal(domain_id,id,name,enabled) VALUES(?,?,?,?) ON CONFLICT(domain_id,id) DO UPDATE SET name=EXCLUDED.name,enabled=EXCLUDED.enabled,revision=agent_principal.revision+1",domain,id,name,enabled);
        db.update("DELETE FROM agent_principal_role WHERE domain_id=? AND principal_id=?",domain,id);
        for(String role:new java.util.LinkedHashSet<>(roles))db.update("INSERT INTO agent_principal_role(domain_id,principal_id,role_id) VALUES(?,?,?)",domain,id,role);
    }
    public List<String> roles(String domain,String id){
        if(find(domain,id)==null)return List.of();
        return db.queryForList("SELECT role_id FROM agent_principal_role WHERE domain_id=? AND principal_id=? ORDER BY role_id",String.class,domain,id);
    }
    public String issue(String domain,String id,long expiresAt){
        var principal=find(domain,id);
        if(principal==null||roles(domain,id).isEmpty())throw denied("Agent principal has no active role assignment");
        if(expiresAt<=System.currentTimeMillis()||expiresAt>System.currentTimeMillis()+300_000)throw new IllegalArgumentException("Agent execution expiry must be within five minutes");
        String body=Base64.getUrlEncoder().withoutPadding().encodeToString(JSON.toJSONBytes(Map.of("domainId",domain,"id",id,"revision",principal.revision(),"expiresAt",expiresAt)));
        return "ap1."+body+"."+sign(body);
    }
    private String sign(String body){
        if(signingKey.isBlank())throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Agent execution signing key is not configured");
        try{var mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(signingKey.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(("agent-principal-v1\0"+body).getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.GeneralSecurityException failure){throw new IllegalStateException(failure);}
    }
    public Execution verify(String token){
        try{
            var parts=token.split("\\.");
            if(parts.length!=3||!"ap1".equals(parts[0])||!MessageDigest.isEqual(sign(parts[1]).getBytes(StandardCharsets.UTF_8),parts[2].getBytes(StandardCharsets.UTF_8)))throw denied("Invalid agent execution credential");
            var claims=JSON.parseObject(Base64.getUrlDecoder().decode(parts[1]));
            var principal=find(claims.getString("domainId"),claims.getString("id"));
            long expiry=claims.getLongValue("expiresAt");
            if(principal==null||principal.revision()!=claims.getLongValue("revision")||expiry<=System.currentTimeMillis()||roles(principal.domainId(),principal.id()).isEmpty())throw denied("Agent execution expired or revoked");
            return new Execution(principal,expiry);
        }catch(ResponseStatusException failure){throw failure;}catch(Exception failure){throw denied("Invalid agent execution credential");}
    }
    public static Execution current(){
        var attributes=org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        return attributes instanceof org.springframework.web.context.request.ServletRequestAttributes servlet?(Execution)servlet.getRequest().getAttribute(ATTRIBUTE):null;
    }
    public static boolean execution(HttpServletRequest request){return request.getAttribute(ATTRIBUTE) instanceof Execution;}
    public static ResponseStatusException denied(String message){return new ResponseStatusException(HttpStatus.FORBIDDEN,message);}
}
