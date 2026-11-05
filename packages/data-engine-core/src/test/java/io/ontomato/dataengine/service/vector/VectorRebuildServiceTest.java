package io.ontomato.dataengine.service.vector;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.BusinessExampleQuestionSpliterDao;
import io.ontomato.dataengine.dao.BussinessExampleDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.VectorRebuildItem;
import io.ontomato.dataengine.dao.VectorRebuildState;
import io.ontomato.dataengine.dao.VectorRebuildStateDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRebuildStatus.State;

/**
 * The vector state of a domain across configuration saves, data writes, rounds, pauses, failures and
 * restarts. The configuration, the state table and the knowledge rows are in-memory stores that
 * survive a recreated service, so a restart is a new service and tracker over the same stores.
 */
class VectorRebuildServiceTest {

    private static final String KEY = "sk-secret-key-123";
    private static final String HEADER_VALUE = "Bearer header-secret-456";

    /** Persisted business config per domain, as JSON like the business_config row. */
    private final Map<String, String> configs = new ConcurrentHashMap<>();
    private final InMemoryStateDao stateDao = new InMemoryStateDao();
    /** Knowledge rows per domain: id to [text, vector]; a null vector is pending. */
    private final Map<String, Map<String, Object[]>> knowledge = new ConcurrentHashMap<>();
    /** Texts embedded by any round, in order. */
    private final List<String> roundEmbeddings = Collections.synchronizedList(new ArrayList<>());
    /** Text to latch: embedding it in a round waits until the latch opens. */
    private final Map<String, CountDownLatch> embedBlocks = new ConcurrentHashMap<>();
    private final Map<String, CountDownLatch> embedEntered = new ConcurrentHashMap<>();
    /** Set when the test stops the process: a released blocked call then dies with it. */
    private final java.util.concurrent.atomic.AtomicBoolean processStopped = new java.util.concurrent.atomic.AtomicBoolean();

    private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
    private final EmbeddingService embeddingService = mock(EmbeddingService.class);
    private final LangService langService = mock(LangService.class);
    private final KnowledgeDao knowledgeDao = mock(KnowledgeDao.class);
    private final BussinessExampleDao exampleDao = mock(BussinessExampleDao.class);
    private final BusinessExampleQuestionSpliterDao spliterDao = mock(BusinessExampleQuestionSpliterDao.class);
    private final ActionDao actionDao = mock(ActionDao.class);
    private final MetricViewDao metricViewDao = mock(MetricViewDao.class);
    private final VectorResourceDao resourceDao = mock(VectorResourceDao.class);

    /** State-machine tests use memory; real commit/rollback behavior belongs to VectorStoragePostgresBoundaryTest. */
    private final TransactionTemplate transactions = new TransactionTemplate(new InMemoryTransactions());

    private VectorRebuildTracker tracker;
    private VectorRetrievalGate gate;
    private VectorRebuildService service;

