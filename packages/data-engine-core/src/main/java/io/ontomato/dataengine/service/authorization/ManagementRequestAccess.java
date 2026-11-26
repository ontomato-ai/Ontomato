package io.ontomato.dataengine.service.authorization;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.util.SystemUtils;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.server.ResponseStatusException;

@Component
public final class ManagementRequestAccess {
    /** The handler owns admission and must check it before reading or changing managed state. */
    @Target(ElementType.METHOD)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface Owned {}

    private final IdentityService identity;
    private final AuthorizationService authorization;
    private final ManagementOperations operations;

    public ManagementRequestAccess(IdentityService identity, AuthorizationService authorization, ManagementOperations operations) {
        this.identity = identity;
        this.authorization = authorization;
        this.operations = operations;
    }

    public User require(String operationId) {
        return require(operationId, false);
    }

    /** Preserves the domainless system administrator's access to deployment-wide records. */
    public void requireSystemOrDomain(String operationId) {
        require(operationId, true);
    }

    private User require(String operationId, boolean allowSystemAdministrator) {
        if (operationId == null || operationId.isBlank())
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Invalid management operation");
        try {
            operations.require(operationId);
        } catch (IllegalArgumentException invalid) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Invalid management operation", invalid);
        }
        var request = RequestContextHolder.getRequestAttributes();
        if (request == null)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "A current user credential is required");
        if (request.getAttribute(QueryGrantService.ATTRIBUTE, RequestAttributes.SCOPE_REQUEST) != null)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A current user credential is required");

        var user = identity.getCurrentUser();
        if (user == null || !user.isEnable() || user.getId() == null || user.getId().isBlank())
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "A current user credential is required");
        identity.getCurrentCredentialExpiresAt();
        String domain = user.getDomainId();
        if (allowSystemAdministrator && domain == null && SystemUtils.SUPER_ADMIN.equals(user.getId())) return user;
        if (domain == null || domain.isBlank())
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "A current domain credential is required");

        var actor = new AuthorizationService.VerifiedIdentity(domain, identity.workbenchSubjectId(user),
                AuthorizationService.CredentialLimit.UNRESTRICTED);
        var decision = authorization.decide(authorization.resolveSubject(actor), new AuthorizationService.Management(operationId));
        if (!decision.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, decision.reason());
        return user;
    }
}
