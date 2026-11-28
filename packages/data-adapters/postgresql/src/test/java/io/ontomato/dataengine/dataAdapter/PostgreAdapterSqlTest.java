package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.util.DslUtil;
import java.lang.reflect.InvocationTargetException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PostgreAdapterSqlTest {
  private static JSONObject attr(String name, String type) {
    return JSONObject.of("name", name, "type", type, "enable", true);
  }

  private static JSONObject classDef(String name, String... attrs) {
    JSONArray values = new JSONArray();
    for (String attr : attrs) values.add(attr(attr, "varchar"));
    return JSONObject.of("className", name, "attrs", values);
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> classDefs() {
    return (List<Map<String, Object>>) (List<?>) JSONArray.of(
        classDef("person", "id", "account", "name", "main_dept", "status", "polity", "staff_type", "person_sort", "subject_first"),
        classDef("szxxsb", "id", "person_id", "xm_name", "hjdc", "hpsj", "sydw"),
        classDef("org", "id", "name", "up", "dept_sort_name", "dwjb_name"));
  }

  private static Map<String, Object> rule() {
    return JSONObject.of("classDef", classDefs(), "relationship_rule", JSONObject.of(
        "person_to_szxxsb", JSONObject.of("fromclass", "person", "toclass", "szxxsb", "fromField", "id", "toField", "person_id"),
        "person_to_org", JSONObject.of("fromclass", "person", "toclass", "org", "fromField", "main_dept", "toField", "id"),
        "org_to_org", JSONObject.of("fromclass", "org", "toclass", "org", "fromField", "up", "toField", "id")));
  }

  private static String sql(String dslJson) throws Exception {
    String normalized = DslUtil.normalizeClassNames("[" + dslJson + "]", classDefs());
    JSONObject dsl = JSONArray.parseArray(normalized).getJSONObject(0);
    PostgreAdapter adapter = new PostgreAdapter(new DataAdapterConnection(), rule());
    var method = PostgreAdapter.class.getDeclaredMethod("toSql", JSONObject.class, Map.class, DslRowLimit.Tracker.class);
    method.setAccessible(true);
    try {
      return (String) method.invoke(adapter, dsl, rule(), new DslRowLimit.Tracker());
    } catch (InvocationTargetException error) {
      if (error.getCause() instanceof Exception cause) throw cause;
      throw error;
    }
  }

  private static final String Q18 = """
      {"problem":"列出所有获得过国家级教育教学成果奖的教职工","answer":{"steps":[{"graph":{"patterns":[{"objects":[
      {"idx":0,"variable":"p","class":"/person","conditions":{"properties":{"field":"account","operator":"!=","value":"ZGZFDX"}}},
      {"idx":1,"variable":"r","class":"/szxxsb","conditions":{"properties":{"field":"xm_name","operator":"like","value":"国家级教育教学成果奖"}}}],
      "relationship":[{"from":0,"to":1,"type":["person_to_szxxsb"],"min_hops":1,"max_hops":1}]}],"pattern_logic":"and"},
      "output":{"to_user":true,"fields":[
      {"as":"姓名","variable":"p","field":"name"},{"as":"工号","variable":"p","field":"account"},
      {"as":"人事所在单位","variable":"p","field":"main_dept"},{"as":"人员状态","variable":"p","field":"status"},
      {"as":"项目名称","variable":"r","field":"xm_name"},{"as":"获奖等次","variable":"r","field":"hjdc"},
      {"as":"获批时间","variable":"r","field":"hpsj"},{"as":"授予单位","variable":"r","field":"sydw"}],
      "sort":{"fields":[{"variable":"p","field":"name","order":"asc"},{"variable":"r","field":"hpsj","order":"desc"}]},
      "limit":{"offset":0,"count":5000}}}]}}
      """;

  @Test
  void sortVariablesQualifyJoinedSourceColumns() throws Exception {
    String sql = sql(Q18);
    assertTrue(sql.contains("\"p\".\"name\""), sql);
    assertTrue(sql.contains("\"r\".\"hpsj\" desc"), sql);
    assertFalse(sql.contains("order by\n    \"name\""), sql);
  }

  @Test
  void sortWithoutVariableUsesTheOutputAlias() throws Exception {
    JSONObject dsl = JSONArray.parseArray("[" + Q18 + "]").getJSONObject(0);
    dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0).getJSONObject("output")
        .put("sort", JSONObject.of("fields", JSONArray.of(JSONObject.of("field", "姓名", "order", "asc"))));
    String sql = sql(dsl.toJSONString());
    assertTrue(sql.contains("order by\n    \"姓名\""), sql);
  }

  @Test
  void aggregateSortByAnUngroupedDetailFieldIsRejectedAtTheSortItem() {
    String q31 = """
        {"problem":"各组织单位在职教职工人数及单位结构","answer":{"steps":[{"graph":{"patterns":[{"objects":[
        {"idx":0,"variable":"o","class":"org"},{"idx":1,"variable":"p","class":"person","conditions":{"properties":{"field":"status","operator":"=","value":"在职"}}}],
        "relationship":[{"from":1,"to":0,"type":["person_to_org"],"min_hops":1,"max_hops":1}]}],"pattern_logic":"and"},
        "output":{"to_user":true,"fields":[
        {"as":"org_id","variable":"o","field":"id"},{"as":"org_name","variable":"o","field":"name"},
        {"as":"parent_name","variable":"o","field":"up"},{"as":"dept_sort","variable":"o","field":"dept_sort_name"},
        {"as":"dwjb","variable":"o","field":"dwjb_name"},{"as":"person_cnt","variable":"p","field":"id","function":"count"}],
        "group_by":{"fields":[{"variable":"o","field":"id"},{"variable":"o","field":"name"},{"variable":"o","field":"up"},
        {"variable":"o","field":"dept_sort_name"},{"variable":"o","field":"dwjb_name"}]},
        "sort":{"fields":[{"variable":"p","field":"id","order":"desc"}]},"limit":{"offset":0,"count":500}}}]}}
        """;
    DslContractViolationException error = assertThrows(DslContractViolationException.class, () -> sql(q31));
    assertTrue(error.getMessage().contains("answer.steps[0].output.sort.fields[0]"), error.getMessage());
    assertTrue(error.getMessage().contains("p.id"), error.getMessage());
  }

  private static final String Q5_CHAIN = """
      {"problem":"test","answer":{"steps":[
      {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"p","class":"person","conditions":{"properties":{"operator":"logic","and":[
      {"field":"status","operator":"=","value":"在职"}]}}}]}],"pattern_logic":"and"},
      "output":{"to_user":false,"save_table":"/t1","fields":[
      {"as":"person_id","variable":"p","field":"id"},{"as":"polity","variable":"p","field":"polity"}],
      "limit":{"offset":0,"count":20000}}},
      {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"t1","class":"/t1","conditions":{"properties":{"field":"polity","operator":"=","value":"中共党员"}}}]}],"pattern_logic":"and"},
      "output":{"to_user":true,"fields":[{"as":"party_cnt","variable":"t1","field":"person_id","function":"count"}]}}]}}
      """;

  @Test
  void secondStepTemporaryConditionsAndFirstStepLimitAreRendered() throws Exception {
    String sql = sql(Q5_CHAIN);
    assertTrue(sql.contains("limit 20000 offset 0"), sql);
    assertTrue(sql.contains("where\n    \"t1\".\"polity\" = '中共党员'"), sql);
  }

  @Test
  void firstStepGroupingOrderingAndLimitStayInsideTheChainInput() throws Exception {
    String chained = """
        {"problem":"分布","answer":{"steps":[
        {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"p","class":"person","conditions":{"properties":{"field":"subject_first","operator":"=","value":"马克思主义理论"}}}]}],"pattern_logic":"and"},
        "output":{"to_user":false,"save_table":"/tstaff","fields":[
        {"as":"staff_type","variable":"p","field":"staff_type"},{"as":"status","variable":"p","field":"status"},
        {"as":"person_sort","variable":"p","field":"person_sort"},{"as":"cnt","variable":"p","field":"id","function":"count"}],
        "group_by":{"fields":[{"variable":"p","field":"staff_type"},{"variable":"p","field":"status"},{"variable":"p","field":"person_sort"}]},
        "sort":{"fields":[{"field":"cnt","order":"desc"}]},"limit":{"offset":0,"count":100}}},
        {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"t","class":"/tstaff","conditions":{"properties":{"field":"cnt","operator":">","value":1}}}]}],"pattern_logic":"and"},
        "output":{"to_user":true,"fields":[{"as":"staff_type","variable":"t","field":"staff_type"},{"as":"cnt","variable":"t","field":"cnt"}],
        "sort":{"fields":[{"field":"cnt","order":"desc"}]},"limit":{"offset":0,"count":50}}}]}}
        """;
    String sql = sql(chained);
    assertTrue(sql.contains("group by\n    \"p\".\"staff_type\",\"p\".\"status\",\"p\".\"person_sort\""), sql);
    assertTrue(sql.contains("order by\n    \"cnt\" desc\nlimit 100 offset 0"), sql);
    assertTrue(sql.contains("\"t\".\"cnt\" > 1"), sql);
  }

  @Test
  void aThirdStepIsRejectedBeforeRendering() {
    String q23 = """
        {"problem":"学位层次与人员状态、人员分类的交叉分布","answer":{"steps":[
        {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"p","class":"/person"}]}]},
        "output":{"fields":[{"variable":"p","field":"id","as":"pid"},{"variable":"p","field":"status","as":"status"},
        {"variable":"p","field":"degree_level","as":"degree_level"},{"variable":"p","field":"staff_type","as":"staff_type"}],"to_user":false,"save_table":"/pe"}},
        {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"t","class":"/pe"}]}]},
        "output":{"fields":[{"variable":"t","field":"status","as":"status"},{"variable":"t","field":"degree_level","as":"degree_level"},
        {"variable":"t","field":"pid","as":"cnt","function":"count"}],"to_user":true,"limit":{"offset":0,"count":200},
        "group_by":{"fields":[{"variable":"t","field":"status"},{"variable":"t","field":"degree_level"}]}}},
        {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"u","class":"/pe"}]}]},
        "output":{"fields":[{"variable":"u","field":"staff_type","as":"staff_type"},{"variable":"u","field":"pid","as":"cnt","function":"count"}],
        "to_user":true,"limit":{"offset":0,"count":200},"group_by":{"fields":[{"variable":"u","field":"staff_type"}]}}}]}}
        """;
    DslContractViolationException error = assertThrows(DslContractViolationException.class, () -> sql(q23));
    assertTrue(error.getMessage().contains("answer.steps[2]"), error.getMessage());
    assertTrue(error.getMessage().contains("exactly two steps"), error.getMessage());
  }

  @Test
  void aSecondStepBaseTableIsRejectedBeforeRendering() {
    String q5BaseTable = """
        {"problem":"t","answer":{"steps":[
        {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"p1","class":"person","conditions":{"properties":{"operator":"logic","and":[{"field":"status","operator":"=","value":"在职"}]}}}]}],"pattern_logic":"and"},
        "output":{"to_user":false,"save_table":"/tAll","fields":[{"as":"person_id","variable":"p1","field":"id"}]}},
        {"graph":{"patterns":[{"objects":[{"idx":0,"variable":"p2","class":"person","conditions":{"properties":{"operator":"logic","and":[{"field":"status","operator":"=","value":"在职"},{"field":"polity","operator":"=","value":"中共党员"}]}}}]}],"pattern_logic":"and"},
        "output":{"to_user":true,"fields":[{"as":"pc","variable":"p2","field":"account","function":"count"}]}}]}}
        """;
    DslContractViolationException error = assertThrows(DslContractViolationException.class, () -> sql(q5BaseTable));
    assertTrue(error.getMessage().contains("answer.steps[1].graph.patterns[0].objects[0].class"), error.getMessage());
    assertTrue(error.getMessage().contains("/tAll"), error.getMessage());
  }

  @Test
  void multipleStepOutputsAreRejectedBeforeRendering() {
    JSONObject dsl = JSONArray.parseArray("[" + Q5_CHAIN + "]").getJSONObject(0);
    dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0).getJSONObject("output")
        .put("to_user", true);
    DslContractViolationException error = assertThrows(DslContractViolationException.class, () -> sql(dsl.toJSONString()));
    assertTrue(error.getMessage().contains("answer.steps[0].output.to_user"), error.getMessage());
    assertTrue(error.getMessage().contains("separate output"), error.getMessage());
  }

  @Test
  void anUnknownTemporaryConditionFieldIsRejectedBeforeRendering() {
    JSONObject dsl = JSONArray.parseArray("[" + Q5_CHAIN + "]").getJSONObject(0);
    dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(1).getJSONObject("graph")
        .getJSONArray("patterns").getJSONObject(0).getJSONArray("objects").getJSONObject(0)
        .getJSONObject("conditions").getJSONObject("properties").put("field", "not_exported");
    DslContractViolationException error = assertThrows(DslContractViolationException.class, () -> sql(dsl.toJSONString()));
    assertTrue(error.getMessage().contains("not_exported"), error.getMessage());
    assertTrue(error.getMessage().contains("person_id"), error.getMessage());
  }

}
