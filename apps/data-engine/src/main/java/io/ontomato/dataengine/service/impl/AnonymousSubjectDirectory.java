package io.ontomato.dataengine.service.impl;

import java.util.List;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.SubjectDirectory;

/**
 * The open-source answer: there are no accounts in a domain, so no subject holds a role.
 *
 * <p>Empty rather than a synthetic "anonymous" subject: the open-source edition records no provenance
 * either (its writes carry no subject), so inventing one here would put a name on actions nobody signed.
 */
@Component
public class AnonymousSubjectDirectory implements SubjectDirectory {

    @Override
    public List<Subject> subjectsInDomain(String domainId) {
        return List.of();
    }
}
