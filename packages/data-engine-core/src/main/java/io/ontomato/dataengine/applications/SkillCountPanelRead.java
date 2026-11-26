package io.ontomato.dataengine.applications;

import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Management;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Configuration(proxyBeanMethods = false)
class SkillCountPanelRead {
    @Bean
    WorkbenchPanelRead skillCountRead(AuthorizationService authorization) {
        return new WorkbenchPanelRead("platform:Skill", "count", (subject, parameters) -> {
            requireLibraryRead(authorization, subject);
            return true;
        });
    }

    @Bean
    WorkbenchPanelRead skillDeleteAccess(AuthorizationService authorization) {
        return new WorkbenchPanelRead("platform:Skill", "deleteAccess", (subject, parameters) -> changeAccess(authorization, subject));
    }

    @Bean
    WorkbenchPanelRead skillLibraryQueryWithDeleteAccess(AuthorizationService authorization) {
        return new WorkbenchPanelRead("platform:Skill", "queryWithDeleteAccess", (subject, parameters) -> {
            requireLibraryRead(authorization, subject);
            return changeAccess(authorization, subject);
        });
    }

    private static AuthorizationService.Decision changeAccess(AuthorizationService authorization, AuthorizationService.SubjectContext subject) {
        return authorization.decide(subject, new Management("skills.library.change"));
    }

    private static void requireLibraryRead(AuthorizationService authorization, AuthorizationService.SubjectContext subject) {
        var decision = authorization.decide(subject, new Management("skills.library.read"));
        if (!decision.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, decision.reason());
    }
}
