package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A save that names its submitted fields changes those and keeps every other saved value. */
class PanelFormFieldsTest {
  private JSONObject saved() {
    return JSONObject.of(
        "name", "Revenue", "description", "Monthly", "matchQuestions", JSONArray.of("revenue"),
        "function", JSONObject.of("name", "revenue_query", "logic", "Sum the amounts",
            "queryPackage", JSONObject.of("manifest", JSONObject.of("parameterDefs", new JSONArray()))),
        "bindings", JSONArray.of(JSONObject.of("id", "b1", "name", "First"), JSONObject.of("id", "b2", "name", "Second")));
  }

  @Test
  void takesOnlyTheSubmittedFieldsFromTheRequest() {
    JSONObject request = JSONObject.of("name", "", "description", "Weekly", "function", JSONObject.of("logic", "Count"));

    JSONObject merged = PanelFormFields.withSubmitted(saved(), request, List.of("/description", "/function/logic"));

    assertEquals("Revenue", merged.getString("name"));
    assertEquals("Weekly", merged.getString("description"));
    assertEquals("Count", merged.getJSONObject("function").getString("logic"));
    assertEquals("revenue_query", merged.getJSONObject("function").getString("name"));
    assertNotNull(merged.getJSONObject("function").getJSONObject("queryPackage"));
    assertEquals(List.of("revenue"), merged.getJSONArray("matchQuestions").toJavaList(String.class));
    assertEquals(2, merged.getJSONArray("bindings").size());
  }

  @Test
  void clearsASubmittedFieldTheRequestLeavesOutAndReplacesOneArrayRow() {
    JSONObject request = JSONObject.of("bindings", JSONArray.of(JSONObject.of("id", "b1", "name", "First"),
        JSONObject.of("id", "b2", "name", "Renamed")));

    JSONObject merged = PanelFormFields.withSubmitted(saved(), request, List.of("/matchQuestions", "/bindings/1/name"));

    assertTrue(merged.containsKey("matchQuestions"));
    assertNull(merged.get("matchQuestions"));
    assertEquals("First", merged.getJSONArray("bindings").getJSONObject(0).getString("name"));
    assertEquals("Renamed", merged.getJSONArray("bindings").getJSONObject(1).getString("name"));
  }

  @Test
  void leavesTheSavedValuesItWasGivenUnchanged() {
    JSONObject saved = saved();
    PanelFormFields.withSubmitted(saved, JSONObject.of("name", "Other"), List.of("/name"));
    assertEquals("Revenue", saved.getString("name"));
  }

  @Test
  void refusesASubmittedFieldThatIsNotAPointer() {
    assertThrows(IllegalArgumentException.class,
        () -> PanelFormFields.withSubmitted(saved(), new JSONObject(), List.of("name")));
  }

  @Test
  void buildsAnObjectControlWithVariants() {
    JSONArray common = JSONArray.of(PanelFormFields.field(
        "/mode", "Mode",
        PanelFormFields.select(JSONArray.of(
            PanelFormFields.option("none", "None"),
            PanelFormFields.option("rule", "Rule"),
            PanelFormFields.option("agent", "Agent"))),
        PanelFormFields.schema("string"), true, false, null, null, false));
    JSONObject variants = JSONObject.of(
        "rule", JSONArray.of(PanelFormFields.field(
            "/ruleId", "Rule", PanelFormFields.text(false), PanelFormFields.schema("string"),
            true, false, null, null, false)),
        "agent", JSONArray.of(PanelFormFields.field(
            "/agentId", "Agent", PanelFormFields.text(false), PanelFormFields.schema("string"),
            true, false, null, null, false)));

    JSONObject withDefault = PanelFormFields.object(common, JSONObject.of("mode", "none"), "/mode", variants);
    assertEquals("object", withDefault.getString("kind"));
    assertEquals("none", withDefault.getJSONObject("defaultObject").getString("mode"));
    assertEquals("/mode", withDefault.getString("variantBy"));
    assertEquals(common, withDefault.getJSONArray("fields"));
    assertEquals(variants, withDefault.getJSONObject("variants"));

    JSONObject withoutDefault = PanelFormFields.object(common, null, "/mode", variants);
    assertFalse(withoutDefault.containsKey("defaultObject"));
    assertEquals("/mode", withoutDefault.getString("variantBy"));

    JSONObject plain = PanelFormFields.object(common, null, null, null);
    assertFalse(plain.containsKey("variantBy"));
    assertFalse(plain.containsKey("variants"));
  }

  @Test
  void refusesIncompleteOrMalformedObjectVariants() {
    JSONArray fields = new JSONArray();
    assertThrows(IllegalArgumentException.class, () -> PanelFormFields.object(fields, null, "/mode", null));
    assertThrows(IllegalArgumentException.class, () -> PanelFormFields.object(fields, null, null, new JSONObject()));
    assertThrows(IllegalArgumentException.class, () -> PanelFormFields.object(fields, null, "mode", new JSONObject()));
  }
}
