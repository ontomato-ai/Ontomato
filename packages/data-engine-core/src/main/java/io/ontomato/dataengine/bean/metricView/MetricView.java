package io.ontomato.dataengine.bean.metricView;

import java.util.Set;
import java.util.List;

import io.ontomato.dataengine.bean.function.Function;

import lombok.Data;

@Data
public class MetricView {
	
	public static final String STATUS_PENDING_REVIEW = "PENDING_REVIEW";
	public static final String STATUS_PUBLISHED = "PUBLISHED";
	public static final String STATUS_UNUSED = "UNUSED";
	
	public static final String ORIGIN_SYSTEM = "SYSTEM";
	public static final String ORIGIN_USER = "USER";
	

	private String id;
	private String name;
	private String origin;
	private List<MetricViewBinding> bindings;
	private Function function;
	private String description;
	private String status;
	private Long createTimestamp;
	private Long modifyTimestamp;
	private Set<String> matchQuestions;
	private String domainId;
    /** Written by workflow publication, not supplied by the metric author. */
    public record WorkflowSource(String workflowId, int version, Purpose purpose) {
        public enum Purpose { pending, detail }
    }
    private WorkflowSource workflowSource;
    @com.alibaba.fastjson2.annotation.JSONField(serialize = false, deserialize = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    public boolean isWorkflowPending() {
        return workflowSource != null && workflowSource.purpose() == WorkflowSource.Purpose.pending;
    }

	private String originQuestion;
	private OriginCheckResult originCheckResult;

	/** The subject who created this metric view; taken from the request, never from a body. */
	private String createdBy;

	/** The subject who last published it; publication is the review moment. */
	private String reviewedBy;
	
}
