package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.controller.DataController;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** Exercises public graph responses against an in-memory datasource, without services or databases. */
class LiveInstanceGraphPermissionsTest {
    @Test
    void allControllerEntriesApplyRowsAndColumnsBeforeCountsSearchAndExpansion() throws Exception {
        var fixture = new Fixture(List.of("Person", "Department", "Secret"));
        fixture.relate("worksIn", "Person", "Department");
        fixture.rows.get("Person").addAll(List.of(
                row("p1", "alice", "d1", "Hidden name"),
                row("p2", "bob", "d1", "Other owner"),
                row("p3", "alice", "d2", "Hidden name")));
        // Hidden neighbors must not influence pagination, truncation or overview quotas.
        for (int i = 0; i < 120; i++) fixture.rows.get("Person").add(row("hidden" + i, "bob", "d1", "Hidden name"));
        fixture.rows.get("Department").addAll(List.of(
                row("d1", "alice", "", "Visible department"), row("d2", "bob", "", "Secret department")));
        fixture.rows.get("Secret").add(row("s1", "alice", "", "Secret class"));
        var permission = permission(List.of("Person", "Department"), "alice", false);
        permission.getFieldPermissionByClassName("Department").getVisibleFields().add("name");

        var identity = mock(IdentityService.class);
        when(identity.getCurrentUserDataPermission()).thenReturn(permission);
        var service = new DataServiceImpl();
        ReflectionTestUtils.setField(service, "liveInstanceGraph", fixture.service);
        var controller = new DataController();
        ReflectionTestUtils.setField(controller, "identityService", identity);
        ReflectionTestUtils.setField(controller, "dataService", service);
        var user = mock(User.class); when(user.getDomainId()).thenReturn("test");
        try (var currentUser = mockStatic(SystemUtils.class)) {
            currentUser.when(SystemUtils::getCurUser).thenReturn(user);
            var summary = data(controller.instanceGraphSummary());
            assertEquals(3, summary.getIntValue("nodeCount"));
            assertEquals(Set.of("Person:p1", "Person:p3", "Department:d1"), ids(summary, "overviewNodes"));
            assertEquals(1, summary.getJSONArray("overviewEdges").size());
            assertFalse(summary.getBooleanValue("overviewEdgesTruncated"));
            assertEquals(2, summary.getJSONArray("classes").size());
            assertFalse(summary.toJSONString().contains("Hidden name"));
            assertFalse(summary.toJSONString().contains("Secret"));
            assertEquals(3, data(controller.instanceGraphStatistics()).getIntValue("nodeCount"));

            var search = data(controller.instanceGraphSearch(JSONObject.of("term", "Hidden name")));
            assertTrue(search.getJSONArray("nodes").isEmpty());
            assertFalse(search.getBooleanValue("hasMore"));
            search = data(controller.instanceGraphSearch(JSONObject.of("term", "p1")));
            assertEquals(Set.of("Person:p1"), ids(search, "nodes"));
            assertEquals("p1", search.getJSONArray("nodes").getJSONObject(0).getString("name"));

            var neighbors = data(controller.instanceGraphNeighborhood(JSONObject.of("id", "Department:d1", "direction", "incoming")));
            assertEquals(Set.of("Department:d1", "Person:p1"), ids(neighbors, "nodes"));
            assertEquals(1, neighbors.getIntValue("total"));
            assertNull(neighbors.get("nextOffset"));
            assertFalse(neighbors.toJSONString().contains("Hidden name"));
            var outgoing = data(controller.instanceGraphNeighborhood(JSONObject.of("id", "Person:p3", "direction", "outgoing")));
            assertEquals(Set.of("Person:p3"), ids(outgoing, "nodes"));
            assertEquals(0, outgoing.getIntValue("total"));
            assertFalse(controller.instanceGraphNeighborhood(JSONObject.of("id", "Person:p2")).getBooleanValue("success"));
            assertFalse(controller.instanceGraphNeighborhood(JSONObject.of("id", "Secret:s1")).getBooleanValue("success"));
        }
    }

    @Test
    void cachesAndConcurrentBuildsFollowEffectivePermissionsIncludingChanges() throws Exception {
        var fixture = new Fixture(List.of("Person"));
        fixture.rows.get("Person").addAll(List.of(row("a", "alice", "", "Alice name"), row("b", "bob", "", "Bob name")));
        var full = new UserDataPermission(); full.setFullData(true);
        var alice = permission(List.of("Person"), "alice", false);
        var unrestricted = CompletableFuture.supplyAsync(() -> fixture.query("summary", new JSONObject(), full));
        var restricted = CompletableFuture.supplyAsync(() -> fixture.query("summary", new JSONObject(), alice));
        assertEquals(2, unrestricted.join().getIntValue("nodeCount"));
        assertEquals(Set.of("Person:a"), ids(restricted.join(), "overviewNodes"));
        assertEquals(1, fixture.query("statistics", new JSONObject(), alice).getIntValue("nodeCount"));
        assertEquals("a", fixture.query("summary", new JSONObject(), alice).getJSONArray("overviewNodes").getJSONObject(0).getString("name"));

        alice.getFieldPermissionByClassName("Person").getVisibleFields().add("name");
        assertEquals("Alice name", fixture.query("summary", new JSONObject(), alice).getJSONArray("overviewNodes").getJSONObject(0).getString("name"));
        alice.getRowPermissions().clear();
        addOwnerRule(alice, "Person", "bob");
        assertEquals(Set.of("Person:b"), ids(fixture.query("summary", new JSONObject(), alice), "overviewNodes"));
        alice.getFieldPermissions().clear();
        var revoked = fixture.query("summary", new JSONObject(), alice);
        assertEquals(0, revoked.getIntValue("nodeCount"));
        assertTrue(revoked.getJSONArray("classes").isEmpty());
        assertTrue(revoked.getJSONArray("overviewNodes").isEmpty());
        assertTrue(fixture.query("search", new JSONObject(), alice).getJSONArray("nodes").isEmpty());
    }