    @BeforeEach
    void setUp() {
        when(businessConfigService.get(anyString())).thenAnswer(inv -> JSON.parseObject(
                configs.get(inv.<String>getArgument(0)), BusinessConfig.class, JSONReader.Feature.DisableReferenceDetect));
        // Like BusinessConfigDao: a whole-config save keeps the stored embedding configuration of an existing
        // record, and only setEmbeddingModel replaces it.
        org.mockito.Mockito.doAnswer(inv -> {
            BusinessConfig saved = inv.getArgument(0);
            String domainId = inv.getArgument(1);
            if (configs.containsKey(domainId)) {
                saved.setEmbeddingModelProperties(businessConfigService.get(domainId).getEmbeddingModelProperties());
            }
            configs.put(domainId, JSON.toJSONString(saved, JSONWriter.Feature.WriteMapNullValue));
            return null;
        }).when(businessConfigService).set(any(), anyString());
        org.mockito.Mockito.doAnswer(inv -> {
            String domainId = inv.getArgument(1);
            BusinessConfig stored = businessConfigService.get(domainId);
            stored.setEmbeddingModelProperties(inv.getArgument(0));
            configs.put(domainId, JSON.toJSONString(stored, JSONWriter.Feature.WriteMapNullValue));
            return null;
        }).when(businessConfigService).setEmbeddingModel(any(), anyString());
        when(langService.get(any(), anyString())).thenAnswer(inv -> inv.getArgument(1));
        when(embeddingService.embedWith(any(), anyString())).thenAnswer(inv -> {
            BusinessConfig.EmbeddingModelProperties properties = inv.getArgument(0);
            String text = inv.getArgument(1);
            roundEmbeddings.add(text);
            CountDownLatch entered = embedEntered.get(text);
            if (entered != null) {
                entered.countDown();
            }
            CountDownLatch block = embedBlocks.get(text);
            if (block != null) {
                block.await(5, TimeUnit.SECONDS);
                if (processStopped.get()) {
                    throw new Error("process stopped");
                }
            }
            if (!KEY.equals(properties.getApiKey())) {
                throw new RuntimeException("401 Incorrect API key provided: " + properties.getApiKey()
                        + " (Authorization: " + properties.getCustomHeaders().get("Authorization") + ")");
            }
            return new Response<>(Embedding.from(vectorOf(properties)));
        });
        when(knowledgeDao.countDomainRows(anyString())).thenAnswer(inv -> rows(inv.getArgument(0)).size());
        when(knowledgeDao.countDomainPending(anyString())).thenAnswer(inv -> (int) rows(inv.getArgument(0)).values()
                .stream().filter(row -> row[1] == null).count());
        when(knowledgeDao.listDomainPending(anyString())).thenAnswer(inv -> {
            List<VectorRebuildItem> pending = new ArrayList<>();
            rows(inv.getArgument(0)).forEach((id, row) -> {
                if (row[1] == null) {
                    pending.add(new VectorRebuildItem(id, (String) row[0]));
                }
            });
            return pending;
        });
        org.mockito.Mockito.doAnswer(inv -> {
            rows(inv.getArgument(0)).values().forEach(row -> row[1] = null);
            return null;
        }).when(knowledgeDao).clearDomainVectors(anyString());
        // The rows are shared by every domain id here: a fill knows only the row id, like the DAO.
        org.mockito.Mockito.doAnswer(inv -> {
            for (Map<String, Object[]> domainRows : knowledge.values()) {
                Object[] row = domainRows.get(inv.<String>getArgument(0));
                if (row != null && row[1] == null) {
                    row[1] = inv.getArgument(1);
                }
            }
            return null;
        }).when(knowledgeDao).fillDomainVector(anyString(), any());
        when(resourceDao.listDomainTables(anyString())).thenReturn(List.of());

        configs.put("d1", JSON.toJSONString(config("http://emb/v1", "m1", 1024, KEY)));
        configs.put("d2", JSON.toJSONString(config("http://emb/v1", "m1", 1024, KEY)));
        recreateService();
    }

    /** A new process: the stores persist, the in-memory tracker does not. */
    private void recreateService() {
        tracker = new VectorRebuildTracker();
        gate = new VectorRetrievalGate();
        ReflectionTestUtils.setField(gate, "businessConfigService", businessConfigService);
        ReflectionTestUtils.setField(gate, "stateDao", stateDao);
        ReflectionTestUtils.setField(gate, "rebuildTracker", tracker);
        ReflectionTestUtils.setField(gate, "langService", langService);
        service = new VectorRebuildService();
        ReflectionTestUtils.setField(service, "businessConfigService", businessConfigService);
        ReflectionTestUtils.setField(service, "embeddingService", embeddingService);
        ReflectionTestUtils.setField(service, "langService", langService);
        ReflectionTestUtils.setField(service, "rebuildTracker", tracker);
        ReflectionTestUtils.setField(service, "retrievalGate", gate);
        ReflectionTestUtils.setField(service, "stateDao", stateDao);
        ReflectionTestUtils.setField(service, "transactions", transactions);
        ReflectionTestUtils.setField(service, "knowledgeDao", knowledgeDao);
        ReflectionTestUtils.setField(service, "bussinessExampleDao", exampleDao);
        ReflectionTestUtils.setField(service, "questionSpliterDao", spliterDao);
        ReflectionTestUtils.setField(service, "actionDao", actionDao);
        ReflectionTestUtils.setField(service, "metricViewDao", metricViewDao);
        ReflectionTestUtils.setField(service, "vectorResourceDao", resourceDao);
    }

