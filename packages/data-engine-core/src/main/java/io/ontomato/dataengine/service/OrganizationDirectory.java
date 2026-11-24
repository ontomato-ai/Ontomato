package io.ontomato.dataengine.service;

import java.util.List;

/** Reads the organization's graph records in one domain. */
public interface OrganizationDirectory {
    record Unit(String id, String name, String code, String parentId) {}
    record Position(String id, String name, String orgId) {}
    record Membership(String userId, String orgId) {}
    record PositionAssignment(String userId, String positionId) {}
    record Grant(String id, String grantType, String sourceId, List<String> roleIds) {}
    record Snapshot(List<Unit> units, List<Position> positions, List<Membership> memberships,
        List<PositionAssignment> positionAssignments, List<Grant> grants) {}

    Snapshot snapshot(String domainId);
}