    @Test
    void aggregateOnlyPrimaryKeysAllowFilteredCountsButNeverNodeIdsOrRelations() throws Exception {
        var fixture = new Fixture(List.of("CountOnly", "NoCount"));
        fixture.relate("linked", "CountOnly", "NoCount");
        fixture.rows.get("CountOnly").addAll(List.of(row("secret1", "alice", "other", "Label"), row("secret2", "bob", "other", "Label")));
        fixture.rows.get("NoCount").add(row("other", "alice", "", "Label"));
        var permission = permission(List.of("CountOnly"), "alice", true);
        permission.addFieldPermission(new FieldPermission("NoCount", Set.of("name"), Set.of()));
        var summary = fixture.query("summary", new JSONObject(), permission);
        assertEquals(1, summary.getIntValue("nodeCount"));
        assertEquals(1, summary.getJSONArray("classes").size());
        var countOnly = summary.getJSONArray("classes").getJSONObject(0);
        assertEquals("CountOnly", countOnly.getString("class"));
        assertEquals(1, countOnly.getIntValue("instanceCount"));
        assertEquals(0, countOnly.getIntValue("sampleCount"));
        assertTrue(summary.getJSONArray("overviewNodes").isEmpty());
        assertTrue(summary.getJSONArray("overviewEdges").isEmpty());
        assertTrue(summary.getJSONArray("relationTypes").isEmpty());
        assertFalse(summary.toJSONString().contains("secret1"));
        assertEquals(1, fixture.query("statistics", new JSONObject(), permission).getIntValue("nodeCount"));
        assertTrue(fixture.query("search", new JSONObject(), permission).getJSONArray("nodes").isEmpty());
        assertFalse(fixture.service.query("neighborhood", JSONObject.of("id", "CountOnly:secret1"), permission, "test").getBooleanValue("success"));
    }

    @Test
    void parallelCountsSamplesAndRelationsKeepTheSamePermissionSnapshot() throws Exception {
        List<String> names = java.util.stream.IntStream.range(0, 7).mapToObj(i -> "C" + i).toList();
        var fixture = new Fixture(names);
        for (String name : names) {
            fixture.rows.get(name).addAll(List.of(row("visible", "alice", "visible", "Hidden label"), row("hidden", "bob", "hidden", "Hidden label")));
            fixture.relate("r" + name, name, names.get((names.indexOf(name) + 1) % names.size()));
        }
        var permission = permission(names, "alice", false);
        var summary = fixture.query("summary", new JSONObject(), permission);
        assertEquals(7, summary.getIntValue("nodeCount"));
        assertEquals(7, summary.getJSONArray("overviewNodes").size());
        assertEquals(7, summary.getJSONArray("overviewEdges").size());
        assertFalse(summary.toJSONString().contains("hidden"));
        assertFalse(summary.toJSONString().contains("Hidden label"));
        assertEquals(7, fixture.query("statistics", new JSONObject(), permission).getIntValue("nodeCount"));
        var stale = fixture.service.query("search", JSONObject.of("version", "stale"), permission, "test");
        assertEquals("GRAPH_VERSION_CHANGED", stale.getString("code"));
    }

    private static JSONObject data(JSONObject response) {
        assertTrue(response.getBooleanValue("success"), response.toJSONString());
        return response.getJSONObject("data");
    }

    private static Set<String> ids(JSONObject result, String key) {
        return result.getJSONArray(key).stream().map(JSONObject::from).map(n -> n.getString("id")).collect(java.util.stream.Collectors.toSet());
    }

    private static JSONObject row(String id, String owner, String parent, String name) {
        return JSONObject.of("id", id, "owner", owner, "parent_id", parent, "name", name, "title", "Private title");
    }

    private static UserDataPermission permission(List<String> names, String owner, boolean aggregateOnly) {
        var permission = new UserDataPermission();
        for (String name : names) {
            var fields = new FieldPermission(name);
            (aggregateOnly ? fields.getGroupableColumns() : fields.getVisibleFields()).add("id");
            permission.addFieldPermission(fields);
            addOwnerRule(permission, name, owner);
        }
        return permission;
    }

