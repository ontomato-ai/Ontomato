package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.AgentPrincipalService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
public class AgentPrincipalController {
    public static final String EXECUTION_PATH="/agent-principals/execution";
    public static final String USER_SCOPED_REGISTRATION_PATH="/agent-principals/register-user-scoped";
    private final AgentPrincipalService principals;
    private final WorkbenchServiceAuthentication authentication;
    private final io.ontomato.dataengine.service.ProductGrantService productGrants;
    @org.springframework.beans.factory.annotation.Autowired
    public AgentPrincipalController(AgentPrincipalService principals,WorkbenchServiceAuthentication authentication,io.ontomato.dataengine.service.ProductGrantService productGrants){this.principals=principals;this.authentication=authentication;this.productGrants=productGrants;}
    public record DelegatedExecutionRequest(String domainId,String principalId,String initiatorId,long expiresAt) {}
    public record UserScopedRegistration(String domainId,String principalId,String name) {}
    @PostMapping(USER_SCOPED_REGISTRATION_PATH) public Object registerUserScoped(HttpServletRequest request,@RequestBody UserScopedRegistration body){authentication.authenticate(request);principals.registerUserScoped(body.domainId(),body.principalId(),body.name());return Map.of("success",true);}
    @org.springframework.beans.factory.annotation.Autowired private io.ontomato.dataengine.service.IdentityService identity;
    public record UserScopedCheck(String id) {}
    @PostMapping("/agent-principals/check-user-scoped") public Object userScoped(@RequestBody UserScopedCheck body){var user=identity.getCurrentUser();if(user==null||user.getDomainId()==null)return Map.of("allowed",false);return Map.of("allowed",principals.find(user.getDomainId(),body.id())!=null&&principals.userScoped(user.getDomainId(),body.id())&&productGrants.allowed(body.id(),"use"));}
    @PostMapping(EXECUTION_PATH) public Object execution(HttpServletRequest request,@RequestBody DelegatedExecutionRequest body){authentication.authenticate(request);if(!productGrants.allowedFor(body.domainId(),body.initiatorId(),body.principalId(),"use"))throw AgentPrincipalService.denied("Agent use Grant required");return Map.of("token",principals.issue(body.domainId(),body.principalId(),body.expiresAt()),"expiresAt",body.expiresAt());}
}
