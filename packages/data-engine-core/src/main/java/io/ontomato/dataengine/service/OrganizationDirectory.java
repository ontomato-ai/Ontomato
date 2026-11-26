package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Set;

/** Reads the organization's graph records in one domain. */
public interface OrganizationDirectory {
    record Unit(String id, String name, String code, String parentId) {}
    record Position(String id, String name, String orgId) {}
    record Membership(String userId, String orgId) {}
    record PositionAssignment(String userId, String positionId) {}
    record Grant(String id, String grantType, String sourceId, List<String> roleIds) {}
    record Snapshot(List<Unit> units, List<Position> positions, List<Membership> memberships,
        List<PositionAssignment> positionAssignments, List<Grant> grants) {}

    record Counts(long units, long positions, long grants) {}

    record UnitInstance(String id, String name, String code) {}
    record PositionInstance(String id, String name, String orgName) {}
    record GrantInstance(String id, String grantType, String sourceId, String sourceName) {}

    Snapshot snapshot(String domainId);

    Counts countInDomain(String domainId);

    List<UnitInstance> unitInstances(String domainId);
    List<PositionInstance> positionInstances(String domainId);
    List<GrantInstance> grantInstances(String domainId);

    List<UnitInstance> unitCenter(String domainId, String id);
    List<PositionInstance> positionCenter(String domainId, String id);
    OntologyNeighborFacts unitChildLinks(String domainId, String centerId, boolean outgoing, boolean incoming);
    OntologyNeighborFacts unitPositionLinks(String domainId, String centerId, boolean outgoing);

    enum MemberRelation { UNIT_MEMBERSHIP, POSITION_ASSIGNMENT }

    OntologyNeighborFacts memberLinks(String domainId, MemberRelation relation, String centerId, boolean outgoing);
    Set<String> linkedMemberIds(String domainId, MemberRelation relation, String targetId);

    record GrantNeighbors(List<OntologyNeighborFacts.Link> links, List<GrantInstance> grants,
        List<OntologyNeighborFacts.Name> toNames) {}

    List<GrantInstance> grantCenter(String domainId, String id);
    GrantNeighbors grantRecipientLinks(String domainId, String centerId, boolean outgoing, boolean position);
    GrantNeighbors grantRoleLinks(String domainId, String centerId, boolean outgoing);
    Set<String> linkedGrantRoleIds(String domainId, String grantId);
}
