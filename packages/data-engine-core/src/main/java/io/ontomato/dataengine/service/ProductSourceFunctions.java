package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Product Functions name immutable browser artifacts; Python capability execution never accepts them. */
@Service
@DependsOn("functionDao")
public class ProductSourceFunctions {
    private final JdbcTemplate db;
    public ProductSourceFunctions(JdbcTemplate db){this.db=db;}
    public record Dependency(String kind,String id,String hash) {}
    public record File(String path,String hash) {}
    public record Artifact(String applicationId,String releaseId,String name,List<Dependency> dependencies,List<File> files,List<String> sdkVersions,int messageBridge) {}
    public static String identity(String domain,String application,String release){
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(("product-function\0"+domain+"\0"+application+"\0"+release).getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException failure){throw new IllegalStateException(failure);}
    }
    public static void validate(Artifact artifact){
        if(artifact==null||artifact.applicationId()==null||!artifact.applicationId().matches("app-[a-z0-9-]+")||artifact.releaseId()==null||!artifact.releaseId().matches("[a-f0-9-]{36}")||artifact.name()==null||artifact.name().isBlank()||artifact.dependencies()==null||artifact.dependencies().size()>1000||artifact.files()==null||artifact.files().size()>10000||artifact.sdkVersions()==null||artifact.sdkVersions().isEmpty()||artifact.sdkVersions().size()>20||artifact.messageBridge()!=2)throw new IllegalArgumentException("Invalid product Function artifact");
        for(var dependency:artifact.dependencies())if(!List.of("metric","action","definition","object-type","trigger").contains(dependency.kind())||dependency.id()==null||dependency.id().isBlank()||dependency.hash()==null||!dependency.hash().matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid governed Function dependency");
        for(var file:artifact.files())if(file.path()==null||file.path().isBlank()||file.path().startsWith("/")||file.path().contains("\\")||List.of(file.path().split("/")).contains("..")||file.hash()==null||!file.hash().matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid product Function file");
        if(artifact.files().stream().map(File::path).distinct().count()!=artifact.files().size())throw new IllegalArgumentException("Duplicate product Function file");
        if(artifact.dependencies().stream().map(dependency->dependency.kind()+":"+dependency.id()).distinct().count()!=artifact.dependencies().size())throw new IllegalArgumentException("Duplicate product Function dependency");
        for(String version:artifact.sdkVersions())if(version==null||!version.matches("[A-Za-z0-9._-]{1,200}"))throw new IllegalArgumentException("Invalid product Function SDK version");
    }
    @Transactional public String register(String domain,Artifact artifact){
        validate(artifact);if(domain==null||domain.isBlank())throw new IllegalArgumentException("Domain required");
        String id=identity(domain,artifact.applicationId(),artifact.releaseId());
        db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,"product-function:"+id);
        var existing=db.queryForList("SELECT source_artifact::text FROM function WHERE id=? AND domain_id=?",String.class,id,domain);
        JSONObject source=JSONObject.from(artifact);
        if(!existing.isEmpty()){if(!JSON.parseObject(existing.getFirst()).equals(JSON.parseObject(source.toJSONString())))throw new IllegalArgumentException("Published product Function artifacts are immutable");return id;}
        long now=System.currentTimeMillis();
        db.update("INSERT INTO function(id,name,origin,operation,parameters,code,domain_id,source_artifact,create_timestamp,modify_timestamp) VALUES(?,?,'USER','OPERATION_PRODUCT','[]',NULL,?,?::jsonb,?,?)",id,artifact.name(),domain,source.toJSONString(),now,now);
        return id;
    }
}
