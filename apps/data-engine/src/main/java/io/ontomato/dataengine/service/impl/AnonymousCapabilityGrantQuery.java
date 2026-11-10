package io.ontomato.dataengine.service.impl;

import java.util.List;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.CapabilityGrantQuery;

/**
 * The open-source answer: no roles exist, so nothing was ever granted.
 *
 * <p>Returns an empty list rather than {@code null} — a reader that has to special-case "no answer"
 * ends up treating absence as an error, and an edition without roles is not an error.</p>
 */
@Component
public class AnonymousCapabilityGrantQuery implements CapabilityGrantQuery {

    @Override
    public List<Grant> grantsInDomain(String domainId) {
        return List.of();
    }
}