    @Test
    void firstConfigurationOfAnEmptyDomainNeedsNoRebuildAndItsWritesAreSearchable() {
        save("d1", "http://other/v1", "text-embedding-v3", 2048, KEY);

        assertEquals(State.READY, service.status("d1").getState());
        assertDoesNotThrow(() -> gate.requireRetrievable("d1"));

        write("d1", "k1", "hello");
        assertArrayEquals(vectorOf(props("http://other/v1", "text-embedding-v3", 2048, KEY)), vector("d1", "k1"));
        assertEquals(State.READY, service.status("d1").getState());
        assertDoesNotThrow(() -> gate.requireRetrievable("d1"));
    }

    @Test
    void aChangeWithDataStaysPendingAfterMixedWritesAndARevert() throws Exception {
        write("d1", "k1", "hello");
        assertEquals(State.READY, service.status("d1").getState());

        save("d1", "http://emb/v1", "m2", 1024, KEY);
        write("d1", "k2", "written with m2");
        save("d1", "http://emb/v1", "m1", 1024, KEY);

        VectorRebuildStatus status = service.status("d1");
        assertEquals(State.PENDING, status.getState());
        assertEquals(2, status.getTotal());
        assertEquals(0, status.getDone());
        assertThrows(IllegalStateException.class, () -> gate.requireRetrievable("d1"));

        service.start("d1", "en");
        awaitIdle("d1");

        assertEquals(State.READY, service.status("d1").getState());
        float[] m1 = vectorOf(props("http://emb/v1", "m1", 1024, KEY));
        assertArrayEquals(m1, vector("d1", "k1"));
        assertArrayEquals(m1, vector("d1", "k2"));
        assertDoesNotThrow(() -> gate.requireRetrievable("d1"));
    }

    @Test
    void keyOrTimeoutChangesKeepTheStateTheyFind() {
        write("d1", "k1", "hello");
        save("d1", "http://emb/v1", "m1", 1024, "another-key");
        assertEquals(State.READY, service.status("d1").getState());

        save("d1", "http://emb/v1", "m2", 1024, KEY);
        save("d1", "http://emb/v1", "m2", 1024, "another-key");
        assertEquals(State.PENDING, service.status("d1").getState());
    }

    @Test
    void anotherDomainKeepsItsOwnState() {
        write("d1", "k1", "hello");
        write("d2", "j1", "world");
        save("d1", "http://emb/v1", "m2", 1024, KEY);

        assertThrows(IllegalStateException.class, () -> gate.requireRetrievable("d1"));
        assertDoesNotThrow(() -> gate.requireRetrievable("d2"));
        assertEquals(State.READY, service.status("d2").getState());
    }

    @Test
    void retrievalStaysClosedWhileRunningPausedAndUntilTheRoundCompletes() throws Exception {
        rowsNeedingM2("hello", "world", "again");
        CountDownLatch release = block("world");

        service.start("d1", "en");
        awaitEntered("world");
        assertEquals(State.RUNNING, service.status("d1").getState());
        assertThrows(IllegalStateException.class, () -> gate.requireRetrievable("d1"));
        assertThrows(IllegalStateException.class, () -> service.start("d1", "en"));
        assertThrows(IllegalStateException.class, () -> save("d1", "http://emb/v1", "m3", 1024, KEY));

        service.pause("d1", "en");
        assertEquals(State.PAUSING, service.status("d1").getState());
        release.countDown();
        awaitIdle("d1");

        // The current item finished; the next one was not taken.
        VectorRebuildStatus paused = service.status("d1");
        assertEquals(State.PAUSED, paused.getState());
        assertEquals(3, paused.getTotal());
        assertEquals(2, paused.getDone());
        assertNull(paused.getError());
        assertThrows(IllegalStateException.class, () -> gate.requireRetrievable("d1"));
        assertThrows(IllegalStateException.class, () -> service.pause("d1", "en"));

        service.start("d1", "en");
        awaitIdle("d1");
        assertEquals(State.READY, service.status("d1").getState());
        assertEquals(List.of("hello", "world", "again"), roundEmbeddings);
    }

