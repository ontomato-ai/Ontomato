package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.OrganizationDirectory;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class AnonymousOrganizationDirectory implements OrganizationDirectory {
    @Override
    public Snapshot snapshot(String domainId) {
        return new Snapshot(List.of(), List.of(), List.of(), List.of(), List.of());
    }
}
