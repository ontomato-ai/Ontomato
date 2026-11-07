package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import org.junit.jupiter.api.Test;

class MetricExecutionSourceTest {
  @Test void preservesNullableQueryIdentityWhenCopyingExecutionDefinition() {
    var function = new Function();
    var returns = new ReturnDef();
    var graph = JSONObject.parseObject("""
        {"schema":"ontomato.query-subgraph.v1","queries":[],"nodes":[
          {"id":"constant","kind":"operation","queryId":null,"operation":"constant","expression":"1","label":"Constant"},
          {"id":"output","kind":"output","key":"value","label":"Value"}],
          "edges":[{"id":"edge","kind":"dependency","source":"constant","target":"output","role":"value","label":""}],"filters":[]}
        """);
    returns.setSourceAnalysis(graph);
    function.setReturnDef(returns);
    var execution = MetricViewBindings.executionFunction(function, new JSONObject());
    var copied = execution.getReturnDef().getSourceAnalysis();
    assertTrue(copied.getJSONArray("nodes").getJSONObject(0).containsKey("queryId"));
    assertDoesNotThrow(() -> QuerySubgraphContract.validate(copied));
    assertNotSame(graph, copied);
  }
}