    @Test
    void aFailureKeepsCompletedRowsReportsWhereAndWhyAndResumesWithTheCorrectedKey() throws Exception {
        rowsNeedingM2("hello", "world", "again");
        save("d1", "http://emb/v1", "m2", 1024, "wrong-key");
        service.start("d1", "en");
        awaitIdle("d1");

        VectorRebuildStatus failed = service.status("d1");
        assertEquals(State.FAILED, failed.getState());
        assertEquals(0, failed.getDone());
        assertEquals(VectorRebuildState.Phase.EMBED, failed.getError().getPhase());
        assertEquals(VectorRebuildState.ItemType.KNOWLEDGE, failed.getError().getItemType());
        assertEquals("k1", failed.getError().getItemId());
        assertTrue(failed.getError().getReason().contains("401 Incorrect API key"), failed.getError().getReason());
        assertFalse(failed.getError().getReason().contains("wrong-key"), failed.getError().getReason());
        assertFalse(failed.getError().getReason().contains("header-secret"), failed.getError().getReason());
        assertThrows(IllegalStateException.class, () -> gate.requireRetrievable("d1"));

        save("d1", "http://emb/v1", "m2", 1024, KEY);
        assertEquals(State.FAILED, service.status("d1").getState());
        roundEmbeddings.clear();
        service.start("d1", "en");
        awaitIdle("d1");

        assertEquals(State.READY, service.status("d1").getState());
        assertEquals(List.of("hello", "world", "again"), roundEmbeddings);
    }

    @Test
    void aResumedRoundEmbedsOnlyThePendingRowsAfterARestart() throws Exception {
        rowsNeedingM2("hello", "world", "again");
        CountDownLatch release = block("world");
        service.start("d1", "en");
        awaitEntered("world");
        float[] first = vector("d1", "k1");

        // The process stops mid-round: the item in flight never lands and nothing restarts the round.
        processStopped.set(true);
        release.countDown();
        awaitIdle("d1");
        processStopped.set(false);
        recreateService();
        assertEquals(State.INTERRUPTED, service.status("d1").getState());
        assertEquals(1, service.status("d1").getDone());
        assertThrows(IllegalStateException.class, () -> gate.requireRetrievable("d1"));
        roundEmbeddings.clear();

        service.start("d1", "en");
        awaitIdle("d1");

        assertEquals(State.READY, service.status("d1").getState());
        assertSame(first, vector("d1", "k1"));
        assertEquals(List.of("world", "again"), roundEmbeddings);
    }

    @Test
    void aClearThatFailsHalfwayIsRunAgainInFullOnResume() {
        rowsNeedingM2("hello");
        doThrow(new RuntimeException("relation \"bussinessexampleindex\" is locked")).when(exampleDao)
                .clearDomainVectors("d1");
        service.start("d1", "en");
        awaitIdle("d1");

        VectorRebuildStatus failed = service.status("d1");
        assertEquals(State.FAILED, failed.getState());
        assertEquals(VectorRebuildState.Phase.CLEAR, failed.getError().getPhase());
        assertNull(failed.getError().getItemType());
        assertFalse(stateDao.find("d1").isCleared());

        // A row written between attempts gets m2; the full clear and fill still finish the round.
        write("d1", "k9", "between");
        org.mockito.Mockito.reset(exampleDao);
        service.start("d1", "en");
        awaitIdle("d1");

        assertEquals(State.READY, service.status("d1").getState());
        assertArrayEquals(vectorOf(props("http://emb/v1", "m2", 1024, KEY)), vector("d1", "k1"));
    }

    @Test
    void aFailedReadOfPendingRowsNamesTheItemTypeAndNoStaleItem() {
        rowsNeedingM2("hello");
        when(actionDao.listDomainPending("d1")).thenThrow(new RuntimeException("relation \"action\" does not exist"));
        service.start("d1", "en");
        awaitIdle("d1");

        VectorRebuildState.Failure error = service.status("d1").getError();
        assertEquals(VectorRebuildState.Phase.READ, error.getPhase());
        assertEquals(VectorRebuildState.ItemType.ACTION, error.getItemType());
        assertNull(error.getItemId());
        assertEquals(1, service.status("d1").getDone());
    }

    @Test
    void aNewModelAfterAPauseStartsANewRoundThatClearsThePartialWork() throws Exception {
        rowsNeedingM2("hello", "world", "again");
        CountDownLatch release = block("world");
        service.start("d1", "en");
        awaitEntered("world");
        service.pause("d1", "en");
        release.countDown();
        awaitIdle("d1");
        assertEquals(State.PAUSED, service.status("d1").getState());

        save("d1", "http://emb/v1", "m3", 512, KEY);
        VectorRebuildStatus pending = service.status("d1");
        assertEquals(State.PENDING, pending.getState());
        assertEquals(0, pending.getDone());

        service.start("d1", "en");
        awaitIdle("d1");
        float[] m3 = vectorOf(props("http://emb/v1", "m3", 512, KEY));
        assertArrayEquals(m3, vector("d1", "k1"));
        assertArrayEquals(m3, vector("d1", "k2"));
        assertArrayEquals(m3, vector("d1", "k3"));
    }

