package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.alibaba.fastjson2.JSONObject;
import java.util.List;
import org.junit.jupiter.api.Test;

class OntologyOverviewRelationshipsTest {
  @Test
  void overviewListsOnlyRelationshipsBetweenVisibleClasses() {
    var rule = JSONObject.parseObject("""
        {"relationship_rule":{
          "person_to_org":{"fromclass":"person","toclass":"org","desc":"belongs to"},
          "person_to_salary":{"fromclass":"person","toclass":"salary","desc":"paid"}}}
        """);
    List<Object> visible = List.of(JSONObject.of("name", "person"), JSONObject.of("name", "org"));

    var relationships = OntologyQueryService.overviewRelationships(rule, visible);

    assertEquals(List.of(JSONObject.of("name", "person_to_org", "from", "person", "to", "org",
        "description", "belongs to")), relationships);
  }
}
