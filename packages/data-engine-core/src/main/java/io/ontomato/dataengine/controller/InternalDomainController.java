package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import io.ontomato.dataengine.service.DomainSvc;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Owned
public class InternalDomainController {
    public static final String IDS_PATH = "/internal/domains/ids";

    private final DomainSvc domains;
    private final WorkbenchServiceAuthentication authentication;

    public InternalDomainController(DomainSvc domains, WorkbenchServiceAuthentication authentication) {
        this.domains = domains;
        this.authentication = authentication;
    }

    @GetMapping(IDS_PATH)
    public List<String> ids(HttpServletRequest request) {
        authentication.authenticate(request);
        return domains.listDomainIds();
    }
}
