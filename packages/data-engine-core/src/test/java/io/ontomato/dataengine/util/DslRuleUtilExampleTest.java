package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mockStatic;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class DslRuleUtilExampleTest {
  @Test
  void generatedExampleIsOneDslObject() {
    var query = JSONObject.of("classes", List.of("/Person"));
    try (var files = mockStatic(FileUtil.class)) {
      files.when(() -> FileUtil.getResourceFileLoadAll("dslExample/baseObject.json", "utf-8"))
          .thenReturn("{}");
      files.when(() -> FileUtil.getResourceFileLoadAll("dslExample/baseOutputFields.json", "utf-8"))
          .thenReturn("[]");

      String markdown = DslRuleUtil.generateDslExample(query, Map.of("classDef", List.of()));

      assertTrue(markdown.startsWith("```json\n"));
      assertTrue(markdown.endsWith("\n```"));
      String json = markdown.substring("```json\n".length(), markdown.length() - "\n```".length());
      var example = assertInstanceOf(JSONObject.class, JSON.parse(json));
      assertEquals(Set.of("problem", "answer"), example.keySet());
      assertFalse(example.getJSONObject("answer").getJSONArray("steps").isEmpty());
    }
  }
}
