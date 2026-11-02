package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class PythonHelperDocsTest {
  @Test
  void rendersTheSingleHelperContractFromTheRuntimeSource() {
    String markdown = PythonHelperDocs.markdown();

    assertTrue(markdown.contains("Generated from `python/query_runtime.py`"));
    assertTrue(markdown.contains("def query(dsl):"));
    assertTrue(markdown.contains("def update(className, setValues, where):"));
    assertTrue(markdown.contains("def delete(className, where):"));
    assertTrue(markdown.contains("It is the query plan itself, not a"));
    assertTrue(markdown.contains("operators are"));
    assertTrue(markdown.contains("appendVector"));
  }
}
