package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ProductSourceFunctionsTest {
    private ProductSourceFunctions.Artifact artifact(){return new ProductSourceFunctions.Artifact("app-example","12345678-1234-1234-1234-123456789012","Example",List.of(new ProductSourceFunctions.Dependency("metric","count","a".repeat(64))),List.of(new ProductSourceFunctions.File("index.html","b".repeat(64))),List.of("1.1.0"),2);}
    @Test void browserArtifactsUseIndependentDeterministicFunctionIdentityAndCannotExecuteAsPython(){
        assertDoesNotThrow(()->ProductSourceFunctions.validate(artifact()));
        assertNotEquals(ProductSourceFunctions.identity("one","app-example",artifact().releaseId()),ProductSourceFunctions.identity("two","app-example",artifact().releaseId()));
        var function=new io.ontomato.dataengine.bean.function.Function();function.setOperation(io.ontomato.dataengine.bean.function.Function.OPERATION_PRODUCT);
        assertThrows(IllegalArgumentException.class,()->io.ontomato.dataengine.dao.FunctionDao.requireSupported(function,"en"));
    }
    @Test void aPublishedArtifactCannotBeReplacedAtTheSameReleaseIdentity(){
        var db=mock(JdbcTemplate.class);when(db.queryForList(anyString(),eq(String.class),anyString(),eq("domain"))).thenReturn(List.of("{\"changed\":true}"));
        assertThrows(IllegalArgumentException.class,()->new ProductSourceFunctions(db).register("domain",artifact()));
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void ordinaryFunctionAuthoringCannotReplaceOrDeleteAPublishedBrowserArtifact(){
        var dao=mock(io.ontomato.dataengine.dao.FunctionDao.class);var service=new io.ontomato.dataengine.service.impl.FunctionServiceImpl();
        org.springframework.test.util.ReflectionTestUtils.setField(service,"functionDao",dao);
        var lang=mock(LangService.class);when(lang.get(anyString(),anyString())).thenAnswer(call->call.getArgument(1));org.springframework.test.util.ReflectionTestUtils.setField(service,"langService",lang);
        var published=new io.ontomato.dataengine.bean.function.Function();published.setId("artifact");published.setOperation(io.ontomato.dataengine.bean.function.Function.OPERATION_PRODUCT);published.setDomainId("domain");
        when(dao.queryById("artifact")).thenReturn(published);
        var replacement=new io.ontomato.dataengine.bean.function.Function();replacement.setId("artifact");replacement.setOperation(io.ontomato.dataengine.bean.function.Function.OPERATION_WRITE);replacement.setDomainId("domain");
        assertEquals("FUNCTION_PRODUCT_IMMUTABLE",assertThrows(OwnerRefusal.class,()->service.save(replacement,"en")).code());
        assertEquals("FUNCTION_PRODUCT_IMMUTABLE",assertThrows(OwnerRefusal.class,()->service.delete("artifact","domain","en")).code());
        verify(dao,never()).save(any(),anyString());verify(dao,never()).delete(anyString());
    }
    @Test void retryingTheSameArtifactResolvesItsOriginalIdentity(){
        var db=mock(JdbcTemplate.class);
        when(db.queryForList(anyString(),eq(String.class),anyString(),eq("domain"))).thenReturn(List.of(com.alibaba.fastjson2.JSON.toJSONString(artifact())));
        assertEquals(ProductSourceFunctions.identity("domain","app-example",artifact().releaseId()),new ProductSourceFunctions(db).register("domain",artifact()));
    }
    @Test void triggerDependenciesAreExplicitGovernedArtifactInterfaces(){
        var source=artifact();
        var trigger=new ProductSourceFunctions.Artifact(source.applicationId(),source.releaseId(),source.name(),List.of(new ProductSourceFunctions.Dependency("trigger","entered","a".repeat(64))),source.files(),source.sdkVersions(),source.messageBridge());
        assertDoesNotThrow(()->ProductSourceFunctions.validate(trigger));
    }
}
