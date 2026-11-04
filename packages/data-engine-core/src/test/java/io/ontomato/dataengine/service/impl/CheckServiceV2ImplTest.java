package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.CheckDaoV2;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.QueryJobService;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.util.DslRuleUtil;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

/** The quality conclusion is independent of the candidate that follows it. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CheckServiceV2ImplTest {
  private static final String DOMAIN = "domain-a";
  private static final String QUESTION = "How many employees?";

  @Mock BusinessConfigService businessConfigService;
  @Mock AdminService adminService;
  @Mock FunctionService functionService;
  @Mock MetricViewService metricViewService;
  @Mock LangService langService;
  @Mock OntologyGenerationService generationService;
  @Mock QueryJobService jobs;
  @Mock CheckDaoV2 checkDaoV2;
  @Mock KnowledgeDao knowledgeDao;
  @Mock OntologyGenerationService.Generation describeGeneration;
  @Mock OntologyGenerationService.Generation qualityGeneration;

  @InjectMocks CheckServiceV2Impl checks;

  private MockedStatic<DslRuleUtil> dslRule;

  @BeforeEach
  void setUp() {
    dslRule = mockStatic(DslRuleUtil.class);
    dslRule.when(() -> DslRuleUtil.generateWholeDslRule(any())).thenReturn("DSL syntax");
    BusinessConfig config = new BusinessConfig();
    config.setKnowledgeMaxResult(1);
    when(businessConfigService.get(DOMAIN)).thenReturn(config);
    Map<String, Object> rule = new HashMap<>();
    rule.put("datasetdesc", "dataset");
    rule.put("classDef", List.of());
    rule.put("relationship_rule", Map.of());
    when(adminService.getJSONRule(DOMAIN)).thenReturn(rule);
    when(langService.get(anyString(), anyString())).thenReturn("English");
    when(jobs.settle(any())).thenAnswer(invocation -> work(invocation.getArgument(0)));

    when(describeGeneration.result())
        .thenReturn(JSONObject.of("meaning", "counts employees", "summary", "employee count"));
    when(describeGeneration.settle(any()))
        .thenAnswer(invocation -> work(invocation.getArgument(0)));
    when(qualityGeneration.result()).thenReturn(qualityResult(90.0));
    when(qualityGeneration.settle(any()))
        .thenAnswer(invocation -> work(invocation.getArgument(0)));
    when(generationService.generate(
            eq("describe"), anyString(), anyString(), anyString(), eq(DOMAIN)))
        .thenReturn(describeGeneration);
    when(generationService.generate(
            eq("quality"), anyString(), anyString(), anyString(), eq(DOMAIN)))
        .thenReturn(qualityGeneration);
  }

  @AfterEach
  void tearDown() {
    if (dslRule != null) dslRule.close();
  }

  @Test
  void candidateFailureKeepsTheQualityConclusion() throws Exception {
    ABCHarnessCheck check = check();
    when(functionService.generateFromABCProgram(any(), any(), any(), any(), any()))
        .thenThrow(new IllegalStateException("Function generation failed"));

    assertDoesNotThrow(
        () ->
            checks.check(
                check,
                List.of(program()),
                JSONArray.of(JSONObject.of("kind", "python")),
                List.of(),
                DOMAIN,
                true));

    assertEquals(90.0, check.getScore());
    assertEquals("The program answers the question", check.getConclusion());
    assertEquals("How many staff are employed?", check.getFittedQuestion());
    assertTrue(check.getFinished());
    verify(checkDaoV2).save(check);
    verify(metricViewService, never()).save(any(), anyString());
    verify(metricViewService, never()).appendBinding(any(), any(), anyString());
  }

  @Test
  void invalidScoreStillFailsTheQualityCheck() throws Exception {
    ABCHarnessCheck check = check();
    when(qualityGeneration.result()).thenReturn(qualityResult(Double.NaN));

    assertThrows(
        IllegalStateException.class,
        () ->
            checks.check(
                check,
                List.of(program()),
                JSONArray.of(JSONObject.of("kind", "python")),
                List.of(),
                DOMAIN,
                true));
    assertNull(check.getScore());
    verify(functionService, never()).generateFromABCProgram(any(), any(), any(), any(), any());
  }

  @Test
  void bindingBranchNeverCreatesACandidate() throws Exception {
    ABCHarnessCheck check = check();

    checks.check(
        check,
        List.of(program()),
        JSONArray.of(JSONObject.of("kind", "metric", "metricId", "metric-1")),
        List.of(),
        DOMAIN,
        false);

    assertEquals(90.0, check.getScore());
    verify(functionService, never()).generateFromABCProgram(any(), any(), any(), any(), any());
    verify(metricViewService, never()).generateFromFunction(any());
    verify(metricViewService, never()).save(any(), anyString());
    verify(metricViewService, never()).appendBinding(any(), any(), anyString());
  }

  @Test
  void metricRecipeAppendsOnlyABinding() throws Exception {
    ABCHarnessCheck check = check();
    Function function = function();
    MetricView metric = metric(function);
    when(metricViewService.queryById("metric-1", DOMAIN)).thenReturn(metric);
    when(functionService.generateBindingName(
            anyString(), anyList(), eq(function), anyString(), anyString()))
        .thenReturn("Employees in 2026");
    JSONObject recipe =
        JSONObject.of(
            "kind", "metric",
            "metricId", "metric-1",
            "parameters", JSONObject.of("year", "2026"));

    checks.check(
        check, List.of(program()), JSONArray.of(recipe), List.of(), DOMAIN, true);

    ArgumentCaptor<MetricViewBinding> binding = ArgumentCaptor.forClass(MetricViewBinding.class);
    verify(metricViewService).appendBinding(eq("metric-1"), binding.capture(), eq(DOMAIN));
    assertEquals("Employees in 2026", binding.getValue().getName());
    assertEquals("2026", binding.getValue().getParameters().getString("year"));
    assertTrue(binding.getValue().getMatchQuestions().contains(QUESTION));
    verify(functionService, never()).generateFromABCProgram(any(), any(), any(), any(), any());
    verify(metricViewService, never()).generateFromFunction(any());
    verify(metricViewService, never()).save(any(), anyString());
  }

  @Test
  void metricRecipeSkipsAnIdenticalBinding() throws Exception {
    ABCHarnessCheck check = check();
    Function function = function();
    MetricView metric = metric(function);
    MetricViewBinding existing = new MetricViewBinding();
    existing.setName("Existing 2026");
    existing.setParameters(JSONObject.of("year", "2026"));
    metric.setBindings(new ArrayList<>(List.of(existing)));
    when(metricViewService.queryById("metric-1", DOMAIN)).thenReturn(metric);
    JSONObject recipe =
        JSONObject.of(
            "kind", "metric",
            "metricId", "metric-1",
            "parameters", JSONObject.of("year", "2026"));

    checks.check(
        check, List.of(program()), JSONArray.of(recipe), List.of(), DOMAIN, true);

    verify(functionService, never()).generateBindingName(any(), any(), any(), any(), any());
    verify(metricViewService, never()).appendBinding(any(), any(), anyString());
  }

  @Test
  void metricRecipeWithABindingIdAppendsNothing() throws Exception {
    ABCHarnessCheck check = check();
    JSONObject recipe =
        JSONObject.of(
            "kind", "metric",
            "metricId", "metric-1",
            "bindingId", "binding-1",
            "parameters", JSONObject.of("year", "2026"));

    checks.check(
        check, List.of(program()), JSONArray.of(recipe), List.of(), DOMAIN, true);

    verify(metricViewService, never()).queryById(anyString(), anyString());
    verify(metricViewService, never()).appendBinding(any(), any(), anyString());
  }

  private static <T> T work(Object value) throws Exception {
    return ((OntologyGenerationService.Work<T>) value).run();
  }

  private static JSONObject qualityResult(double score) {
    return JSONObject.of(
        "conclusion", "The program answers the question",
        "fittedQuestion", "How many staff are employed?",
        "score", score);
  }

  private static ABCHarnessCheck check() {
    ABCHarnessCheck check = new ABCHarnessCheck();
    check.setSessionId("check-session");
    check.setOriginQuestion(QUESTION);
    check.setLang("en");
    check.setCreateTimestamp(System.currentTimeMillis());
    check.setFinished(false);
    return check;
  }

  private static ABCHarnessProgram program() {
    ABCHarnessProgram program = new ABCHarnessProgram();
    program.setQuestion(QUESTION);
    program.setCode("# ontomato-python:2\nprint('[]')\n");
    return program;
  }

  private static Function function() {
    Parameter year = new Parameter();
    year.setName("year");
    year.setType(Parameter.TYPE_STRING);
    Function function = new Function();
    function.setId("function-1");
    function.setDomainId(DOMAIN);
    function.setOperation(Function.OPERATION_READ);
    function.setParameters(new ArrayList<>(List.of(year)));
    return function;
  }

  private static MetricView metric(Function function) {
    MetricView metric = new MetricView();
    metric.setId("metric-1");
    metric.setDomainId(DOMAIN);
    metric.setStatus(MetricView.STATUS_PUBLISHED);
    metric.setFunction(function);
    metric.setBindings(new ArrayList<>());
    return metric;
  }
}
