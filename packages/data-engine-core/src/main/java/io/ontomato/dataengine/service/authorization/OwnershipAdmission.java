package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

final class OwnershipAdmission {
    enum Result { ALLOWED, PRIVATE_DRAFT, PASS_TO_POLICY }

    private OwnershipAdmission() {}

    static Result decide(String userId, Kind kind, Verb verb, OwnerFacts owner, boolean approvedSandbox) {
        boolean author = userId.equals(owner.ownerId()) || owner.coauthorIds().contains(userId);
        if (owner.state() == DefinitionState.DRAFT && !author) return Result.PRIVATE_DRAFT;
        return author && authorAllowed(kind, verb, approvedSandbox) ? Result.ALLOWED : Result.PASS_TO_POLICY;
    }

    static boolean authorAllowed(Kind kind, Verb verb, boolean approvedSandbox) {
        if (kind == Kind.ACTION) return verb == Verb.EDIT || verb == Verb.EXECUTE && approvedSandbox;
        return verb == Verb.USE || verb == Verb.VIEW || verb == Verb.EDIT;
    }
}
