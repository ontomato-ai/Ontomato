package io.ontomato.dataengine.migration;

import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.DomainSvc;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** Initialize local configuration for the domains already present when the new read paths take effect. */
@Component
@RequiredArgsConstructor
public class DomainConfigurationInitialization implements DataEngineMigration {

    private final DomainSvc domains;
    private final AdminService ontology;
    private final BusinessConfigService businessConfig;

    @Override
    public String id() {
        return "20261125-domain-configuration-initialization";
    }

    @Override
    public void run() {
        for (String domainId : domains.listDomainIds()) {
            ontology.initializeOntologyRule(domainId);
            businessConfig.initializeBusinessConfig(domainId);
        }
    }
}
