package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.AgentPrincipalService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
public class AgentPrincipalController {
    public static final String EXECUTION_PATH="/agent-principals/execution";
    private final AgentPrincipalService principals;
    private final WorkbenchServiceAuthentication authentication;
    private final io.ontomato.dataengine.service.ProductGrantService productGrants;
    @org.springframework.beans.factory.annotation.Autowired
    public AgentPrincipalController(AgentPrincipalService principals,WorkbenchServiceAuthentication authentication,io.ontomato.dataengine.service.ProductGrantService productGrants){this.principals=principals;this.authentication=authentication;this.productGrants=productGrants;}
    public record DelegatedExecutionRequest(String domainId,String principalId,String initiatorId,long expiresAt) {}
    @PostMapping(EXECUTION_PATH) public Object execution(HttpServletRequest request,@RequestBody DelegatedExecutionRequest body){authentication.authenticate(request);if(!productGrants.allowedFor(body.domainId(),body.initiatorId(),body.principalId(),"use"))throw AgentPrincipalService.denied("Agent use Grant required");return Map.of("token",principals.issue(body.domainId(),body.principalId(),body.expiresAt()),"expiresAt",body.expiresAt());}
}
