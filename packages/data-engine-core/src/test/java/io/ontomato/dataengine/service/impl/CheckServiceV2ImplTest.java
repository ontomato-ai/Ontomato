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
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.QueryJobService;
import io.ontomato.dataengine.service.MetricSettlementService;
import io.ontomato.dataengine.service.OntologyQueryService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.SubjectValueResolver;
import io.ontomato.dataengine.service.SubjectAttributeLookup;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.FunctionDao;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.util.DslRuleUtil;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

/** Quality is its own job; candidates are a separate job that can fail on its own. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CheckServiceV2ImplTest {
  private static final String DOMAIN = "domain-a";
  private static final String QUESTION = "How many employees?";

  @Mock BusinessConfigService businessConfigService;
  @Mock AdminService adminService;
  @Mock MetricViewService metricViewService;
  @Mock LangService langService;
  @Mock OntologyGenerationService generationService;
  @Mock QueryJobService jobs;
  @Mock CheckDaoV2 checkDaoV2;
  @Mock KnowledgeDao knowledgeDao;
  @Mock OntologyGenerationService.Generation describeGeneration;
  @Mock OntologyGenerationService.Generation qualityGeneration;
  @Mock OntologyGenerationService.Generation settlementGeneration;
  @Mock OntologyQueryService ontology;

  @InjectMocks CheckServiceV2Impl checks;

  private MockedStatic<DslRuleUtil> dslRule;

  @BeforeEach
  void setUp() throws Exception {
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
    ReflectionTestUtils.setField(checks, "settlements", new MetricSettlementService(
        metricViewService, ontology, generationService, new SubjectValueResolver(mock(SubjectAttributeLookup.class))));
    when(generationService.executionAccess(DOMAIN)).thenReturn(
        new QueryAccessService.Access(new QueryAccessService.GrantUser("reader", DOMAIN), null, null, null, null));
    when(generationService.settleMetricView(anyString(), anyString(), eq("en"), eq(DOMAIN)))
        .thenReturn(settlementGeneration);
    when(settlementGeneration.result()).thenReturn(JSONObject.of("kind", "create", "name", "Employees",
        "logic", "Count employees", "queryPackage", program().getQueryPackage(), "columnLabels", new JSONObject()));
    when(settlementGeneration.settle(any())).thenAnswer(invocation -> work(invocation.getArgument(0)));
    when(metricViewService.generateFromFunction(any())).thenAnswer(invocation -> {
      MetricView metric = metric(invocation.getArgument(0));
      metric.setId(null);
      metric.setStatus(MetricView.STATUS_PENDING_REVIEW);
      return metric;
    });
    when(metricViewService.save(any(), eq("en"))).thenAnswer(invocation -> {
      MetricView metric = invocation.getArgument(0);
      metric.setId("metric-1");
      return metric;
    });

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
  void qualityCheckSettlesTheConclusionWithoutCandidates() throws Exception {
    ABCHarnessCheck check = check();

    checks.check(check, List.of(program()), List.of(), List.of(), List.of(), DOMAIN);

    assertEquals(90.0, check.getScore());
    assertEquals("Answers the staff count", check.getSummary());
    assertEquals("The program answers the question", check.getConclusion());
    assertEquals("How many staff are employed?", check.getFittedQuestion());
    assertTrue(check.getFinished());
    verify(checkDaoV2).save(check);
    verify(generationService, never()).settleMetricView(any(), any(), any(), any());
    verify(metricViewService, never()).generateFromFunction(any());
    verify(metricViewService, never()).save(any(), anyString());
    verify(metricViewService, never()).appendBinding(any(), any(), anyString());
  }

  @Test
  void qualityPromptUsesHostQuotesAndConfirmedDecisions() throws Exception {
    ABCHarnessCheck check = check();

    checks.check(
        check,
        List.of(program()),
        List.of("The user's actual message"),
        List.of("Confirmed decision"),
        List.of(),
        DOMAIN);

    ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
    verify(generationService)
        .generate(eq("quality"), anyString(), prompt.capture(), anyString(), eq(DOMAIN));
    assertTrue(prompt.getValue().contains("The user's actual message"));
    assertTrue(prompt.getValue().contains("Confirmed decision"));
    assertFalse(prompt.getValue().contains(QUESTION));
  }

  @Test
  void aMissingSummaryStillSettlesTheCheckWithoutOne() throws Exception {
    ABCHarnessCheck check = check();
    JSONObject result = qualityResult(90.0);
    result.remove("summary");
    when(qualityGeneration.result()).thenReturn(result);

    checks.check(check, List.of(program()), List.of(), List.of(), List.of(), DOMAIN);

    assertEquals(90.0, check.getScore());
    assertNull(check.getSummary());
    assertEquals("The program answers the question", check.getConclusion());
    assertTrue(check.getFinished());
  }

  @Test
  void invalidScoreStillFailsTheQualityCheck() throws Exception {
    ABCHarnessCheck check = check();
    when(qualityGeneration.result()).thenReturn(qualityResult(Double.NaN));

    assertThrows(
        IllegalStateException.class,
        () -> checks.check(check, List.of(program()), List.of(), List.of(), List.of(), DOMAIN));
    assertNull(check.getScore());
    verify(generationService, never()).settleMetricView(any(), any(), any(), any());
  }

  @Test
  void candidateFailureIsLoggedAndTheNextCandidateStillRuns() throws Exception {
    when(generationService.settleMetricView(anyString(), anyString(), eq("en"), eq(DOMAIN)))
        .thenThrow(new IllegalStateException("Metric generation failed"))
        .thenReturn(settlementGeneration);
    assertDoesNotThrow(() -> checks.generateCandidates(scoredCheck(), List.of(program(), program()),
        JSONArray.of(packageRecipe(), packageRecipe()), DOMAIN));
    verify(generationService, times(2)).settleMetricView(anyString(), anyString(), eq("en"), eq(DOMAIN));
    verify(metricViewService).save(any(), eq("en"));
    verify(metricViewService, never()).saveAdoptedCandidate(any(), any(), anyString());
  }

  @Test
  void packageRecipeCreatesAFunctionCandidateFromTheWholePackage() throws Exception {
    ABCHarnessCheck check = scoredCheck();
    checks.generateCandidates(check, List.of(program()), JSONArray.of(packageRecipe()), DOMAIN);
    ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
    verify(generationService).settleMetricView(anyString(), prompt.capture(), eq("en"), eq(DOMAIN));
    assertTrue(prompt.getValue().contains(program().getQueryPackage().toJSONString()));
    ArgumentCaptor<MetricView> saved = ArgumentCaptor.forClass(MetricView.class);
    verify(metricViewService).save(saved.capture(), eq("en"));
    assertEquals("reader", saved.getValue().getCreatedBy());
    assertEquals(MetricView.STATUS_PENDING_REVIEW, saved.getValue().getStatus());
    assertFalse(saved.getValue().isAdopted());
    assertEquals(90.0, saved.getValue().getOriginCheckResult().getScore());
    assertEquals(1, saved.getValue().getBindings().size());
    assertEquals(new JSONObject(), saved.getValue().getBindings().getFirst().getParameters());
    assertEquals(program().getQueryPackage(), saved.getValue().getFunction().getQueryPackage());
  }

  @Test
  void metricRecipeAppendsOnlyABinding() throws Exception {
    MetricView metric = metric(function());
    when(ontology.metric(eq("metric-1"), eq("revision-1"), any())).thenReturn(metric);
    when(metricViewService.appendBinding(eq("metric-1"), any(), eq(DOMAIN))).thenReturn(metric);
    checks.generateCandidates(scoredCheck(), List.of(program()), JSONArray.of(metricRecipe()), DOMAIN);
    ArgumentCaptor<MetricViewBinding> binding = ArgumentCaptor.forClass(MetricViewBinding.class);
    verify(metricViewService).appendBinding(eq("metric-1"), binding.capture(), eq(DOMAIN));
    assertEquals(QUESTION, binding.getValue().getName());
    assertEquals("2026", binding.getValue().getParameters().getString("year"));
    assertTrue(binding.getValue().getMatchQuestions().contains(QUESTION));
    verify(generationService, never()).settleMetricView(any(), any(), any(), any());
    verify(metricViewService, never()).generateFromFunction(any());
    verify(metricViewService, never()).save(any(), anyString());
  }

  @Test
  void longPublishedMetricQuestionsRemainWholeInBindingNamesAndMatchQuestions() throws Exception {
    String question = "Execute the published metric exactly as defined. ".repeat(8);
    MetricView metric = metric(function());
    when(ontology.metric(eq("metric-1"), eq("revision-1"), any())).thenReturn(metric);
    when(metricViewService.appendBinding(eq("metric-1"), any(), eq(DOMAIN))).thenReturn(metric);
    ABCHarnessProgram program = program();
    program.setQuestion(question);
    checks.generateCandidates(scoredCheck(), List.of(program), JSONArray.of(metricRecipe()), DOMAIN);
    ArgumentCaptor<MetricViewBinding> binding = ArgumentCaptor.forClass(MetricViewBinding.class);
    verify(metricViewService).appendBinding(eq("metric-1"), binding.capture(), eq(DOMAIN));
    assertTrue(question.length() > 255);
    assertEquals(question, binding.getValue().getName());
    assertEquals(Set.of(question), binding.getValue().getMatchQuestions());
  }

  @Test
  void chartSettlementTaskKeepsCategoryRowsSeparateFromSummaryCards() throws Exception {
    var settlement = new MetricSettlementService(metricViewService, ontology, generationService,
        new SubjectValueResolver(mock(SubjectAttributeLookup.class)));
    settlement.settle("chart-task", JSONObject.of("question", QUESTION, "recipe", packageRecipe(),
            "calculation", "Keep every category without adding a summary row",
            "outputShape", JSONObject.of("cardKind", "chart", "chartType", "bar")),
        new QueryAccessService.GrantUser("reader", DOMAIN), "en", false, null, task -> task.run());
    ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
    verify(generationService).settleMetricView(anyString(), prompt.capture(), eq("en"), eq(DOMAIN));
    assertTrue(prompt.getValue().contains("\"cardKind\":\"chart\""));
    assertTrue(prompt.getValue().contains("grand-total, subtotal or summary rows as extra chart categories"));
    assertTrue(prompt.getValue().contains("A separate metric card"));
    assertTrue(prompt.getValue().contains("do not add unrequested analyses, derived columns or rows"));
  }

  @Test
  void metricRecipeSkipsAnIdenticalBinding() throws Exception {
    // Deduplication moved to the locked metric write; exercise that owner instead of a caller-side copy.
    MetricView metric = metric(function());
    MetricViewBinding existing = new MetricViewBinding();
    existing.setId("binding-1");
    existing.setName("Existing 2026");
    existing.setParameters(JSONObject.of("year", "2026"));
    metric.setBindings(new ArrayList<>(List.of(existing)));
    MetricViewDao dao = mock(MetricViewDao.class);
    FunctionDao functions = mock(FunctionDao.class);
    PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    when(dao.queryById("metric-1", DOMAIN)).thenReturn(new Object[] {metric, "function-1"});
    when(functions.queryById("function-1")).thenReturn(metric.getFunction());
    MetricViewServiceImpl writer = new MetricViewServiceImpl();
    ReflectionTestUtils.setField(writer, "metricViewDao", dao);
    ReflectionTestUtils.setField(writer, "functionDao", functions);
    ReflectionTestUtils.setField(writer, "transactionManager", transactions);
    ReflectionTestUtils.setField(writer, "subjectValues", new SubjectValueResolver(mock(SubjectAttributeLookup.class)));
    ReflectionTestUtils.setField(checks, "settlements", new MetricSettlementService(
        writer, ontology, generationService, new SubjectValueResolver(mock(SubjectAttributeLookup.class))));
    when(ontology.metric(eq("metric-1"), eq("revision-1"), any())).thenReturn(metric);
    checks.generateCandidates(scoredCheck(), List.of(program()), JSONArray.of(metricRecipe()), DOMAIN);
    verify(dao).lock("metric-1", DOMAIN);
    verify(dao, never()).save(any());
    assertEquals(List.of(existing), metric.getBindings());
    verify(generationService, never()).settleMetricView(any(), any(), any(), any());
  }

  @Test
  void metricRecipeWithABindingIdAppendsNothing() throws Exception {
    MetricView metric = metric(function());
    MetricViewBinding existing = new MetricViewBinding();
    existing.setId("binding-1");
    existing.setName("Existing 2026");
    existing.setParameters(JSONObject.of("year", "2026"));
    metric.setBindings(new ArrayList<>(List.of(existing)));
    when(ontology.metric(eq("metric-1"), eq("revision-1"), any())).thenReturn(metric);
    JSONObject recipe = metricRecipe();
    recipe.put("bindingId", "binding-1");
    checks.generateCandidates(scoredCheck(), List.of(program()), JSONArray.of(recipe), DOMAIN);
    verify(metricViewService, never()).appendBinding(any(), any(), anyString());
    verify(metricViewService, never()).save(any(), anyString());
    verify(generationService, never()).settleMetricView(any(), any(), any(), any());
  }

  private static JSONObject packageRecipe() {
    return JSONObject.of("kind", "package", "package", program().getQueryPackage(), "parameters", new JSONObject());
  }

  private static JSONObject metricRecipe() {
    return JSONObject.of("kind", "metric", "metricId", "metric-1", "revision", "revision-1",
        "parameters", JSONObject.of("year", "2026"));
  }

  private static <T> T work(Object value) throws Exception {
    return ((OntologyGenerationService.Work<T>) value).run();
  }

  private static JSONObject qualityResult(double score) {
    return JSONObject.of(
        "summary", "Answers the staff count",
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

  private static ABCHarnessCheck scoredCheck() {
    ABCHarnessCheck check = check();
    check.setScore(90.0);
    check.setConclusion("The program answers the question");
    check.setFittedQuestion("How many staff are employed?");
    check.setFinished(true);
    return check;
  }

  private static ABCHarnessProgram program() {
    ABCHarnessProgram program = new ABCHarnessProgram();
    program.setQuestion(QUESTION);
    program.setQueryPackage(io.ontomato.dataengine.service.QueryPackage.fromDsl(
        JSONObject.of("problem", QUESTION, "answer", JSONObject.of("steps", new JSONArray())).toJSONString()));
    program.setParameterValues(new JSONObject());
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
