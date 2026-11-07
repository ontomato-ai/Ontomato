package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

class InstanceGraphSamplingTest {
    @Test void keepsAllInstancesWithinBudgetIncludingEmptyClasses() {
        assertEquals(Map.of("A", 30, "B", 470, "Empty", 0),
                InstanceGraphSampling.quotas(Map.of("A", 30L, "B", 470L, "Empty", 0L)));
        assertEquals(Map.of(), InstanceGraphSampling.quotas(Map.of()));
    }

    @Test void allocatesByPopulationRatherThanEqualClassCaps() {
        assertEquals(Map.of("Places", 22, "Utterances", 978),
                InstanceGraphSampling.quotas(Map.of("Places", 235L, "Utterances", 10415L)));
        assertEquals(Map.of("A", 800, "B", 200),
                InstanceGraphSampling.quotas(Map.of("A", 8000L, "B", 2000L)));
        assertEquals(Map.of("Large", 999, "Tiny", 1),
                InstanceGraphSampling.quotas(Map.of("Large", 1000000L, "Tiny", 1L)));
    }

    @Test void includesEveryNonemptyClassWithoutExceedingItsPopulationOrTheBudget() {
        var counts = new LinkedHashMap<String, Long>();
        counts.put("Large", 1000000L);
        counts.put("Empty", 0L);
        for (int i = 0; i < 999; i++) counts.put("Tiny" + i, 1L);
        var quotas = InstanceGraphSampling.quotas(counts);
        assertEquals(1000, quotas.values().stream().mapToInt(Integer::intValue).sum());
        counts.forEach((name, count) -> assertEquals(count == 0 ? 0 : 1, quotas.get(name)));
    }

    @Test void usesLargestRemaindersWithStableClassNameTies() {
        assertEquals(Map.of("A", 334, "B", 333, "C", 333),
                InstanceGraphSampling.quotas(Map.of("C", 1000L, "B", 1000L, "A", 1000L)));
        var counts = new LinkedHashMap<String, Long>();
        for (int i = 0; i < 1100; i++) counts.put("C" + i, 1L);
        var quotas = InstanceGraphSampling.quotas(counts);
        assertEquals(1000, quotas.values().stream().mapToInt(Integer::intValue).sum());
        assertTrue(quotas.values().stream().allMatch(quota -> quota == 0 || quota == 1));
    }

    @Test void largeCountsDoNotOverflowDuringApportionment() {
        assertEquals(Map.of("A", 500, "B", 500),
                InstanceGraphSampling.quotas(Map.of("A", Long.MAX_VALUE, "B", Long.MAX_VALUE)));
    }
}