    @Test
    void aPausedRoundResumesWithAnEditedKey() throws Exception {
        rowsNeedingM2("hello", "world");
        CountDownLatch release = block("hello");
        service.start("d1", "en");
        awaitEntered("hello");
        service.pause("d1", "en");
        release.countDown();
        awaitIdle("d1");

        save("d1", "http://emb/v1", "m2", 1024, "wrong-key");
        assertEquals(State.PAUSED, service.status("d1").getState());
        service.start("d1", "en");
        awaitIdle("d1");

        VectorRebuildStatus failed = service.status("d1");
        assertEquals(State.FAILED, failed.getState());
        assertEquals("k2", failed.getError().getItemId());
        assertEquals(1, failed.getDone());
    }

    @Test
    void aGenerationChangeWaitsForAnInFlightWrite() throws Exception {
        write("d1", "k1", "hello");
        CountDownLatch inWrite = new CountDownLatch(1);
        CountDownLatch finishWrite = new CountDownLatch(1);
        CompletableFuture<Void> slowWrite = CompletableFuture.runAsync(() -> gate.write("d1", () -> {
            float[] vector = vectorOf(currentProps("d1"));
            inWrite.countDown();
            await(finishWrite);
            rows("d1").put("k2", new Object[] { "slow", vector });
            return null;
        }));
        inWrite.await(5, TimeUnit.SECONDS);
        CompletableFuture<Void> change = CompletableFuture.runAsync(() -> save("d1", "http://emb/v1", "m2", 1024, KEY));

        assertThrows(TimeoutException.class, () -> change.get(200, TimeUnit.MILLISECONDS));
        finishWrite.countDown();
        slowWrite.get(5, TimeUnit.SECONDS);
        change.get(5, TimeUnit.SECONDS);

        // The m1 vector of the slow write landed before the change, so the next round clears it.
        assertEquals(State.PENDING, service.status("d1").getState());
        service.start("d1", "en");
        awaitIdle("d1");
        assertArrayEquals(vectorOf(props("http://emb/v1", "m2", 1024, KEY)), vector("d1", "k2"));
    }

    @Test
    void aGenerationChangeWaitsForAnAdmittedSearchAndLaterSearchesAreRefused() throws Exception {
        write("d1", "k1", "hello");
        CountDownLatch inSearch = new CountDownLatch(1);
        CountDownLatch finishSearch = new CountDownLatch(1);
        CompletableFuture<String> search = CompletableFuture.supplyAsync(() -> gate.read("d1", () -> {
            String queryModel = currentProps("d1").getModelName();
            inSearch.countDown();
            await(finishSearch);
            // The rows compared with the query vector still belong to the query's generation.
            return queryModel + "/" + (vector("d1", "k1")[1] == vectorOf(currentProps("d1"))[1]);
        }));
        inSearch.await(5, TimeUnit.SECONDS);
        CompletableFuture<Void> change = CompletableFuture.runAsync(() -> save("d1", "http://emb/v1", "m2", 1024, KEY));

        assertThrows(TimeoutException.class, () -> change.get(200, TimeUnit.MILLISECONDS));
        finishSearch.countDown();
        assertEquals("m1/true", search.get(5, TimeUnit.SECONDS));
        change.get(5, TimeUnit.SECONDS);

        boolean[] ran = { false };
        assertThrows(IllegalStateException.class, () -> gate.read("d1", () -> ran[0] = true));
        assertFalse(ran[0]);
    }

