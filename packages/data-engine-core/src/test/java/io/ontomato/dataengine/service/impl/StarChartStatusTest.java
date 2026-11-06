package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.StarChartDao;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.DomainSvc;

/**
 * Star chart reads never wait: they report READY, GENERATING or NOT_GENERATED immediately,
 * and a refresh builds both files synchronously unless one is already in progress. The pair
 * a completed generation wrote is recorded on disk, so a restarted service serves it again.
 */
class StarChartStatusTest {

	private static final String DOMAIN = "d1";

	private DataServiceImpl service;
	private StarChartDao starChartDao;
	private BusinessConfigService businessConfigService;
	private DataAdapterRegistry registry;
	private AdminService adminService;
	private JSONObject mode0;
	/** The disk as the DAO stands for it: the data files by mode|suffix|domain, and the current suffix by domain. */
	private Map<String, JSONObject> files;
	private Map<String, String> current;

	@BeforeEach
	void wire() {
		mode0 = new JSONObject();
		JSONArray nodes = new JSONArray();
		JSONObject node = new JSONObject();
		node.put("id", "C:1");
		node.put("name", "n1");
		node.put("class", "C");
		nodes.add(node);
		mode0.put("nodes", nodes);
		mode0.put("edges", new JSONArray());
		starChartDao = mock(StarChartDao.class);
		businessConfigService = mock(BusinessConfigService.class);
		registry = mock(DataAdapterRegistry.class);
		adminService = mock(AdminService.class);
		files = new HashMap<>();
		current = new HashMap<>();
		doAnswer(call -> {
			files.put(call.getArgument(1) + "|" + call.getArgument(2) + "|" + call.getArgument(3), call.getArgument(0));
			return null;
		}).when(starChartDao).writeWholeData(any(), anyString(), anyString(), anyString());
		when(starChartDao.readWholeData(anyString(), anyString(), anyString()))
				.thenAnswer(call -> files.get(call.getArgument(0) + "|" + call.getArgument(1) + "|" + call.getArgument(2)));
		doAnswer(call -> current.put(call.getArgument(1), call.getArgument(0)))
				.when(starChartDao).writeCurrentSuffix(anyString(), anyString());
		when(starChartDao.readCurrentSuffix(anyString())).thenAnswer(call -> current.get(call.getArgument(0)));
		service = newService();
	}

