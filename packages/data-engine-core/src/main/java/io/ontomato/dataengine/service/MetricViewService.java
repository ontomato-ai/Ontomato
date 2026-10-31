package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface MetricViewService {
    List<MetricView> queryForRetrieval(String domainId,String query,String cursor,List<String> classes,int limit);
	
	public MetricView generateFromNatureLanguage(String question, String lang, String domainId, boolean persistence) throws Exception;

	public MetricView generateFromFunction(Function function);
	
	public MetricView save(MetricView metricView, String lang) throws Exception;
	
	public void delete(String id, String domainId, String lang) throws Exception;
	
	public MetricView queryById(String id, String domainId);

    MetricView appendBinding(String id, MetricViewBinding binding, String domainId);
	
	public List<MetricView> queryList(String status, String functionId, String className, String domainId);
	
	public List<MetricView> find(String question, String className, String domainId);

	public byte[] exportMetricViews(String domainId, String lang) throws Exception;

	public JSONObject importMetricViews(byte[] zipData, String lang) throws Exception;
	
	public MetricViewContent test(MetricView metricView, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
	/** Returns {rows, PythonExecuteResult}; the result carries the run's partial-query status. */
	public Object[] execute(String id, String bindingId, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
	/** Returns {rows, PythonExecuteResult}; the result carries the run's partial-query status. */
	public Object[] testExecute(MetricView metricView, String bindingId, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
}
