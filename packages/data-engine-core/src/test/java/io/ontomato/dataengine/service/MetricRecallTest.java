package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Recall decides what the assistant may run: published metrics, readable classes, an absolute cutoff and a cap. */
class MetricRecallTest {
  final MetricViewService metrics = mock(MetricViewService.class);
  final AdminService admin = mock(AdminService.class);
  final Map<String, MetricView> published = new LinkedHashMap<>();
  final QueryAccessService.GrantUser user = new QueryAccessService.GrantUser("reader", "domain-a");
  final QueryAccessService.Access access = new QueryAccessService.Access(user, permission("org", "person"),
      null, null, null, List.of(), null, null, null);
  final OntologyQueryService ontology = new OntologyQueryService(admin, mock(DslService.class), metrics, null);

  static UserDataPermission permission(String... classes) {
    var permission = new UserDataPermission();
    for (String name : classes) {
      var fields = new FieldPermission(name);
      fields.getVisibleFields().add("id");
      permission.addFieldPermission(fields);
    }
    return permission;
  }

  @BeforeEach
  void setup() {
    when(admin.getJSONRule(anyString())).thenReturn(Map.of("classDef", List.of(
        JSONObject.of("className", "org", "attrs", List.of(JSONObject.of("name", "id", "enable", true))),
        JSONObject.of("className", "person", "attrs", List.of(JSONObject.of("name", "id", "enable", true))),
        JSONObject.of("className", "expense", "attrs", List.of(JSONObject.of("name", "id", "enable", true))))));
    when(metrics.queryById(anyString(), anyString())).thenAnswer(call -> published.get(call.getArgument(0)));
  }

  private MetricView metric(String id, String... classes) {
    var function = new Function();
    function.setId(UUID.randomUUID().toString());
    function.setOperation(Function.OPERATION_READ);
    function.setLogic("count objects");
    var parameter = new Parameter();
    parameter.setName("threshold");
    parameter.setType(Parameter.TYPE_NUMBER);
    parameter.setValue(35);
    function.setParameters(List.of(parameter));
    var returns = new io.ontomato.dataengine.bean.function.ReturnDef();
    returns.setClassNames(List.of(classes));
    var ref = new io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef();
    ref.setKey("value");
    ref.setClassName(classes[0]);
    ref.setAttrName("id");
    ref.setAsGroupBy(false);
    ref.setStatCal(false);
    returns.setOutKeyRefs(List.of(ref));
    returns.setSourceAnalysis(QuerySourceAnalysis.fromStoredSources(List.of(ref)));
    function.setReturnDef(returns);
    var metric = new MetricView();
    metric.setId(id);
    metric.setName("Name " + id);
    metric.setDescription("Description " + id);
    metric.setStatus(MetricView.STATUS_PUBLISHED);
    metric.setDomainId(user.getDomainId());
    metric.setFunction(function);
    metric.setBindings(new ArrayList<>());
    published.put(id, metric);
    return metric;
  }

  private MetricViewBinding preset(MetricView metric, String id) {
    var binding = new MetricViewBinding();
    binding.setId(id);
    binding.setName("Preset " + id);
    binding.setDescription("Preset description");
    binding.setParameters(JSONObject.of("threshold", 50));
    metric.getBindings().add(binding);
    return binding;
  }

  private JSONObject recall(MetricRecall... hits) {
    when(metrics.recall(anyString(), anyString(), anyDouble(), anyInt())).thenReturn(List.of(hits));
    return JSONObject.from(ontology.recall(JSONObject.of("question", "How many people?"), access));
  }

  @Test
  void aPublishedMetricWithoutAPresetIsOneItemWithItsDeclaredParameters() {
    var metric = metric("plain", "person");
    var found = recall(new MetricRecall("plain", null, 0.62));
    var items = found.getJSONArray("items");
    assertEquals(1, items.size());
    var item = items.getJSONObject(0);
    assertEquals("plain", item.getString("id"));
    assertEquals("count objects", item.getString("logic"));
    assertEquals("Name plain", item.getString("name"));
    assertEquals(OntologyQueryService.revision(metric), item.getString("revision"));
    assertEquals(35, item.getJSONArray("parameterDefs").getJSONObject(0).getIntValue("value"));
    assertNull(item.get("preset"));
    verify(metrics).recall("How many people?", user.getDomainId(), 0.80, 50);
  }

  @Test
  void theNearestPresetTravelsWithItsMetricAndTheOthersAreNotOffered() {
    var metric = metric("sales", "org");
    var preset = preset(metric, "preset");
    var found = recall(new MetricRecall("sales", "preset", 0.70), new MetricRecall("sales", null, 0.74),
        new MetricRecall("sales", "preset", 0.90));
    var items = found.getJSONArray("items");
    assertEquals(1, items.size(), "One metric is one item");
    assertEquals(JSONObject.of("id", "preset", "name", "Preset preset", "description", "Preset description",
        "parameters", JSONObject.of("threshold", 50)), items.getJSONObject(0).getJSONObject("preset"));
    assertEquals(preset.getParameters(), items.getJSONObject(0).getJSONObject("preset").getJSONObject("parameters"));
  }

  private static List<String> ids(Object found) {
    return JSONObject.from(found).getJSONArray("items").stream().map(JSONObject::from)
        .map(item -> item.getString("id")).toList();
  }

  @Test
  void aMetricThatReadsAClassOutsideThePermissionOrTheTaskScopeIsNotOffered() {
    metric("hidden", "expense");
    metric("outside", "org");
    metric("visible", "person");
    when(metrics.recall(anyString(), anyString(), anyDouble(), anyInt())).thenReturn(List.of(
        new MetricRecall("hidden", null, 0.60), new MetricRecall("outside", null, 0.61),
        new MetricRecall("visible", null, 0.62)));
    assertEquals(List.of("outside", "visible"), ids(ontology.recall(JSONObject.of("question", "How many?"), access)));
    var scoped = new QueryAccessService.Access(user, permission("org", "person", "expense"), null, null, null,
        List.of("person"), null, null, null);
    assertEquals(List.of("visible"), ids(ontology.recall(JSONObject.of("question", "How many?"), scoped)),
        "The task's own class scope excludes a metric that reads other classes");
  }

  @Test
  void oneMetricCountsOnceAndTheCapEndsTheList() {
    metric("a", "person");
    metric("b", "person");
    metric("c", "person");
    metric("d", "person");
    metric("e", "person");
    metric("f", "person");
    var found = recall(new MetricRecall("a", null, 0.61), new MetricRecall("a", null, 0.62),
        new MetricRecall("b", null, 0.63), new MetricRecall("c", null, 0.64), new MetricRecall("d", null, 0.65),
        new MetricRecall("e", null, 0.66), new MetricRecall("f", null, 0.67));
    assertEquals(List.of("a", "b", "c", "d", "e"),
        found.getJSONArray("items").stream().map(JSONObject::from).map(item -> item.getString("id")).toList());
  }

  @Test
  void recallOnlyTakesTheQuestion() {
    assertThrows(IllegalArgumentException.class,
        () -> ontology.recall(JSONObject.of("question", "Sales?", "limit", 10), access));
    assertThrows(IllegalArgumentException.class, () -> ontology.recall(new JSONObject(), access));
  }
}
