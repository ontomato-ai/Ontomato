package io.ontomato.dataengine.service.authorization;

import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import io.ontomato.dataengine.service.OwnerRefusal;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Grants or proposes USE inside the definition owner's first publication transaction. */
public interface DefinitionFirstPublication {
    enum Audience { domain, policy }

    record Selection(Audience kind, String policyId) {
        public Selection {
            if (kind == null || (kind == Audience.domain ? policyId != null
                    : policyId == null || policyId.isBlank()))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Select domain or supply the target policy id for policy.");
        }
    }

    boolean requiresSelection();

    void grantUse(SubjectContext subject, ObjectTarget target, Selection selection);

    default void requireSelection(Selection selection) {
        if (requiresSelection() && selection == null)
            throw new OwnerRefusal("FIRST_PUBLICATION_AUDIENCE_REQUIRED", "Choose who can use this definition on first publication.");
    }
}
