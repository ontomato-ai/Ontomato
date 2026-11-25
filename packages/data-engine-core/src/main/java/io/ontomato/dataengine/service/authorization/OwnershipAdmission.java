package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

final class OwnershipAdmission {
    enum Result { ALLOWED, PRIVATE_DRAFT, PASS_TO_POLICY }

    private OwnershipAdmission() {}

    static Result decide(String userId, Kind kind, Verb verb, OwnerFacts owner, boolean approvedSandbox) {
        boolean author = userId.equals(owner.ownerId()) || owner.coauthorIds().contains(userId);
        if (owner.state() == DefinitionState.DRAFT && !author) return Result.PRIVATE_DRAFT;
        if (!author) return Result.PASS_TO_POLICY;
        if (kind == Kind.ACTION) {
            if (verb == Verb.EDIT || verb == Verb.EXECUTE && approvedSandbox) return Result.ALLOWED;
            return Result.PASS_TO_POLICY;
        }
        return switch (verb) {
            case USE, VIEW, EDIT -> Result.ALLOWED;
            default -> Result.PASS_TO_POLICY;
        };
    }
}