    @Test
    void anUnrelatedSaveFromAnOlderSnapshotKeepsTheOwnedEmbeddingConfiguration() throws Exception {
        write("d1", "k1", "hello");
        BusinessConfig staleSnapshot = businessConfigService.get("d1");
        save("d1", "http://emb/v1", "m2", 1024, KEY);
        service.start("d1", "en");
        awaitIdle("d1");
        assertEquals(State.READY, service.status("d1").getState());

        // A language save built from the snapshot read before the m2 change.
        staleSnapshot.setLang("en");
        businessConfigService.set(staleSnapshot, "d1");
        write("d1", "k2", "after the stale save");

        assertEquals("m2", currentProps("d1").getModelName());
        assertEquals("en", businessConfigService.get("d1").getLang());
        assertEquals(State.READY, service.status("d1").getState());
        float[] m2 = vectorOf(props("http://emb/v1", "m2", 1024, KEY));
        assertArrayEquals(m2, vector("d1", "k1"));
        assertArrayEquals(m2, vector("d1", "k2"));
    }


    @Test
    void anEmptyDomainFlaggedEarlierBecomesReadyOnStatusOrResave() {
        // Stored by the earlier rule: the source still names the default model, the configuration another.
        configs.put("d1", JSON.toJSONString(config("http://other/v1", "m9", 1024, KEY)));
        configs.put("d2", JSON.toJSONString(config("http://other/v1", "m9", 1024, KEY)));
        stateDao.save("d2", VectorRebuildState.of(props("http://other/v1", "m9", 1024, KEY),
                VectorRebuildState.Status.FAILED, true));

        assertEquals(State.READY, service.status("d1").getState());
        assertDoesNotThrow(() -> gate.requireRetrievable("d1"));
        save("d2", "http://other/v1", "m9", 1024, "another-key");
        assertDoesNotThrow(() -> gate.requireRetrievable("d2"));

        // With rows, a recorded failure stays until a round completes.
        write("d2", "j1", "row");
        stateDao.save("d2", VectorRebuildState.of(props("http://other/v1", "m9", 1024, KEY),
                VectorRebuildState.Status.FAILED, true));
        save("d2", "http://other/v1", "m9", 1024, KEY);
        assertEquals(State.FAILED, service.status("d2").getState());
    }

    @Test
    void aDomainStoredBeforeTheStateTableIsSeededFromItsVectorSource() {
        BusinessConfig legacy = config("http://emb/v1", "m2", 1024, KEY);
        configs.put("d1", JSON.toJSONString(legacy));
        write("d1", "k1", "hello");
        assertEquals(State.PENDING, service.status("d1").getState());

        BusinessConfig missing = config("http://emb/v1", "m1", 1024, KEY);
        missing.setEmbeddingVectorSource(null);
        configs.put("d3", JSON.toJSONString(missing));
        IllegalStateException error = assertThrows(IllegalStateException.class, () -> service.status("d3"));
        assertTrue(error.getMessage().contains("embeddingVectorSource"), error.getMessage());
    }

    @Test
    void aResumeDuringAStatusReadDoesNotAttachThePreviousFailureToRunning() {
        rowsNeedingM2("hello");
        VectorRebuildState failed = stateDao.find("d1");
        failed.setStatus(VectorRebuildState.Status.FAILED);
        VectorRebuildState.Failure error = new VectorRebuildState.Failure();
        error.setPhase(VectorRebuildState.Phase.EMBED);
        error.setReason("previous timeout");
        failed.setError(error);
        stateDao.save("d1", failed);
        when(knowledgeDao.countDomainRows("d1")).thenAnswer(inv -> {
            tracker.tryStart("d1");
            stateDao.save("d1", VectorRebuildState.of(currentProps("d1"), VectorRebuildState.Status.RUNNING, true));
            return 1;
        });

        VectorRebuildStatus status = service.status("d1");

        assertEquals(State.RUNNING, status.getState());
        assertNull(status.getError());
        tracker.finish("d1");
    }

    @Test
    void aCompletionDuringAStatusReadIsNotReportedAsAnInterruption() {
        rowsNeedingM2("hello");
        tracker.tryStart("d1");
        stateDao.save("d1", VectorRebuildState.of(currentProps("d1"), VectorRebuildState.Status.RUNNING, true));
        when(knowledgeDao.countDomainRows("d1")).thenAnswer(inv -> {
            stateDao.save("d1", VectorRebuildState.of(currentProps("d1"), VectorRebuildState.Status.READY, true));
            tracker.finish("d1");
            return 1;
        });

        assertEquals(State.READY, service.status("d1").getState());
    }

    // --- helpers ---

    private void save(String domainId, String baseUrl, String modelName, int dimensions, String apiKey) {
        service.saveEmbeddingModel(domainId, "en", props(baseUrl, modelName, dimensions, apiKey));
    }

