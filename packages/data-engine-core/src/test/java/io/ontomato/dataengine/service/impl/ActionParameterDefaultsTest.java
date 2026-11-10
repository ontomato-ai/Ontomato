package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.ActionPreconditionService;
import io.ontomato.dataengine.service.IdentitySnapshotLookup;
import io.ontomato.dataengine.service.MetricViewBindings;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class ActionParameterDefaultsTest {
  private Function definition() {
    var org = new Parameter();
    org.setName("org_id");
    org.setType(Parameter.TYPE_STRING);
    org.setValue("must-not-be-reused");
    var parent = new Parameter();
    parent.setName("up");
    parent.setType(Parameter.TYPE_NUMBER);
    parent.setValue(12);
    var function = new Function();
    function.setId("function-a");
    function.setDomainId("domain-a");
    function.setOperation(Function.OPERATION_WRITE);
    function.setParameters(List.of(org, parent));
    return function;
  }

  @Test
  void manualActionOmissionsBecomeNullInADetachedExecution() throws Exception {
    var definition = definition();
    var action = new Action();
    action.setId("action-a");
    action.setStatus(Action.STATUS_PUBLISHED);
    action.setDomainId("domain-a");
    action.setFunction(definition);
    var service = spy(new ActionServiceImpl());
    doReturn(action).when(service).queryById("action-a");
    var programs = mock(ABCProgramService.class);
    var received = new AtomicReference<Function>();
    when(programs.execute(
            anyString(),
            any(Function.class),
            eq("user-a"),
            any(),
            anyString(),
            eq("en"),
            eq(1),
            eq("domain-a"),
            any(ABCProgramService.ExecutionContext.class)))
        .thenAnswer(
            call -> {
              received.set(call.getArgument(1));
              return new Object[] {null, new PythonExecuteResult()};
            });
    ReflectionTestUtils.setField(service, "identity", mock(IdentityService.class));
    ReflectionTestUtils.setField(service, "abcProgramService", programs);
    var grants = mock(CapabilityGrantLookup.class);
    when(grants.allows("user-a", "domain-a", CapabilityGrantLookup.ACTION, "action-a")).thenReturn(true);
    ReflectionTestUtils.setField(service, "capabilityGrants", grants);
    var preconditions = mock(ActionPreconditionService.class);
    when(preconditions.evaluate(any(), any(), any(), any())).thenReturn(new ActionPreconditionService.Verdict(true, List.of()));
    ReflectionTestUtils.setField(service, "preconditions", preconditions);
    var snapshots = mock(IdentitySnapshotLookup.class);
    when(snapshots.snapshot(any(), any())).thenReturn(new JSONObject());
    ReflectionTestUtils.setField(service, "identitySnapshots", snapshots);
    ReflectionTestUtils.setField(service, "workflowRuns", mock(WorkflowRunResolver.class));
    var supplied = new JSONObject();
    service.execute(
        "action-a",
        supplied,
        "en",
        new QueryAccessService.GrantUser("user-a", "domain-a"),
        new UserDataPermission(),
        1);
    var values = MetricViewBindings.values(received.get());
    assertEquals(java.util.Set.of("org_id", "up"), values.keySet());
    assertNull(values.get("org_id"));
    assertNull(values.get("up"));
    assertTrue(supplied.isEmpty());
    assertEquals("must-not-be-reused", definition.getParameters().getFirst().getValue());
  }

  @Test
  void explicitValuesRetainTheirMeaningAndUnknownParametersStillFail() {
    var definition = definition();
    var values =
        MetricViewBindings.values(
            MetricViewBindings.executionWriteFunction(
                definition, JSONObject.of("org_id", "", "up", 0)));
    assertEquals("", values.getString("org_id"));
    assertEquals(0, values.getIntValue("up"));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            MetricViewBindings.executionWriteFunction(
                definition, JSONObject.of("unknown", "value")));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            MetricViewBindings.executionWriteFunction(
                definition, JSONObject.of("up", "not-a-number")));
  }

  @Test
  void metricBindingsStillRequireAnExplicitCompleteValueMap() {
    var definition = definition();
    definition.setOperation(Function.OPERATION_READ);
    assertThrows(
        IllegalArgumentException.class,
        () -> MetricViewBindings.executionFunction(definition, new JSONObject()));
    assertThrows(
        IllegalArgumentException.class,
        () -> MetricViewBindings.executionWriteFunction(definition, new JSONObject()));
  }
}
