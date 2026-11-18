package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.service.PythonAuthority;
import io.ontomato.dataengine.service.PythonExecuteService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class WriteClassScopeTest {
  @Test
  void parameterObjectTypesBelongToTheWriteScope() {
    assertEquals(
        List.of("monthly_expense_stat", "expense_result"),
        ABCProgramServiceImpl.writeClassScope(writeFunction()));
  }

  @Test
  void aWriteFunctionWithoutDeclarationsHasAnEmptyScope() {
    var function = new Function();
    function.setOperation(Function.OPERATION_WRITE);
    assertEquals(List.of(), ABCProgramServiceImpl.writeClassScope(function));
  }

  @Test
  void theGrantCarriesEveryDeclaredWriteClass() throws Exception {
    var authority = new AtomicReference<PythonAuthority>();
    var python = mock(PythonExecuteService.class);
    when(python.execute(anyString(), anyString(), anyInt(), anyString(), any(), any(), any()))
        .thenAnswer(
            call -> {
              authority.set(call.getArgument(4));
              var result = new PythonExecuteResult();
              result.setResult("{\"answer\":{}}");
              return result;
            });
    var service = new ABCProgramServiceImpl();
    ReflectionTestUtils.setField(service, "pythonExecuteService", python);

    service.execute(
        "run", writeFunction(), "user", new UserDataPermission(), null, "en", 1, "domain");

    assertEquals(
        List.of("monthly_expense_stat", "expense_result"), authority.get().classNames());
  }

  private static Function writeFunction() {
    var years = new Parameter();
    years.setName("years");
    years.setType(Parameter.TYPE_STRING);
    years.setClassNames(List.of("monthly_expense_stat"));
    var returnDef = new ReturnDef();
    returnDef.setClassNames(List.of("expense_result"));
    var function = new Function();
    function.setOperation(Function.OPERATION_WRITE);
    function.setDomainId("domain");
    function.setParameters(List.of(years));
    function.setReturnDef(returnDef);
    function.setCode("# ontomato-python:2\nprint('x')");
    return function;
  }
}
