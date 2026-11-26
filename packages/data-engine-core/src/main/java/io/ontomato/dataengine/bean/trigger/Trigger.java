package io.ontomato.dataengine.bean.trigger;

import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.schedules.TaskDefinition;
import io.ontomato.dataengine.schedules.TaskStore;
import java.time.Instant;
import java.util.List;
import java.util.Set;

/** A capability definition, owned and executed by members of its domain. */
public record Trigger(
    String id,
    String domain,
    String creator,
    String executor,
    List<String> coauthors,
    String reviewer,
    String status,
    int version,
    TaskDefinition definition,
    String notifyEmailSetBy,
    JsonNode summary,
    String locale,
    boolean enabled,
    TaskStore.Failure pause,
    Instant nextRunAt,
    Instant lastFiredAt,
    long revision,
    Instant createdAt,
    Instant updatedAt) {
  public static final String PENDING_REVIEW = "PENDING_REVIEW";
  public static final String PUBLISHED = "PUBLISHED";
  public static final String UNUSED = "UNUSED";
  public static final Set<String> STATUSES = Set.of(PENDING_REVIEW, PUBLISHED, UNUSED);
}
