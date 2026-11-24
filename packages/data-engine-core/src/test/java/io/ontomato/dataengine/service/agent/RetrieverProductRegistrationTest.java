package io.ontomato.dataengine.service.agent;

import static org.mockito.Mockito.*;

import io.ontomato.dataengine.service.DomainSvc;
import io.ontomato.dataengine.service.ProductGrantService;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

class RetrieverProductRegistrationTest {
    @Test void readinessRegistersTheRetrieverForEveryDomainThroughTheGrantService() {
        var domains = mock(DomainSvc.class);
        var grants = mock(ProductGrantService.class);
        when(domains.listDomainIds()).thenReturn(List.of("domain-a", "domain-b"));
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean(DomainSvc.class, () -> domains);
            context.getBeanFactory().registerSingleton("productGrantService", grants);
            context.register(RetrieverProductRegistration.class, RetrieverProductRegistration.Startup.class);
            context.refresh();
            verify(grants, never()).register(anyString(), anyString(), isNull(), anyBoolean(), anyList(), anyBoolean());

            context.publishEvent(new ApplicationReadyEvent(new SpringApplication(), new String[0], context, Duration.ZERO));

            for (String domain : List.of("domain-a", "domain-b"))
                verify(grants).register(domain, OntologyAgentStore.RETRIEVER, null, true, List.of("use", "view", "edit"), true);
        }
    }
}
