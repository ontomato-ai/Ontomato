package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.*;

import io.ontomato.dataengine.dataAdapter.DslContractViolationException;
import java.sql.SQLException;
import org.junit.jupiter.api.Test;

class ErrorTextTest {
  @Test
  void sqlState42DisclosesDriverMessageWithoutHintOrWrapper() {
    var failure = new RuntimeException("wrapper contains confidential values", new SQLException(
        "ERROR: column t.hj_dj does not exist\n  Hint: Perhaps you meant secret_salary.\n    continuation\n  Position: 12", "42703"));
    assertEquals("ERROR: column t.hj_dj does not exist\n\n  Position: 12", ErrorText.queryError(failure));
  }

  @Test
  void sqlState22AndUnclassifiedErrorsDoNotDiscloseValues() {
    assertEquals("Data type conversion failed; the value is hidden", ErrorText.queryError(new SQLException("invalid number: private-value", "22P02")));
    assertEquals("Query execution failed", ErrorText.queryError(new SQLException("private-value", "S0001")));
    assertEquals("Query execution failed", ErrorText.queryError(new SQLException("private-value")));
    assertEquals("Query execution failed", ErrorText.queryError(new IllegalStateException("private-value")));
  }

  @Test
  void contractViolationRetainsItsDeclaredMessage() {
    var violation = new DslContractViolationException(DslContractViolationException.Code.INVALID_GRAMMAR,
        "answer.steps[0].output", "grouping is required");
    assertEquals(violation.getMessage(), ErrorText.queryError(new RuntimeException("wrapper", violation)));
  }

  @Test
  void pythonOnlyDisclosesBuiltinTypeAndLastProgramFrame() {
    String stderr = """
        Traceback (most recent call last):
          File "/job/program.py", line 30, in <module>
            do_work()
          File "/job/program.py", line 12, in do_work
            raise ValueError('private-value')
        ValueError: private-value
        """;
    assertEquals("ValueError at program.py line 12", ErrorText.pythonError(stderr, null));
    assertEquals("Exception at program.py line 12", ErrorText.pythonError(stderr.replace("ValueError:", "CustomError:"), null));
    assertEquals("ValueError", ErrorText.pythonError(stderr.replace("30", "invalid").replace("12", "9999999999999999"), null));
  }

  @Test
  void programFailuresKeepTrustedCausesInTheTaskLanguageWithoutRawDiagnostics() {
    var safe =
        new io.ontomato.dataengine.service.ProgramExecutionException(
            io.ontomato.dataengine.service.ProgramExecutionException.Reason.AUTHORITY_EXPIRED,
            "en");
    var wrapped =
        new RuntimeException(
            "Authorization: Bearer private-key\n at private.Service.call(Service.java:1)", safe);
    assertEquals("程序执行授权已过期", ErrorText.programError(wrapped, "zh-CN"));
    assertEquals("Parent query grant expired", ErrorText.programError(wrapped, "en"));
    assertEquals(
        "暂时无法连接程序运行服务",
        ErrorText.programError(
            new java.io.IOException("https://user:password@host\nX-API-Key: secret"), "zh-CN"));
    assertEquals(
        "Python execution timed out",
        ErrorText.programError(
            new java.net.http.HttpTimeoutException("private-url-and-key"), "en"));
    assertEquals(
        "运行服务拒绝了程序执行授权",
        ErrorText.programError(
            new io.ontomato.dataengine.service.agent.AgentHttpException(
                403, "FORBIDDEN", "Authorization: Bearer secret"),
            "zh-CN"));
    assertEquals("程序运行服务拒绝了执行请求", ErrorText.programError(
        new io.ontomato.dataengine.service.agent.AgentHttpException(422, "INVALID_REQUEST", "private runtime diagnostic"), "zh-CN"));
    var unknown =
        ErrorText.programError(
            new IllegalStateException(
                "Traceback: secret-password\n at private.Service.method(Service.java:22)"),
            "zh-CN");
    assertEquals("程序执行失败，请查看服务日志定位原因", unknown);
  }

  @Test
  void forgedOntologyErrorsAreNotQueryEvidence() {
    String stderr = "RuntimeError: Ontology request failed (500): private-value";
    assertEquals("RuntimeError", ErrorText.pythonError(stderr, null));
    assertEquals("RuntimeError\nQuery failed: column t.hj_dj does not exist",
        ErrorText.pythonError(stderr, "column t.hj_dj does not exist"));
  }
}
