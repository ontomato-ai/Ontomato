package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * A published metric revision guards its definition. Question matching rewrites the metric on every hit, so a revision
 * that covered that bookkeeping would reject executions that never see a changed definition.
 */
class MetricViewRevisionTest {

  @Test
  void matchBookkeepingKeepsTheRevision() {
    MetricView metric = metric();
    String revision = OntologyQueryService.revision(metric);
    metric.setMatchQuestions(new HashSet<>(List.of("how many orders?")));
    metric.setModifyTimestamp(1234L);
    metric.setName("Renamed payroll");
    assertEquals(revision, OntologyQueryService.revision(metric));
  }

  @Test
  void aChangedProgramParameterOrBindingChangesTheRevision() {
    MetricView metric = metric();
    String revision = OntologyQueryService.revision(metric);

    MetricView code = metric();
    code.getFunction().setCode("# ontomato-python:2\nprint('{\"answer\": [1]}')");
    assertNotEquals(revision, OntologyQueryService.revision(code));

    MetricView parameter = metric();
    parameter.getFunction().getParameters().get(0).setSample("changed");
    assertNotEquals(revision, OntologyQueryService.revision(parameter));

    MetricView binding = metric();
    var stored = new MetricViewBinding();
    stored.setId("binding");
    stored.setParameters(com.alibaba.fastjson2.JSONObject.of("department", "Operations"));
    binding.getBindings().add(stored);
    assertNotEquals(revision, OntologyQueryService.revision(binding));
    stored.setParameters(com.alibaba.fastjson2.JSONObject.of("department", "Sales"));
    assertNotEquals(OntologyQueryService.revision(binding), OntologyQueryService.revision(metric()));
  }

  private static MetricView metric() {
    var ref = new ABCHarnessProgramOutKeyRef();
    ref.setKey("total");
    ref.setClassName("/Employee");
    ref.setAttrName("salary");
    var returns = new ReturnDef();
    returns.setOutKeyRefs(List.of(ref));
    var parameter = new io.ontomato.dataengine.bean.function.Parameter();
    parameter.setName("department");
    parameter.setType(io.ontomato.dataengine.bean.function.Parameter.TYPE_STRING);
    parameter.setSample("Operations");
    var function = new Function();
    function.setDomainId("domain");
    function.setOperation(Function.OPERATION_READ);
    function.setCode("# ontomato-python:2\nprint('{\"answer\": []}')");
    function.setParameters(new ArrayList<>(List.of(parameter)));
    function.setReturnDef(returns);
    var metric = new MetricView();
    metric.setId("metric");
    metric.setName("Payroll");
    metric.setDomainId("domain");
    metric.setStatus(MetricView.STATUS_PUBLISHED);
    metric.setFunction(function);
    metric.setBindings(new ArrayList<>());
    return metric;
  }
}
