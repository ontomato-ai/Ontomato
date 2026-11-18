package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Ontology registration contains projection and bundle identities, never Page composition documents. */
@Service
@DependsOn("jdbcInitDb")
public class ProductOntologyService implements InitializingBean {
    private final JdbcTemplate db;
    private final ProductGrantService grants;
    public ProductOntologyService(JdbcTemplate db,ProductGrantService grants){this.db=db;this.grants=grants;}
    @Override public void afterPropertiesSet(){db.execute("""
        CREATE TABLE IF NOT EXISTS ontology_product_node(domain_id text NOT NULL,id text NOT NULL,kind text NOT NULL,name text NOT NULL,revision bigint NOT NULL,PRIMARY KEY(domain_id,id));
        CREATE TABLE IF NOT EXISTS ontology_product_edge(domain_id text NOT NULL,source_id text NOT NULL,relation text NOT NULL,target_kind text NOT NULL,target_id text NOT NULL,is_default boolean NOT NULL DEFAULT false,PRIMARY KEY(domain_id,source_id,relation),FOREIGN KEY(domain_id,source_id) REFERENCES ontology_product_node(domain_id,id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS ontology_product_target ON ontology_product_edge(domain_id,target_kind,target_id);
        CREATE TABLE IF NOT EXISTS ontology_product_tombstone(domain_id text NOT NULL,id text NOT NULL,revision bigint NOT NULL,PRIMARY KEY(domain_id,id));
        """);}
    public record Registration(String id,String kind,String name,long revision,String targetKind,String targetId,boolean isDefault) {}
    static void validate(Registration value){
        var targets=Map.of("object-projection","ObjectType","collection-view","Definition","metric-widget","MetricView","action-view","Action","agent-profile","AgentDefinition");
        if(value==null||value.id()==null||value.id().isBlank()||value.id().length()>200||value.kind()==null||value.name()==null||value.name().isBlank()||value.name().length()>200||value.revision()<1)throw new IllegalArgumentException("Invalid ontology product identity");
        String target=targets.get(value.kind());
        if(target==null&&!"application".equals(value.kind()))throw new IllegalArgumentException("Composition assets do not enter the ontology graph");
        if(target!=null&&(!target.equals(value.targetKind())||value.targetId()==null||value.targetId().isBlank()))throw new IllegalArgumentException("Projection target kind and identity are required");
        if(target==null&&(value.targetKind()!=null||value.targetId()!=null))throw new IllegalArgumentException("Application roots have no renders edge");
    }
    @Transactional public void register(String domain,List<Registration> registrations){
        if(domain==null||domain.isBlank())throw new IllegalArgumentException("Domain required");
        for(var value:registrations){
            validate(value);
            db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,"ontology-product:"+domain+":"+value.id());
            var removed=db.queryForList("SELECT revision FROM ontology_product_tombstone WHERE domain_id=? AND id=?",Long.class,domain,value.id());
            if(!removed.isEmpty()&&removed.getFirst()>=value.revision())continue;
            var current=db.queryForList("SELECT revision FROM ontology_product_node WHERE domain_id=? AND id=?",Long.class,domain,value.id());
            if(!current.isEmpty()&&current.getFirst()>value.revision())continue;
            db.update("INSERT INTO ontology_product_node(domain_id,id,kind,name,revision) VALUES(?,?,?,?,?) ON CONFLICT(domain_id,id) DO UPDATE SET kind=EXCLUDED.kind,name=EXCLUDED.name,revision=EXCLUDED.revision",domain,value.id(),value.kind(),value.name(),value.revision());
            db.update("DELETE FROM ontology_product_edge WHERE domain_id=? AND source_id=?",domain,value.id());
            if(value.targetId()!=null)db.update("INSERT INTO ontology_product_edge(domain_id,source_id,relation,target_kind,target_id,is_default) VALUES(?,?,?,?,?,?)",domain,value.id(),"agent-profile".equals(value.kind())?"embodies":"renders",value.targetKind(),value.targetId(),value.isDefault());
        }
    }
    @Transactional public void remove(String domain,String id,long revision){
        if(domain==null||domain.isBlank()||id==null||id.isBlank()||revision<1)throw new IllegalArgumentException("Removal domain, identity and revision required");
        db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,"ontology-product:"+domain+":"+id);
        var current=db.queryForList("SELECT revision FROM ontology_product_node WHERE domain_id=? AND id=?",Long.class,domain,id);
        if(!current.isEmpty()&&current.getFirst()>revision)return;
        db.update("INSERT INTO ontology_product_tombstone(domain_id,id,revision) VALUES(?,?,?) ON CONFLICT(domain_id,id) DO UPDATE SET revision=GREATEST(ontology_product_tombstone.revision,EXCLUDED.revision)",domain,id,revision);
        db.update("DELETE FROM ontology_product_node WHERE domain_id=? AND id=? AND revision<=?",domain,id,revision);
    }
    public Object graph(String domain,String user){
        if(domain==null||domain.isBlank()||user==null||user.isBlank())throw new IllegalArgumentException("Current domain and subject required");
        var visible=new java.util.LinkedHashSet<>(grants.resourcesFor(domain,user,"use"));visible.addAll(grants.resourcesFor(domain,user,"edit"));
        if(visible.isEmpty())return Map.of("nodes",List.of(),"edges",List.of());
        String placeholders=String.join(",",java.util.Collections.nCopies(visible.size(),"?"));
        var parameters=new java.util.ArrayList<Object>();parameters.add(domain);parameters.addAll(visible);
        var nodes=db.queryForList("SELECT id,kind,name,revision FROM ontology_product_node WHERE domain_id=? AND id IN ("+placeholders+")",parameters.toArray());
        var edges=db.queryForList("SELECT source_id AS source,relation,target_kind,target_id,is_default FROM ontology_product_edge WHERE domain_id=? AND source_id IN ("+placeholders+")",parameters.toArray());
        return Map.of("nodes",nodes,"edges",edges);
    }
}
