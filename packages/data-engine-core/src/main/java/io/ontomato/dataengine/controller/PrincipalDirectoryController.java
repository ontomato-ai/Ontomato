package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.IdentityPrincipalDirectory;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class PrincipalDirectoryController {
    public static final String PATH = "/platform/identity/principals";

    private final IdentityService identity;
    private final IdentityPrincipalDirectory directory;

    public PrincipalDirectoryController(IdentityService identity, IdentityPrincipalDirectory directory) {
        this.identity = identity;
        this.directory = directory;
    }

    public record DirectoryRead(String kind, List<String> ids, String keyword, Integer limit) {}
    public record DirectoryEntry(String id, String name, String kind) {}
    public record DirectoryResult(List<DirectoryEntry> options) {}

    @Owned
    @PostMapping(PATH)
    public DirectoryResult read(@RequestBody DirectoryRead request) {
        var user = identity.getCurrentUser();
        if (user == null || user.getDomainId() == null || user.getDomainId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
        }

        String domainId = user.getDomainId();
        String kind = request.kind();
        boolean members = "member".equals(kind);
        if (!members && !"role".equals(kind)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected member or role kind");
        }
        if (request.ids() != null) {
            if (!members || request.keyword() != null || request.limit() != null
                    || request.ids().stream().anyMatch(id -> id == null || id.isBlank())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected member IDs for name resolution");
            }
            var names = directory.principalNames(domainId, request.ids());
            return new DirectoryResult(request.ids().stream().distinct()
                    .filter(names::containsKey)
                    .map(id -> new DirectoryEntry(id, names.get(id), kind))
                    .toList());
        }

        if (request.limit() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a search limit");
        }
        int limit = Math.max(1, Math.min(request.limit(), 100));
        String keyword = request.keyword() == null ? "" : request.keyword().strip();
        var candidates = members ? directory.searchPrincipals(domainId, keyword, limit)
                : directory.searchRoles(domainId, keyword, limit);
        return new DirectoryResult(candidates.stream()
                .map(option -> new DirectoryEntry(option.id(), option.name(), kind))
                .toList());
    }
}
