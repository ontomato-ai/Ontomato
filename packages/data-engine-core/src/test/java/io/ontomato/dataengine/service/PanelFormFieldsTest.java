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
}
