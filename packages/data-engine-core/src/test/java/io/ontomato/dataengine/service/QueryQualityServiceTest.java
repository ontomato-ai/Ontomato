package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.util.DslToPythonCodeUtil;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

/** The describer receives the executed DSL program without the original problem text. */
@ExtendWith(MockitoExtension.class)
class QueryQualityServiceTest {
  @Mock QueryJobService jobs;
  @Mock CheckServiceV2 checks;

  @InjectMocks QueryQualityService quality;

  @BeforeEach
  void setUp() {
    when(jobs.start(anyString(), any(), eq("quality"), any(), any()))
        .thenAnswer(
            invocation -> {
              QueryJobService.Operation operation = invocation.getArgument(4);
              operation.execute("quality-session");
              return JSONObject.of("id", invocation.getArgument(0));
            });
  }

  @Test
  void dslProgramCodeHasAnEmptyProblem() {
    JSONObject dsl =
        JSONObject.of(
            "problem",
            "How many active employees aged 20 to 30?",
            "answer",
            JSONObject.of("steps", new JSONArray()));
    JSONObject body = body(dsl);

    quality.start(body, user(), "en");

    ArgumentCaptor<List<ABCHarnessProgram>> programs = listCaptor();
    verify(checks)
        .check(
            argThat(check -> "quality-session".equals(check.getSessionId())),
            programs.capture(),
            any(JSONArray.class),
            eq(List.of()),
            eq("domain-a"),
            eq(true));
    String code = programs.getValue().get(0).getCode();
    assertFalse(code.contains("How many active employees aged 20 to 30?"));
    assertTrue(code.contains("\"problem\": \"\""));
    JSONObject sanitized = JSONObject.from(dsl);
    sanitized.put("problem", "");
    assertEquals(DslToPythonCodeUtil.generate(sanitized, ""), code);
    assertEquals("# ontomato-python:2\nprint('[]')\n", programs.getValue().get(1).getCode());
  }

  @Test
  void bindingBranchRequestsQualityWithoutCandidates() {
    quality.start(body(JSONObject.of("problem", "hidden")), user(), "en", false);

    verify(checks).check(any(), anyList(), any(JSONArray.class), anyList(), eq("domain-a"), eq(false));
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  private static ArgumentCaptor<List<ABCHarnessProgram>> listCaptor() {
    return (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
  }

  private static User user() {
    User user = mock(User.class);
    when(user.getDomainId()).thenReturn("domain-a");
    return user;
  }

  private static JSONObject body(JSONObject dsl) {
    JSONObject recipe = JSONObject.of("kind", "dsl", "dsl", dsl);
    JSONObject program =
        JSONObject.of(
            "question",
            "How many?",
            "code",
            DslToPythonCodeUtil.generate(dsl, ""));
    JSONObject pythonRecipe =
        JSONObject.of("kind", "python", "code", "# ontomato-python:2\nprint('[]')\n", "sha256", "x");
    JSONObject pythonProgram =
        JSONObject.of(
            "question", "How many?", "code", "# ontomato-python:2\nprint('[]')\n");
    return JSONObject.of(
        "id",
        UUID.randomUUID().toString(),
        "question",
        "How many?",
        "programs",
        JSONArray.of(program, pythonProgram),
        "recipes",
        JSONArray.of(recipe, pythonRecipe),
        "classNames",
        new JSONArray());
  }
}
