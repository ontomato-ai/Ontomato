package io.ontomato.dataengine.service.agent;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.KnowledgeService;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

/** Owns the one insertion rule for pending business knowledge. */
@Service
public class PendingKnowledgeService {
  private final KnowledgeService knowledge;
  private final OntologyAgentStore store;

  public PendingKnowledgeService(KnowledgeService knowledge, OntologyAgentStore store) {
    this.knowledge = knowledge;
    this.store = store;
  }

  public record Result(String knowledgeId, boolean created, int status) {}

  /** Adds a pending entry, or answers the existing entry whose normalized content is identical. */
  public Result save(String requestedId, String title, String text, List<String> tags, User creator) {
    var existing = knowledge.getBussinessKnowledge(creator.getDomainId());
    if (requestedId != null && !requestedId.isBlank()) {
      var old = existing.get(requestedId);
      if (old != null) {
        if (!Objects.equals(old.getKnowledgeTitle(), title) || !Objects.equals(old.getKnowledgeText(), text))
          throw new AgentHttpException(409, "KNOWLEDGE_CONFLICT", "Knowledge ID already contains different content");
        return new Result(requestedId, false, old.getStatus());
      }
    }
    String normalized = normalize(text);
    for (KnowledgeEntity entry : existing.values()) {
      if (normalize(entry.getKnowledgeText()).equals(normalized))
        return new Result(entry.getKnowledgeID(), false, entry.getStatus());
    }
    String id = knowledge.addBussinessKnowledge(requestedId, title, text, 0, tags, creator);
    return new Result(id, true, 0);
  }


  /** Adds or reuses the entry and records the user submission as one fact. */
  public Result submit(String title, String text, User creator, String sessionId, String runId, String quote) {
    return store.transaction(() -> {
      var result = save(null, title, text, List.of(), creator);
      recordSubmission(result.knowledgeId(), creator, sessionId, runId, quote);
      return result;
    });
  }

  public Map<String, com.alibaba.fastjson2.JSONObject> submissions(String domainId) {
    return store.knowledgeSubmissions(domainId);
  }

  /** Records where one submission came from, including a duplicate submission that reused an entry. */
  public void recordSubmission(String knowledgeId, User creator, String sessionId, String runId, String quote) {
    store.recordKnowledgeSubmission(knowledgeId, creator, sessionId, runId, quote);
  }

  private static String normalize(String text) {
    return text == null ? "" : text.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
  }
}