	/** A service process over the same disk: a second one is what the data engine is after a restart. */
	private DataServiceImpl newService() {
		DataServiceImpl created = new DataServiceImpl() {
			@Override
			JSONObject cutWholeData(String domainId, BusinessConfig businessConfig) {
				return mode0;
			}
		};
		ReflectionTestUtils.setField(created, "starChartDao", starChartDao);
		ReflectionTestUtils.setField(created, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(created, "dataAdapterRegistry", registry);
		ReflectionTestUtils.setField(created, "adminService", adminService);
		return created;
	}

	@Test
	void neverGeneratedAndIdleReadsNotGenerated() {
		JSONObject mode0 = service.queryWholeDataMode0(DOMAIN);
		assertEquals(true, mode0.getBoolean("success"));
		assertEquals("NOT_GENERATED", mode0.getString("status"));
		assertFalse(mode0.containsKey("data"));
		JSONObject mode1 = service.queryWholeDataMode1(DOMAIN);
		assertEquals(true, mode1.getBoolean("success"));
		assertEquals("NOT_GENERATED", mode1.getString("status"));
		assertFalse(mode1.containsKey("data"));
		verify(starChartDao, never()).readWholeData(anyString(), anyString(), anyString());
	}

	@Test
	void neverGeneratedWhileGeneratingReadsGenerating() {
		service.generatingDomains.add(DOMAIN);
		JSONObject ret = service.queryWholeDataMode0(DOMAIN);
		assertEquals(true, ret.getBoolean("success"));
		assertEquals("GENERATING", ret.getString("status"));
		assertFalse(ret.containsKey("data"));
	}

	@Test
	void regenerationKeepsServingOldDataAsReady() {
		JSONObject oldData = new JSONObject();
		oldData.put("nodes", new JSONArray());
		files.put("mode0|A|" + DOMAIN, oldData);
		current.put(DOMAIN, "A");
		service.generatingDomains.add(DOMAIN);
		JSONObject ret = service.queryWholeDataMode0(DOMAIN);
		assertEquals("READY", ret.getString("status"));
		assertTrue(ret.containsKey("data"));
	}

	@Test
	void unreadableCurrentFilePropagates() {
		current.put(DOMAIN, "A");
		when(starChartDao.readWholeData(anyString(), anyString(), anyString())).thenThrow(new RuntimeException("disk gone"));
		assertThrows(RuntimeException.class, () -> service.queryWholeDataMode0(DOMAIN));
	}

	@Test
	void refreshGeneratesBothModesThenReadsReady() {
		stubBuild();
		JSONObject ret = service.refreshStarChartData(DOMAIN);
		assertEquals(true, ret.getBoolean("success"));
		assertEquals("GENERATED", ret.getString("status"));

		JSONObject mode0 = service.queryWholeDataMode0(DOMAIN);
		assertEquals("READY", mode0.getString("status"));
		assertEquals("C:1", mode0.getJSONObject("data").getJSONArray("nodes").getJSONObject(0).getString("id"));
		JSONObject mode1 = service.queryWholeDataMode1(DOMAIN);
		assertEquals("READY", mode1.getString("status"));
		assertTrue(mode1.getJSONObject("data").containsKey("classes"));
	}


	@Test
	void concurrentRefreshReturnsGeneratingWithoutSecondBuild() {
		service.generatingDomains.add(DOMAIN);
		JSONObject ret = service.refreshStarChartData(DOMAIN);
		assertEquals(true, ret.getBoolean("success"));
		assertEquals("GENERATING", ret.getString("status"));
		verifyNoInteractions(businessConfigService, registry, starChartDao, adminService);
	}

	@Test
	void startupDoesNotScanDomainsOrGenerateGraphs() throws Exception {
		DomainSvc domainSvc = mock(DomainSvc.class);
		when(domainSvc.listDomainIds()).thenReturn(List.of(DOMAIN));
		ReflectionTestUtils.setField(service, "domainSvc", domainSvc);
		service.initService();
		verifyNoInteractions(domainSvc, registry, businessConfigService, starChartDao);
	}

	@Test
	void aRestartedServiceServesTheLastCompleteGenerationWithoutRebuilding() {
		stubBuild();
		service.refreshStarChartData(DOMAIN);
		clearInvocations(businessConfigService, adminService);

		DataServiceImpl restarted = newService();
		restarted.initService();
		JSONObject read = restarted.queryWholeDataMode0(DOMAIN);
		assertEquals("READY", read.getString("status"));
		assertEquals("C:1", read.getJSONObject("data").getJSONArray("nodes").getJSONObject(0).getString("id"));
		assertEquals("READY", restarted.queryWholeDataMode1(DOMAIN).getString("status"));
		verifyNoInteractions(businessConfigService, adminService);
	}

	@Test
	void regenerationWritesTheOtherPairAndRecordsItOnlyAfterBothFiles() {
		stubBuild();
		service.refreshStarChartData(DOMAIN);
		assertEquals("A", current.get(DOMAIN));

		newService().refreshStarChartData(DOMAIN);
		assertEquals("B", current.get(DOMAIN));
		InOrder order = inOrder(starChartDao);
		order.verify(starChartDao).writeWholeData(any(), eq("mode0"), eq("B"), eq(DOMAIN));
		order.verify(starChartDao).writeWholeData(any(), eq("mode1"), eq("B"), eq(DOMAIN));
		order.verify(starChartDao).writeCurrentSuffix("B", DOMAIN);
	}

	@Test
	void aGenerationThatStopsHalfwayLeavesThePreviousPairCurrent() {
		stubBuild();
		service.refreshStarChartData(DOMAIN);
		JSONObject previous = files.get("mode0|A|" + DOMAIN);
		// The next build reads other data, and its second file cannot be written.
		mode0 = JSONObject.parseObject("{\"nodes\":[{\"id\":\"C:2\",\"name\":\"n2\",\"class\":\"C\"}],\"edges\":[]}");
		doThrow(new RuntimeException("disk full"))
				.when(starChartDao).writeWholeData(any(), eq("mode1"), eq("B"), eq(DOMAIN));

		assertThrows(RuntimeException.class, () -> service.refreshStarChartData(DOMAIN));

		assertEquals("A", current.get(DOMAIN));
		JSONObject ret = newService().queryWholeDataMode0(DOMAIN);
		assertEquals("READY", ret.getString("status"));
		assertSame(previous, ret.getJSONObject("data"));
		assertFalse(service.generatingDomains.contains(DOMAIN));
	}

	private void stubBuild() {
		when(businessConfigService.get(DOMAIN)).thenReturn(new BusinessConfig());
		Map<String, Object> rule = new HashMap<>();
		rule.put("classlist", List.of("C"));
		Map<String, Object> classDef = new HashMap<>();
		classDef.put("className", "C");
		classDef.put("showName", "C");
		rule.put("classDef", List.of(classDef));
		rule.put("relationship_rule", new HashMap<>());
		when(adminService.getJSONRule(DOMAIN)).thenReturn(rule);
	}
}
