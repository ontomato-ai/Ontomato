package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.QueryPackage;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class QueryIntentTest {
  @Test void bindingsResolveUnknownsWithoutChangingTheFrozenIntent() {
    var original=intent();var mapping=original.getJSONArray("conditions").getJSONObject(0).getJSONObject("mapping");
    original.getJSONArray("conditions").getJSONObject(0).put("mapping",null);
    var resolved=QueryIntent.bind(original,JSONObject.of("age",mapping));
    assertNotNull(resolved.getJSONArray("conditions").getJSONObject(0).get("mapping"));
    assertNull(original.getJSONArray("conditions").getJSONObject(0).get("mapping"));
    assertThrows(AgentHttpException.class,()->QueryIntent.bind(original,JSONObject.of("unknown",mapping)));
    assertThrows(AgentHttpException.class,()->QueryIntent.bind(intent(),JSONObject.of("age",JSONObject.of("className","/person","field","age","operator","<","value",50))));
  }
  @Test void unfilteredQuestionsCanKeepAnEmptyConditionList() {
    assertNotNull(QueryIntent.accept(JSONObject.of("schema","ontomato.query-intent.v1",
        "conditions",new JSONArray(),"outputs",JSONArray.of("Total count")),"Count all people"));
  }
  JSONObject intent() {
    return QueryIntent.accept(JSONObject.of("schema","ontomato.query-intent.v1",
        "conditions",JSONArray.of(JSONObject.of("id","age","quote","under 45","mapping",
            JSONObject.of("className","/person","field","age","operator","<","value",45))),
        "outputs",JSONArray.of("Count")),"People under 45");
  }
  JSONObject recipe(JSONObject predicate) {
    return JSONObject.of("kind","package","parameters",new JSONObject(),"package",QueryPackage.fromDsl(
        JSONObject.of("answer",JSONObject.of("steps",JSONArray.of(JSONObject.of(
            "graph",JSONObject.of("patterns",JSONArray.of(JSONObject.of("objects",JSONArray.of(
                JSONObject.of("class","/person","conditions",JSONObject.of("properties",predicate)))))))))).toJSONString()));
  }
  @Test void omittedAndChangedConditionsCannotPass() {
    var correct=recipe(JSONObject.of("field","age","operator","<","value",45));
    assertEquals("present",QueryIntent.coverage(intent(),correct,null).getJSONArray("conditions").getJSONObject(0).getString("status"));
    var missing=recipe(JSONObject.of("field","status","operator","=","value","active"));
    assertEquals("missing",QueryIntent.coverage(intent(),missing,null).getJSONArray("conditions").getJSONObject(0).getString("status"));
    var changed=recipe(JSONObject.of("field","age","operator","<","value",50));
    assertEquals("unverified",QueryIntent.coverage(intent(),changed,null).getJSONArray("conditions").getJSONObject(0).getString("status"));
    assertEquals("unverified",QueryIntent.coverage(intent(),correct,null).getString("status"));
    assertEquals("partial",QueryIntent.coverage(intent(),correct,JSONObject.of("truncated",true)).getString("status"));
  }
  @Test void orBranchAndUnknownMappingsAreNotVerified() {
    var unsafe=recipe(JSONObject.of("operator","logic","or",JSONArray.of(
        JSONObject.of("field","age","operator","<","value",45),
        JSONObject.of("field","name","operator","=","value","Anyone"))));
    assertEquals("unverified",QueryIntent.coverage(intent(),unsafe,null).getJSONArray("conditions").getJSONObject(0).getString("status"));
    var unknown=intent();unknown.getJSONArray("conditions").getJSONObject(0).put("mapping",null);
    assertEquals("unmapped",QueryIntent.coverage(unknown,unsafe,null).getJSONArray("conditions").getJSONObject(0).getString("status"));
  }
  @Test void merelyOutputtingARequiredFieldDoesNotImplementTheFilter() {
    var outputOnly=recipe(new JSONObject());
    var bundle=outputOnly.getJSONObject("package");
    var dsl=QueryPackage.query(bundle,"main");
    dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0).put("output",
        JSONObject.of("fields",JSONArray.of(JSONObject.of("field","age","variable","p"))));
    outputOnly.put("package",QueryPackage.fromDsl(dsl.toJSONString()));
    assertEquals("missing",QueryIntent.coverage(intent(),outputOnly,null).getJSONArray("conditions").getJSONObject(0).getString("status"));
  }
  @Test void boundaryAcceptsJacksonMapsAndRejectsInventedQuotes() throws Exception {
    var mapper=new com.fasterxml.jackson.databind.ObjectMapper();
    var decoded=mapper.readValue(intent().toJSONString(),java.util.Map.class);
    assertNotNull(QueryIntent.accept(new JSONObject(decoded),"People under 45"));
    var changed=intent();changed.getJSONArray("conditions").getJSONObject(0).put("quote","over 60");
    assertThrows(AgentHttpException.class,() -> QueryIntent.accept(changed,"People under 45"));
  }
  @Test void retrievalInputRetainsIntentAndRejectsMalformedMappings() throws Exception {
    var mapper=new com.fasterxml.jackson.databind.ObjectMapper();
    var body=new JSONObject(mapper.readValue(JSONObject.of("question","People under 45","queryIntent",intent()).toJSONString(),java.util.Map.class));
    var accepted=OntologyRetrievalService.input(body);
    assertEquals(intent(),accepted.getJSONObject("queryIntent"));
    body.getJSONObject("queryIntent").getJSONArray("conditions").getJSONObject(0).put("mapping", "age < 45");
    assertThrows(AgentHttpException.class,() -> OntologyRetrievalService.input(body));
  }
  @Test void parameterValuesAreCheckedAfterBinding() {
    var bundle=QueryPackage.fromDsl(JSONObject.of("answer",JSONObject.of("steps",JSONArray.of(JSONObject.of(
        "graph",JSONObject.of("patterns",JSONArray.of(JSONObject.of("objects",JSONArray.of(JSONObject.of("class","/person",
            "conditions",JSONObject.of("properties",JSONObject.of("field","age","operator","<","value",0))))))))))).toJSONString());
    var manifest=bundle.getJSONObject("manifest");
    manifest.put("parameterDefs",JSONArray.of(JSONObject.of("name","maximum","type",io.ontomato.dataengine.bean.function.Parameter.TYPE_NUMBER,"value",45,"description","Age threshold")));
    manifest.put("parameterBindings",JSONArray.of(JSONObject.of("query","main","pointer","/answer/steps/0/graph/patterns/0/objects/0/conditions/properties/value","parameter","maximum")));
    var recipe=JSONObject.of("kind","package","package",bundle,"parameters",JSONObject.of("maximum",45));
    assertEquals("present",QueryIntent.coverage(intent(),recipe,null).getJSONArray("conditions").getJSONObject(0).getString("status"));
  }
}
