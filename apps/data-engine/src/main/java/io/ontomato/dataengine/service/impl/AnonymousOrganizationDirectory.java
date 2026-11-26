package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.OntologyNeighborFacts;
import io.ontomato.dataengine.service.OrganizationDirectory;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class AnonymousOrganizationDirectory implements OrganizationDirectory {
    @Override
    public Snapshot snapshot(String domainId) {
        return new Snapshot(List.of(), List.of(), List.of(), List.of(), List.of());
    }

    @Override
    public Counts countInDomain(String domainId) {
        return new Counts(0, 0, 0);
    }

    @Override
    public List<UnitInstance> unitInstances(String domainId) {
        return List.of();
    }

    @Override
    public List<PositionInstance> positionInstances(String domainId) {
        return List.of();
    }

    @Override
    public List<GrantInstance> grantInstances(String domainId) {
        return List.of();
    }

    @Override
    public List<UnitInstance> unitCenter(String domainId, String id) {
        return List.of();
    }

    @Override
    public List<PositionInstance> positionCenter(String domainId, String id) {
        return List.of();
    }

    @Override
    public OntologyNeighborFacts unitChildLinks(String domainId, String centerId, boolean outgoing, boolean incoming) {
        return new OntologyNeighborFacts(List.of(), List.of(), List.of());
    }

    @Override
    public OntologyNeighborFacts unitPositionLinks(String domainId, String centerId, boolean outgoing) {
        return new OntologyNeighborFacts(List.of(), List.of(), List.of());
    }

    @Override
    public OntologyNeighborFacts memberLinks(String domainId, MemberRelation relation, String centerId, boolean outgoing) {
        return new OntologyNeighborFacts(List.of(), List.of(), List.of());
    }

    @Override
    public Set<String> linkedMemberIds(String domainId, MemberRelation relation, String targetId) {
        return Set.of();
    }

    @Override
    public List<GrantInstance> grantCenter(String domainId, String id) {
        return List.of();
    }

    @Override
    public GrantNeighbors grantRecipientLinks(String domainId, String centerId, boolean outgoing, boolean position) {
        return new GrantNeighbors(List.of(), List.of(), List.of());
    }

    @Override
    public GrantNeighbors grantRoleLinks(String domainId, String centerId, boolean outgoing) {
        return new GrantNeighbors(List.of(), List.of(), List.of());
    }

    @Override
    public Set<String> linkedGrantRoleIds(String domainId, String grantId) {
        return Set.of();
    }
}
