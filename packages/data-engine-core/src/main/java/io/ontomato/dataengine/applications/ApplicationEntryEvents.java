package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.migration.DataEngineMigration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public record ApplicationEntryEvents(JdbcTemplate db) implements DataEngineMigration {
    private static final String TYPE = "application.entry-roots.changed";

    public record Roots(List<String> panelIds, List<String> agentIds) {
        static final Roots EMPTY = new Roots(List.of(), List.of());
    }
    public record EntryRoots(String entryId, Roots roots) {}
    public sealed interface PlatformEvent permits Event, AccountDeleted {
        String sequence();
    }
    public record Event(String type, String sequence, String occurredAt, String domainId, String actorId,
                        String entryId, Roots before, Roots after) implements PlatformEvent {}
    public record AccountDeleted(String type, String sequence, String occurredAt, String userId) implements PlatformEvent {}
    public record Page(List<PlatformEvent> events, String nextCursor, boolean hasMore) {}

    @Override public String id() { return "20261125-application-entry-roots-events"; }

    @Override
    public void run() {
        db.execute("""
            CREATE TABLE IF NOT EXISTS sys_account_deletion_event (
                sequence bigserial PRIMARY KEY,
                user_id varchar(128),
                occurred_at timestamptz NOT NULL DEFAULT now()
            );
            ALTER TABLE sys_account_deletion_event
                ALTER COLUMN user_id DROP NOT NULL,
                ADD COLUMN event_type text NOT NULL DEFAULT 'account.deleted',
                ADD COLUMN application_change jsonb
            """);
    }

    public static String entryId(String applicationId, String useId) {
        return applicationId + "/" + useId;
    }

    static Map<String, Roots> roots(JSONObject app, List<ApplicationPanelUse> entries) {
        var applicationId = app.getString("id");
        return roots(applicationId, entries, ApplicationCatalog.entryFramePanelId(app));
    }

    static Map<String, Roots> roots(String applicationId, List<ApplicationPanelUse> entries, String framePanelId) {
        var result = new LinkedHashMap<String, Roots>();
        for (var entry : entries) {
            var panels = new LinkedHashSet<String>();
            if (entry.panelEntry()) panels.add(entry.panelId());
            if (entry.panelEntry() || entry.frameConversationEntry()) {
                panels.add(framePanelId);
            }
            var agents = entry.defaultAgent() != null && "id".equals(entry.defaultAgent().kind())
                    ? List.of(entry.defaultAgent().id()) : List.<String>of();
            if (!panels.isEmpty() || !agents.isEmpty())
                result.put(entryId(applicationId, entry.id()), new Roots(List.copyOf(panels), agents));
        }
        return result;
    }

    static Map<String, Roots> roots(JSONObject app) {
        return roots(app, app.getList("panelUses", ApplicationPanelUse.class));
    }

    static void append(JdbcTemplate db, String domainId, String actorId, Map<String, Roots> before, Map<String, Roots> after) {
        var changed = new LinkedHashSet<>(before.keySet());
        changed.addAll(after.keySet());
        var statements = new ArrayList<Object[]>();
        for (var entry : changed) {
            var previous = before.getOrDefault(entry, Roots.EMPTY);
            var next = after.getOrDefault(entry, Roots.EMPTY);
            if (!previous.equals(next)) {
                statements.add(new Object[] { JSON.toJSONString(
                        new Event(TYPE, null, null, domainId, actorId, entry, previous, next)) });
            }
        }
        if (statements.isEmpty()) return;
        lockStream(db);
        db.batchUpdate("""
            INSERT INTO sys_account_deletion_event(event_type,application_change)
            VALUES ('application.entry-roots.changed',?::jsonb)
            """, statements);
    }

    public static void lockStream(JdbcTemplate db) {
        // Preserve sequence order at commit for both platform event producers.
        db.execute("SELECT pg_advisory_xact_lock(60964989)");
    }

    public Page read(long after, int limit) {
        if (after < 0 || limit < 1 || limit > 500)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid application event cursor or page size");
        List<PlatformEvent> events = db.query("""
            SELECT sequence,occurred_at,user_id,event_type,application_change
            FROM sys_account_deletion_event WHERE sequence > ? ORDER BY sequence LIMIT ?
            """, (row, index) -> {
            var sequence = row.getString("sequence");
            var occurredAt = row.getObject("occurred_at", OffsetDateTime.class).toInstant().toString();
            return switch (row.getString("event_type")) {
                case "account.deleted" -> new AccountDeleted("account.deleted", sequence, occurredAt, row.getString("user_id"));
                case TYPE -> {
                    var event = JSON.parseObject(row.getString("application_change"), Event.class);
                    yield new Event(TYPE, sequence, occurredAt, event.domainId(), event.actorId(), event.entryId(), event.before(), event.after());
                }
                default -> throw new IllegalStateException("Unexpected platform event type: " + row.getString("event_type"));
            };
        }, after, limit + 1);
        boolean hasMore = events.size() > limit;
        var page = List.copyOf(events.subList(0, Math.min(limit, events.size())));
        return new Page(page, page.isEmpty() ? Long.toString(after) : page.getLast().sequence(), hasMore);
    }
}
