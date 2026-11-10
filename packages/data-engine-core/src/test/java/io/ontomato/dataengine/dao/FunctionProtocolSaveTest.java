package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.ProgramExecutionException;
import io.ontomato.dataengine.service.QueryPackage;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class FunctionProtocolSaveTest {
  @Test
  void savesOnlyExecutablePythonWhileReadPackagesNeedNoPythonHeader() {
    var dao = new FunctionDao();
    var jdbc = mock(JdbcTemplate.class);
    ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
    var function = new Function();
    for (String operation : new String[] {Function.OPERATION_WRITE, Function.OPERATION_READ}) {
      function.setOperation(operation);
      function.setCode("print('legacy')");
      var error = assertThrows(ProgramExecutionException.class, () -> dao.save(function, "zh"));
      assertEquals(ProgramExecutionException.Reason.RETIRED_PROTOCOL, error.reason());
      assertEquals(error.reason().message("zh"), error.getMessage());
    }
    verifyNoInteractions(jdbc);
    function.setOperation(Function.OPERATION_WRITE);
    function.setCode("# ontomato-python:2\nprint('current')");
    assertSame(function, dao.save(function, "en"));
    function.setOperation(Function.OPERATION_READ);
    function.setCode(null);
    function.setQueryPackage(QueryPackage.fromDsl("{\"answer\":{\"steps\":[]}}"));
    assertSame(function, dao.save(function, "en"));
  }
}
