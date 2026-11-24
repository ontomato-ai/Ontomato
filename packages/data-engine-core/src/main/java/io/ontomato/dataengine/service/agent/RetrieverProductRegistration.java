package io.ontomato.dataengine.service.agent;

import io.ontomato.dataengine.service.DomainSvc;
import io.ontomato.dataengine.service.ProductGrantService;
import java.util.List;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class RetrieverProductRegistration {
    private final ProductGrantService grants;

    public RetrieverProductRegistration(ProductGrantService grants) {
        this.grants = grants;
    }

    @Component
    static class Startup {
        private final DomainSvc domains;
        private final RetrieverProductRegistration registration;

        Startup(DomainSvc domains, RetrieverProductRegistration registration) {
            this.domains = domains;
            this.registration = registration;
        }

        @EventListener(ApplicationReadyEvent.class)
        public void registerExistingDomains() {
            domains.listDomainIds().forEach(registration::registerDomain);
        }
    }

    public void registerDomain(String domainId) {
        grants.register(domainId, OntologyAgentStore.RETRIEVER, null, true, List.of("use", "view", "edit"), true);
    }
}
