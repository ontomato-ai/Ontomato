package io.ontomato.dataengine.service;

/** One recall hit: a published metric, the preset whose brief ranked nearest when there is one, and the L2 distance. */
public record MetricRecall(String metricId, String bindingId, double distance) {}
