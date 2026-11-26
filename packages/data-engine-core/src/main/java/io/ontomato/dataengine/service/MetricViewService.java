package io.ontomato.dataengine.service;

import java.util.List;
import io.ontomato.dataengine.service.authorization.DefinitionFirstPublication.Selection;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface MetricViewService {
    MetricViewContent test(MetricView metricView, String lang, User user, UserDataPermission permission, int timeoutMinutes, ExecutionTarget target) throws Exception;
    Object[] execute(String id, String bindingId, JSONObject param, JSONObject parameterTexts, String lang, User user, UserDataPermission permission, int timeoutMinutes, ExecutionTarget target) throws Exception;
    Object[] testExecute(MetricView metric, String bindingId, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes, ExecutionTarget target) throws Exception;

    List<MetricView> queryForRetrieval(String domainId,String query,String cursor,List<String> classes,int limit);

    /** Vector recall of published read metrics and their presets, with an absolute distance ceiling. */
    List<MetricRecall> recall(String question, String domainId, double maxDistance, int maxRows);
	
	default MetricView generateFromNatureLanguage(String question, String lang, String domainId, boolean persistence) throws Exception {
        return generateFromNatureLanguage(question, lang, domainId, persistence, null);
    }

    MetricView generateFromNatureLanguage(String question, String lang, String domainId, boolean persistence,
                                         Selection publication) throws Exception;

	public MetricView generateFromFunction(Function function);
	
    MetricView publishWorkflowMetric(MetricView metric, String lang);
    List<MetricView> pendingForRetrieval(String domainId, String cursor, List<String> classes, int limit);

	default MetricView save(MetricView metricView, String lang) throws Exception {
        return save(metricView, lang, null);
    }

    MetricView save(MetricView metricView, String lang, Selection publication) throws Exception;

    MetricView saveAdoptedCandidate(MetricView metric, User user, String lang);

    MetricView requireExecutable(String id, User user);
	
	public void delete(String id, String domainId, String lang) throws Exception;

	String systemDeletionRefusal(String id, String domainId, String lang);

	String systemDeletionRefusal(String id, String lang, SubjectContext subject);
	
	public MetricView queryById(String id, String domainId);

    MetricView appendBinding(String id, MetricViewBinding binding, String domainId);
	
	public List<MetricView> queryList(String status, String functionId, String className, String domainId);

    /** The number of metric views the list filters select, without hydrating bindings or display fields. */
    long count(String status, String functionId, String className, String origin, SubjectContext subject);

    /** The owner's form description for a MetricView, or a field error for an incoming draft. */
    JSONObject form(JSONObject request, String lang, SubjectContext subject);

    /** One item of a batch publication-status change: its saved metric, its refusal, or why it failed. */
    record StatusResult(String id, MetricView data, OwnerRefusal refusal, String error) {}

    /** Change only the status of each metric, one transaction per id. */
    default List<StatusResult> setStatus(String domainId, List<String> ids, String status, String lang) {
        return setStatus(domainId, ids, status, lang, null);
    }

    List<StatusResult> setStatus(String domainId, List<String> ids, String status, String lang, Selection publication);
	
	public List<MetricView> find(String question, String className, String domainId);

	public byte[] exportMetricViews(String domainId, String lang) throws Exception;

	public JSONObject importMetricViews(byte[] zipData, String lang) throws Exception;
	
	public MetricViewContent test(MetricView metricView, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
	/** Returns {rows, PythonExecuteResult}; parameterTexts overrides param after Java form parsing. */
	public Object[] execute(String id, String bindingId, JSONObject param, JSONObject parameterTexts, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
	/** Returns {rows, PythonExecuteResult}; the result carries the run's partial-query status. */
	public Object[] testExecute(MetricView metricView, String bindingId, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
}
