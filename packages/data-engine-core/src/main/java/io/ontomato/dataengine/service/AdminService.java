package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface AdminService {

	public void setDataSetDesc(String dataSetDesc, User user);
	
	public void setClassInStarChart(String className, boolean inStarChart, User user);
	
	public void setClassAttrTimeFormat(String className, String attr, String format, User user);
	
	public void addBucketIndicator(String className, String attrName, String indicatorName, String indicatorDesc, String indicatorUnit, String lang, User user) throws Exception;
	
	public void delBucketIndicator(String className, String attrName, String indicatorName, User user);
	
	public void setBucketIndicatorDesc(String className, String attr, String indicator, String desc, User user);
	
	public void setBucketIndicatorUnit(String className, String attr, String indicator, String unit, User user);
	
	/** Save the whole rule; the model-wide primary-key check runs before the store sees it. */
	public void writeJSONRule(Map<String, Object> jsonRule, String domainId);

	public Map<String, Object> getJSONRule(String domainId);

	public Map<String, String> getSchemaMarkdown(List<String> classNames, String domainId);
	
	public Map<String, String> getSchemaMarkdownV2(List<String> classNames, String domainId);
	
	public String getSchemaByClassName(List<String> classNames, String domainId);
	
	public String getRelationshipByClassNames(List<String> classNames, String domainId);
	
	public String queryDistinctAttrValue(String className, String attrName, String like, int limit, UserDataPermission permission, String domainId);

	public String getBussinessKnowledgeMarkdown(String domainId);
	
	public JSONObject getPrettyJSONRule(String domainId);
	
	public void setPrettyJSONRule(JSONObject prettyJsonRule, String domainId);

}
