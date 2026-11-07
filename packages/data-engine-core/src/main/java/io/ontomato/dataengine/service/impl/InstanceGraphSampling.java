package io.ontomato.dataengine.service.impl;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;

/** A fixed overview budget apportioned by population, with nonempty class coverage where possible. */
final class InstanceGraphSampling {
    static final int NODE_LIMIT = 1000;

    private InstanceGraphSampling() {}

    static Map<String, Integer> quotas(Map<String, Long> counts) {
        BigInteger total = counts.values().stream().map(BigInteger::valueOf)
                .reduce(BigInteger.ZERO, BigInteger::add);
        Map<String, Integer> quotas = new LinkedHashMap<>();
        if (total.compareTo(BigInteger.valueOf(NODE_LIMIT)) <= 0) {
            counts.forEach((name, count) -> quotas.put(name, count.intValue()));
            return quotas;
        }
        Map<String, BigInteger> remainders = new LinkedHashMap<>();
        counts.forEach((name, count) -> {
            BigInteger[] share = BigInteger.valueOf(count).multiply(BigInteger.valueOf(NODE_LIMIT))
                    .divideAndRemainder(total);
            quotas.put(name, share[0].intValue());
            remainders.put(name, share[1]);
        });
        var ranked = new ArrayList<>(counts.keySet());
        ranked.sort(Comparator.<String, BigInteger>comparing(remainders::get).reversed()
                .thenComparing(Comparator.naturalOrder()));
        int remaining = NODE_LIMIT - quotas.values().stream().mapToInt(Integer::intValue).sum();
        for (int i = 0; i < remaining; i++) quotas.merge(ranked.get(i), 1, Integer::sum);
        var missing = counts.keySet().stream()
                .filter(name -> counts.get(name) > 0 && quotas.get(name) == 0)
                .sorted().toList();
        for (String name : missing) {
            String donor = counts.keySet().stream().filter(candidate -> quotas.get(candidate) > 1)
                    .sorted(Comparator.<String, BigInteger>comparing(candidate ->
                            BigInteger.valueOf(quotas.get(candidate)).multiply(total)
                                    .subtract(BigInteger.valueOf(counts.get(candidate)).multiply(BigInteger.valueOf(NODE_LIMIT))))
                            .reversed().thenComparing(Comparator.naturalOrder()))
                    .findFirst().orElse(null);
            if (donor == null) break;
            quotas.merge(donor, -1, Integer::sum);
            quotas.put(name, 1);
        }
        return quotas;
    }
}
