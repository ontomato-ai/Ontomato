package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.core.bean.User;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

/** Quality and candidate jobs share frozen sources; the describer alone receives the blind view. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class QueryQualityServiceTest {
  private static final String DOMAIN = "domain-a";

  @Mock QueryJobService jobs;
  @Mock CheckServiceV2 checks;

  QueryQualityService quality;

  private final AtomicReference<Object> qualityResult = new AtomicReference<>();
  private final AtomicReference<JSONObject> candidateInput = new AtomicReference<>();
  private final AtomicReference<QueryJobService.Operation> candidateOperation =
      new AtomicReference<>();

  @BeforeEach
  void setUp() {
    quality = new QueryQualityService(jobs, checks);
    when(jobs.start(anyString(), any(), eq("quality"), any(), any()))
        .thenAnswer(
            invocation -> {
              QueryJobService.Operation operation = invocation.getArgument(4);
              qualityResult.set(operation.execute("quality-session"));
              return JSONObject.of(
                  "id", invocation.getArgument(0),
                  "status", "completed",
                  "result", qualityResult.get());
            });
    when(jobs.start(anyString(), any(), eq("candidate"), any(), any()))
        .thenAnswer(
            invocation -> {
              candidateInput.set(invocation.getArgument(3));
              candidateOperation.set(invocation.getArgument(4));
              return JSONObject.of("id", invocation.getArgument(0), "status", "running");
            });
    doAnswer(
            invocation -> {
              ABCHarnessCheck check = invocation.getArgument(0);
              check.setScore(88.0);
              check.setConclusion("The program answers the question");
              check.setFittedQuestion("How many staff are employed?");
              check.setFinished(true);
              return null;
            })
        .when(checks)
        .check(any(), anyList(), anyList(), anyList(), anyList(), eq(DOMAIN));
  }

  @Test
  void qualityReturnsBeforeTheCandidateJobRuns() throws Exception {
    JSONObject body = body(JSONObject.of("problem", "How many active employees?"));
    User user = user();

    Object result = quality.start(body, user, "en");

    assertEquals("completed", ((JSONObject) result).getString("status"));
    ABCHarnessCheck check = assertInstanceOf(ABCHarnessCheck.class, qualityResult.get());
    assertEquals(88.0, check.getScore());
    assertEquals("The program answers the question", check.getConclusion());
    verify(checks).check(eq(check), anyList(), anyList(), anyList(), anyList(), eq(DOMAIN));
    verify(checks, never()).generateCandidates(any(), anyList(), any(JSONArray.class), anyString());

    String candidateId =
        UUID.nameUUIDFromBytes(
                (body.getString("id") + ":candidate").getBytes(StandardCharsets.UTF_8))
            .toString();
    verify(jobs)
        .start(
            eq(candidateId),
            eq(user),
            eq("candidate"),
            any(JSONObject.class),
            any(QueryJobService.Operation.class));
    JSONObject input = candidateInput.get();
    assertEquals("quality-session", input.getString("checkSessionId"));
    assertEquals("en", input.getString("lang"));
    assertEquals(88.0, input.getDouble("score"));
    assertEquals("The program answers the question", input.getString("conclusion"));
    assertEquals("How many staff are employed?", input.getString("fittedQuestion"));
    assertEquals(DOMAIN, input.getString("domainId"));
    assertEquals(2, input.getJSONArray("programs").size());
    assertEquals(2, input.getJSONArray("recipes").size());
    assertTrue(input.getJSONArray("programs").getJSONObject(0).getJSONObject("queryPackage")
        .getJSONObject("manifest").containsKey("computation"));
    assertTrue(input.getJSONArray("programs").getJSONObject(0).getJSONObject("queryPackage").toJSONString()
        .contains("How many active employees?"));

    candidateOperation.get().execute("candidate-session");

    ArgumentCaptor<ABCHarnessCheck> candidateCheck = ArgumentCaptor.forClass(ABCHarnessCheck.class);
    ArgumentCaptor<List<ABCHarnessProgram>> programs = listCaptor();
    ArgumentCaptor<JSONArray> recipes = ArgumentCaptor.forClass(JSONArray.class);
    verify(checks)
        .generateCandidates(
            candidateCheck.capture(), programs.capture(), recipes.capture(), eq(DOMAIN));
    assertEquals(88.0, candidateCheck.getValue().getScore());
    assertEquals("The program answers the question", candidateCheck.getValue().getConclusion());
    assertEquals("How many staff are employed?", candidateCheck.getValue().getFittedQuestion());
    assertEquals(2, programs.getValue().size());
    assertEquals(2, recipes.getValue().size());
  }

  @Test
  void candidateAdmissionFailureDoesNotChangeTheQualityResult() throws Exception {
    when(jobs.start(anyString(), any(), eq("candidate"), any(), any()))
        .thenThrow(new IllegalStateException("admission failed"));

    quality.start(body(JSONObject.of("problem", "hidden")), user(), "en");

    ABCHarnessCheck check = assertInstanceOf(ABCHarnessCheck.class, qualityResult.get());
    assertEquals(88.0, check.getScore());
    assertEquals("The program answers the question", check.getConclusion());
  }

  @Test
  void lowScoreDoesNotStartACandidateJob() throws Exception {
    doAnswer(
            invocation -> {
              ABCHarnessCheck check = invocation.getArgument(0);
              check.setScore(59.0);
              check.setConclusion("The program is close");
              check.setFittedQuestion("How many staff?");
              check.setFinished(true);
              return null;
            })
        .when(checks)
        .check(any(), anyList(), anyList(), anyList(), anyList(), eq(DOMAIN));

    quality.start(body(JSONObject.of("problem", "hidden")), user(), "en");

    verify(jobs, never()).start(anyString(), any(), eq("candidate"), any(), any());
  }

  @Test
  void qualityPassesHostQuotesAndConfirmedDecisions() throws Exception {
    quality.start(body(JSONObject.of("problem", "hidden")), user(), "en", false);

    ArgumentCaptor<List<String>> quotes = stringListCaptor();
    ArgumentCaptor<List<String>> decisions = stringListCaptor();
    verify(checks)
        .check(
            any(), anyList(), quotes.capture(), decisions.capture(), anyList(), eq(DOMAIN));
    assertEquals(List.of("host quote"), quotes.getValue());
    assertEquals(List.of("host decision"), decisions.getValue());
  }

  @Test
  void bindingBranchDoesNotStartACandidateJob() throws Exception {
    quality.start(body(JSONObject.of("problem", "hidden")), user(), "en", false);

    verify(jobs, never()).start(anyString(), any(), eq("candidate"), any(), any());
    verify(checks).check(any(), anyList(), anyList(), anyList(), anyList(), eq(DOMAIN));
  }

  @Test
  void frozenDslStaysStructuredAndOnlyTheDescriberViewRemovesItsProblem() throws Exception {
    JSONObject dsl =
        JSONObject.of(
            "problem",
            "How many active employees aged 20 to 30?",
            "answer",
            JSONObject.of("steps", new JSONArray()));
    JSONObject body = body(dsl);

    quality.start(body, user(), "en", false);

    ArgumentCaptor<List<ABCHarnessProgram>> programs = listCaptor();
    verify(checks)
        .check(
            argThat(check -> "quality-session".equals(check.getSessionId())),
            programs.capture(),
            anyList(),
            anyList(),
            eq(List.of()),
            eq(DOMAIN));
    var program = programs.getValue().get(0);
    assertNull(program.getCode());
    assertEquals(dsl.toJSONString(), program.getQueryPackage().getJSONArray("files").getJSONObject(0).getString("content"));
    assertFalse(QueryBlindView.of(program).toJSONString().contains("How many active employees aged 20 to 30?"));
    assertEquals(2, programs.getValue().get(1).getQueryPackage().getJSONArray("files").size());
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  private static ArgumentCaptor<List<ABCHarnessProgram>> listCaptor() {
    return (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  private static ArgumentCaptor<List<String>> stringListCaptor() {
    return (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
  }

  private static User user() {
    User user = mock(User.class);
    when(user.getDomainId()).thenReturn(DOMAIN);
    return user;
  }

  private static JSONObject body(JSONObject dsl) {
    JSONObject recipe = JSONObject.of("kind", "package", "package", QueryPackage.fromDsl(dsl.toJSONString()), "parameters", new JSONObject());
    JSONObject program = QuerySourceSnapshot.fromDataset(JSONObject.of("schema", "workbench.dataset.v2", "question", "How many?", "recipe", recipe));
    JSONObject pythonPackage;
    try (var input = QueryQualityServiceTest.class.getResourceAsStream("/ontology-contracts/examples/query-packages.json")) {
      pythonPackage = com.alibaba.fastjson2.JSON.parseObject(input.readAllBytes()).getJSONObject("pythonAggregate");
    } catch (Exception error) { throw new IllegalStateException(error); }
    JSONObject pythonRecipe = JSONObject.of("kind", "package", "package", pythonPackage, "parameters", JSONObject.of("threshold", 20));
    JSONObject pythonProgram = QuerySourceSnapshot.fromDataset(JSONObject.of("schema", "workbench.dataset.v2", "question", "How many?", "recipe", pythonRecipe));
    return JSONObject.of(
        "id",
        UUID.randomUUID().toString(),
        "question",
        "How many?",
        "programs",
        JSONArray.of(program, pythonProgram),
        "recipes",
        JSONArray.of(recipe, pythonRecipe),
        "userQuotes",
        JSONArray.of("host quote"),
        "confirmedDecisions",
        JSONArray.of("host decision"),
        "classNames",
        new JSONArray());
  }
}