    private static void addOwnerRule(UserDataPermission permission, String name, String owner) {
        permission.addRowPermission("role", name, JSONObject.of("operator", "logic", "and", JSONArray.of(
                JSONObject.of("field", "owner", "operator", "=", "value", owner))).toJSONString());
    }

    /** A small datasource double: evaluates filters and joins before aggregation and pagination. */
    private static final class Fixture {
        final Map<String, List<JSONObject>> rows = new LinkedHashMap<>();
        final JSONObject relationships = new JSONObject();
        final LiveInstanceGraph service;

        Fixture(List<String> names) throws Exception {
            var definitions = new JSONArray();
            for (String name : names) {
                rows.put(name, new ArrayList<>());
                definitions.add(JSONObject.of("className", name, "attrs", JSONArray.of(
                        JSONObject.of("name", "id", "primaryKey", true),
                        JSONObject.of("name", "name", "bizzkey", true, "type", "varchar"),
                        JSONObject.of("name", "title", "type", "varchar"),
                        JSONObject.of("name", "owner"), JSONObject.of("name", "parent_id"))));
            }
            var admin = mock(AdminService.class);
            when(admin.getJSONRule("test")).thenReturn(JSONObject.of("classDef", definitions, "relationship_rule", relationships));
            var configs = mock(BusinessConfigService.class);
            when(configs.get("test")).thenReturn(new BusinessConfig());
            var adapter = mock(DataAdapter.class);
            when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> execute(call.getArgument(0)));
            var adapters = mock(DataAdapterRegistry.class);
            when(adapters.create(any(), any())).thenReturn(adapter);
            service = new LiveInstanceGraph(admin, configs, adapters);
        }

        void relate(String name, String from, String to) {
            relationships.put(name, JSONObject.of("fromclass", from, "toclass", to, "fromField", "parent_id", "toField", "id"));
        }

        JSONObject query(String operation, JSONObject request, UserDataPermission permission) {
            return data(service.query(operation, request, permission, "test"));
        }

        String execute(String input) {
            var step = JSONArray.parseArray(input).getJSONObject(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            var pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
            var objects = pattern.getJSONArray("objects");
            List<Map<String, JSONObject>> matches = new ArrayList<>(List.of(Map.of()));
            for (Object value : objects) {
                var object = JSONObject.from(value);
                List<Map<String, JSONObject>> next = new ArrayList<>();
                for (var match : matches) for (var row : rows.get(object.getString("class"))) {
                    if (!matches(row, object.getJSONObject("conditions"))) continue;
                    var joined = new LinkedHashMap<>(match);
                    joined.put(object.getString("variable"), row);
                    next.add(joined);
                }
                matches = next;
            }
            if (pattern.getJSONArray("relationship") != null) for (Object value : pattern.getJSONArray("relationship")) {
                var relation = JSONObject.from(value);
                var rule = relationships.getJSONObject(relation.getJSONArray("type").getString(0));
                String from = objects.getJSONObject(relation.getIntValue("from")).getString("variable");
                String to = objects.getJSONObject(relation.getIntValue("to")).getString("variable");
                matches.removeIf(match -> !Objects.equals(match.get(from).get(rule.getString("fromField")), match.get(to).get(rule.getString("toField"))));
            }
            var output = step.getJSONObject("output");
            var fields = output.getJSONArray("fields");
            JSONArray answer = new JSONArray();
            if ("count".equalsIgnoreCase(fields.getJSONObject(0).getString("function"))) {
                answer.add(JSONObject.of(fields.getJSONObject(0).getString("as"), matches.size()));
            } else {
                int limit = output.getJSONObject("limit").getIntValue("count");
                for (var match : matches.stream().limit(limit).toList()) {
                    var projected = new JSONObject();
                    for (Object value : fields) {
                        var field = JSONObject.from(value);
                        projected.put(field.getString("as"), match.get(field.getString("variable")).get(field.getString("field")));
                    }
                    answer.add(projected);
                }
            }
            return JSONArray.of(JSONObject.of("answer", answer)).toJSONString();
        }

        private static boolean matches(JSONObject row, JSONObject condition) {
            if (condition == null) return true;
            if (condition.containsKey("properties")) return matches(row, condition.getJSONObject("properties"));
            if (condition.containsKey("and")) return condition.getJSONArray("and").stream().allMatch(c -> matches(row, JSONObject.from(c)));
            if (condition.containsKey("or")) return condition.getJSONArray("or").stream().anyMatch(c -> matches(row, JSONObject.from(c)));
            Object value = row.get(condition.getString("field")), expected = condition.get("value");
            return switch (condition.getString("operator").toLowerCase()) {
                case "=" -> Objects.equals(value, expected);
                case "!=" -> !Objects.equals(value, expected);
                case "in" -> ((List<?>) expected).contains(value);
                case "like" -> value != null && value.toString().contains(expected.toString());
                default -> throw new AssertionError("Unsupported fixture condition: " + condition);
            };
        }
    }
}
