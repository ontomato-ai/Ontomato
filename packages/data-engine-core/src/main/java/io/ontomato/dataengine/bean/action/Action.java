package io.ontomato.dataengine.bean.action;

import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;

import lombok.Data;

@Data
public class Action {
	
	public static final String ORIGIN_SYSTEM = "SYSTEM";
	public static final String ORIGIN_USER = "USER";
	
	public static final String STATUS_PENDING_REVIEW = "PENDING_REVIEW";
	public static final String STATUS_PUBLISHED = "PUBLISHED";
	public static final String STATUS_UNUSED = "UNUSED";

	public static final int EXPLANATION_VERSION = 1;

	private String id;
	private String name;
	private String description;
	private String origin;
	private Function function;
	private JSONArray codeSegments;
	private BusinessMeaning businessMeaning;
	/** Derived, read-only structured projection; never an execution definition. */
	private JSONObject definition;
	/** Authored or generation-time submission criteria; null for legacy actions. */
	private JSONObject submissionCriteria;
	private String codeHash;
	private Integer explanationVersion;
	private String status;
	private Long createTimestamp;
	private Long modifyTimestamp;
	private String domainId;

	/**
	 * The subject who created this action. Taken from the authenticated request and never accepted
	 * from a body, so a caller cannot claim to be someone else's author. Set once and never updated:
	 * the stored value survives later saves.
	 */
	private String createdBy;

	/**
	 * The subject who last published this action. Publication is the review moment, so this is the
	 * reviewer. Only the latest one is kept; a publish that carries no subject preserves the stored
	 * value rather than clearing it.
	 */
	private String reviewedBy;
	
}
