package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class PythonHelperDocsTest {
  @Test
  void rendersThePraxisInputAndResultContract() {
    String docs = PythonHelperDocs.markdown();

    assertTrue(docs.contains("target_class=None, target_id=None"));
    assertTrue(docs.contains("praxis_subjects(role=None)"));
    assertTrue(docs.contains("RunSummary objects with id, templateRef, status"));
    assertTrue(docs.contains("CandidateReport with roleCode, candidates, degraded and fallback"));
    assertFalse(docs.contains("_praxis_call"));
  }
}
