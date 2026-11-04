package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.Map;
import org.junit.jupiter.api.Test;

class OntologyQueryNormalizationTest {
  @Test
  void mvcBoundJoinPassesRelationshipChecks() throws Exception {
    // Spring MVC binds request bodies with Jackson, so nested objects arrive as LinkedHashMap.
    var bound = new ObjectMapper().readValue("""
        {"answer":{"steps":[{"graph":{"patterns":[{"objects":[
          {"idx":0,"variable":"p","class":"/person"},{"idx":1,"variable":"d","class":"/duty"}],
          "relationship":[{"from":0,"to":1,"type":["*"],"min_hops":1,"max_hops":1}]}]},
          "output":{"to_user":true,"fields":[{"as":"pid","variable":"p","field":"id"}]}}]}}
        """, JSONObject.class);
    var permission = new UserDataPermission();
    var full = UserDataPermission.class.getDeclaredField("fullData");
    full.setAccessible(true);
    full.set(permission, true);
    Map<String, Object> rule = JSONObject.parseObject("""
        {"relationship_rule":{"person_to_duty":{"fromclass":"person","toclass":"duty"}}}
        """);

    var query = OntologyQueryService.normalized(bound);
    QueryPermissions.restrictRelations(query, rule, permission);

    var relation = query.getJSONObject("answer").getJSONArray("steps").getJSONObject(0)
        .getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
        .getJSONArray("relationship").getJSONObject(0);
    assertEquals(java.util.List.of("person_to_duty"), relation.getList("type", String.class));
  }
}
