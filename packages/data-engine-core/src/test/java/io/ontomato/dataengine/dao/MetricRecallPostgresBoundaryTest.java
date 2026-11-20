package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.service.MetricRecall;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** The recall query owns the cutoff and the ranking; the service only filters and caps. */
class MetricRecallPostgresBoundaryTest extends PostgresTestDatabase {
  private MetricViewDao views(float[] question) {
    MetricViewDao views = wire(new MetricViewDao());
    ReflectionTestUtils.setField(views, "assetLookupPolicy", (AssetLookupPolicy) (connection, table) -> true);
    var embedding = mock(EmbeddingService.class);
    when(embedding.embedding(anyString(), eq("d1"))).thenReturn(question);
    ReflectionTestUtils.setField(views, "embeddingService", embedding);
    var gate = mock(VectorRetrievalGate.class);
    when(gate.write(eq("d1"), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
    when(gate.read(eq("d1"), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
    ReflectionTestUtils.setField(views, "retrievalGate", gate);
    views.initIndex();
    return views;
  }

  private MetricView metric(MetricViewDao views, String id, String domain, String status, String operation,
      float[] vector, MetricViewBinding binding, float[] bindingVector) {
    var function = new Function();
    function.setId("function-" + id);
    function.setDomainId(domain);
    function.setOperation(operation);
    function.setParameters(List.of());
    var metric = new MetricView();
    metric.setId(id);
    metric.setName(id);
    metric.setDomainId(domain);
    metric.setStatus(status);
    metric.setFunction(function);
    metric.setMatchQuestions(Set.of());
    metric.setBindings(new ArrayList<>());
    if (binding != null) {
      binding.setParameters(binding.getParameters() == null ? new JSONObject() : binding.getParameters());
      binding.setMatchQuestions(Set.of());
      metric.getBindings().add(binding);
    }
    mockReadBoundary(views);
    jdbc.update("INSERT INTO function(id,domain_id,operation) VALUES(?,?,?)", function.getId(), domain, operation);
    views.save(metric);
    jdbc.update("UPDATE metric_view SET brief_vector=?::vector WHERE id=?", new com.pgvector.PGvector(vector), id);
    if (binding != null && binding.getId() != null)
      jdbc.update("UPDATE metric_view_binding SET brief_vector=?::vector WHERE id=?",
          new com.pgvector.PGvector(bindingVector), binding.getId());
    return metric;
  }

  /** The read boundary is not what this test measures. */
  private void mockReadBoundary(MetricViewDao views) {
    var gate = (VectorRetrievalGate) ReflectionTestUtils.getField(views, "retrievalGate");
    when(gate.write(eq("d1"), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
    when(gate.read(eq("d1"), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
  }

  @Test
  void recallRanksBothBriefsOnOneAbsoluteDistanceAndDropsEverythingElse() {
    requireVectorExtension();
    jdbc.execute("CREATE TABLE function (id VARCHAR(64) PRIMARY KEY, domain_id VARCHAR(64), operation VARCHAR(32))");
    var views = views(new float[] { 1, 0 });
    metric(views, "near", "d1", MetricView.STATUS_PUBLISHED, Function.OPERATION_READ, new float[] { 1, 0.5f }, null, null);
    var binding = new MetricViewBinding();
    binding.setId("preset");
    binding.setName("Preset");
    metric(views, "preset-metric", "d1", MetricView.STATUS_PUBLISHED, Function.OPERATION_READ,
        new float[] { 0, 1 }, binding, new float[] { 1, 0.6f });
    metric(views, "far", "d1", MetricView.STATUS_PUBLISHED, Function.OPERATION_READ, new float[] { -1, 0.2f }, null, null);
    metric(views, "draft", "d1", MetricView.STATUS_PENDING_REVIEW, Function.OPERATION_READ, new float[] { 1, 0 }, null, null);
    metric(views, "writes", "d1", MetricView.STATUS_PUBLISHED, Function.OPERATION_WRITE, new float[] { 1, 0 }, null, null);
    metric(views, "elsewhere", "d2", MetricView.STATUS_PUBLISHED, Function.OPERATION_READ, new float[] { 1, 0 }, null, null);

    var found = views.recall("How many people?", "d1", 0.80, 50);
    assertEquals(List.of("near", "preset-metric"), found.stream().map(MetricRecall::metricId).toList(),
        "Published read metrics within the cutoff, nearest first");
    assertNull(found.get(0).bindingId());
    assertEquals("preset", found.get(1).bindingId(), "The preset is nearer than its metric's own brief");
    assertTrue(found.get(0).distance() < found.get(1).distance());
    assertTrue(views.recall("How many people?", "d1", 0.40, 50).isEmpty(), "An absolute cutoff, not a cluster");
    assertEquals(List.of("near"), views.recall("How many people?", "d1", 0.80, 1).stream()
        .map(MetricRecall::metricId).toList(), "The row limit is applied after ordering");
  }
}