    /** The data write path of a DAO: embed with the current configuration and store, through the gate. */
    private void write(String domainId, String id, String text) {
        gate.write(domainId, () -> rows(domainId).put(id, new Object[] { text, vectorOf(currentProps(domainId)) }));
    }

    /** Rows of d1 whose vectors are m1 while the configuration already names m2. */
    private void rowsNeedingM2(String... texts) {
        int index = 1;
        for (String text : texts) {
            write("d1", "k" + index++, text);
        }
        save("d1", "http://emb/v1", "m2", 1024, KEY);
        assertEquals(State.PENDING, service.status("d1").getState());
    }

    private BusinessConfig.EmbeddingModelProperties currentProps(String domainId) {
        return businessConfigService.get(domainId).getEmbeddingModelProperties();
    }

    private Map<String, Object[]> rows(String domainId) {
        return knowledge.computeIfAbsent(domainId, key -> Collections.synchronizedMap(new LinkedHashMap<>()));
    }

    private float[] vector(String domainId, String id) {
        return (float[]) rows(domainId).get(id)[1];
    }

    private CountDownLatch block(String text) {
        CountDownLatch release = new CountDownLatch(1);
        embedBlocks.put(text, release);
        embedEntered.put(text, new CountDownLatch(1));
        return release;
    }

    private void awaitEntered(String text) throws InterruptedException {
        assertTrue(embedEntered.get(text).await(5, TimeUnit.SECONDS));
    }

    private void awaitIdle(String domainId) {
        long deadline = System.currentTimeMillis() + 5000;
        while (tracker.isRunning(domainId)) {
            assertTrue(System.currentTimeMillis() < deadline, "the round did not stop");
            Thread.onSpinWait();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }

    /** A vector that identifies its generation, so mixed generations are visible. */
    private static float[] vectorOf(BusinessConfig.EmbeddingModelProperties properties) {
        return new float[] { properties.getDimensions(), properties.getModelName().hashCode(),
                properties.getBaseUrl().hashCode() };
    }

    private static BusinessConfig.EmbeddingModelProperties props(String baseUrl, String modelName, int dimensions,
            String apiKey) {
        return config(baseUrl, modelName, dimensions, apiKey).getEmbeddingModelProperties();
    }

    /** A stored config whose vector source is m1/1024 at http://emb/v1, as a new domain seeds it. */
    private static BusinessConfig config(String baseUrl, String modelName, int dimensions, String apiKey) {
        BusinessConfig businessConfig = new BusinessConfig();
        BusinessConfig.EmbeddingModelProperties properties = businessConfig.new EmbeddingModelProperties();
        properties.setBaseUrl(baseUrl);
        properties.setApiKey(apiKey);
        properties.setModelName(modelName);
        properties.setDimensions(dimensions);
        properties.setCustomHeaders(Map.of("Authorization", HEADER_VALUE));
        businessConfig.setEmbeddingModelProperties(properties);
        BusinessConfig.EmbeddingVectorSource source = new BusinessConfig.EmbeddingVectorSource();
        source.setBaseUrl("http://emb/v1");
        source.setModelName("m1");
        source.setDimensions(1024);
        businessConfig.setEmbeddingVectorSource(source);
        return businessConfig;
    }

    private static class InMemoryTransactions implements PlatformTransactionManager {
        public TransactionStatus getTransaction(TransactionDefinition definition) { return new SimpleTransactionStatus(); }
        public void commit(TransactionStatus status) {}
        public void rollback(TransactionStatus status) {}
    }

    /** The vector_rebuild_state rows, stored as JSON copies like a table. */
    private static class InMemoryStateDao extends VectorRebuildStateDao {

        private final Map<String, String> rows = new ConcurrentHashMap<>();

        @Override
        public VectorRebuildState find(String domainId) {
            String row = rows.get(domainId);
            return row == null ? null : JSON.parseObject(row, VectorRebuildState.class);
        }

        @Override
        public void save(String domainId, VectorRebuildState state) {
            rows.put(domainId, JSON.toJSONString(state));
        }

        @Override
        public void insertIfAbsent(String domainId, VectorRebuildState state) {
            rows.putIfAbsent(domainId, JSON.toJSONString(state));
        }

    }

}
