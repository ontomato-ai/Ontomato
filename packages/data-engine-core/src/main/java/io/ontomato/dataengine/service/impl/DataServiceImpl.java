package io.ontomato.dataengine.service.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.DataService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.QueryPermissions;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslPermissionUtil;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;
import io.ontomato.dataengine.util.HttpRequestUtil;

import cn.hutool.core.lang.UUID;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class DataServiceImpl implements DataService {
	
	@Autowired
    DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;
	
	@Autowired
	private AdminService adminService;
	
	@Autowired
	private LangService langService;
	
	@Autowired
	private LiveInstanceGraph liveInstanceGraph;
	
	@Override
	public JSONObject queryInstanceGraph(String operation, JSONObject request, UserDataPermission permission, String domainId) {
		return liveInstanceGraph.query(operation, request, permission, domainId);
	}
	
	@Override
	public JSONObject queryInfoByNode(JSONObject node, String lang, UserDataPermission permission, String domainId) {
		JSONObject ret = new JSONObject();
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		try {
			Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
			List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
			Map<String, Object> classDef = null;
			for (Map<String, Object> d : classDefs) {
				if (node.getString("class").equals(d.get("className"))) {
					classDef = d;
					break;
				}
			}
			
			// The instance graph names a node className:primaryKeyValue.
			String pkField = DslUtil.getPrimaryKey(classDef);
			String pkValue = node.getString("id").substring(node.getString("class").length() + 1);
			
			JSONArray dsls = new JSONArray();
			JSONObject dsl = new JSONObject();
			dsl.put("problem", "");
			JSONObject answer = new JSONObject();
			JSONArray steps = new JSONArray();
			JSONObject step = new JSONObject();
			JSONObject graph = new JSONObject();
			JSONArray patterns = new JSONArray();
			JSONObject pattern = new JSONObject();
			JSONArray objects = new JSONArray();
			JSONObject object = new JSONObject();
			object.put("idx", 0);
			object.put("variable", "variable");
			object.put("class", classDef.get("className"));
			JSONObject conditions = new JSONObject();
			JSONObject properties = new JSONObject();
			properties.put("field", pkField);
			properties.put("operator", "=");
			properties.put("value", pkValue);
			conditions.put("properties", properties);
			object.put("conditions", conditions);
			objects.add(object);
			pattern.put("objects", objects);
			patterns.add(pattern);
			graph.put("patterns", patterns);
			graph.put("pattern_logic", "and");
			step.put("graph", graph);
			JSONObject output = new JSONObject();
			output.put("to_user", true);
			JSONArray fields = new JSONArray();
			for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
				if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
					JSONObject field = new JSONObject();
					field.put("variable", "variable");
					field.put("field", attrDef.get("name"));
					field.put("as", attrDef.get("name"));
					fields.add(field);
				}
			}
			output.put("fields", fields);
			step.put("output", output);
			steps.add(step);
			answer.put("steps", steps);
			dsl.put("answer", answer);
			dsls.add(dsl);
			DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), UUID.randomUUID().toString(), false, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
			Map<String, Object> dataMap = results[0].rawResponse();
			Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
			
			if (dataMap.get("data") != null 
					&& ((List)dataMap.get("data")).size() > 0 
					&& ((Map)((List)dataMap.get("data")).get(0)).get("answer") != null
					&& ((List)((Map)((List)dataMap.get("data")).get(0)).get("answer")).size() > 0) {
				if (rowPermissionDataMap.get("data") != null 
						&& ((List)rowPermissionDataMap.get("data")).size() > 0 
						&& ((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer") != null
						&& ((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).size() > 0) {
					JSONObject rowPermissionDataMapJson = JSONObject.parseObject(JSON.toJSONString(rowPermissionDataMap, Feature.WriteMapNullValue));
					JSONObject rowColPermissionDataMap = DslPermissionUtil.dealDslAnswerWithPermission(rowPermissionDataMapJson, permission, classDefs);
					JSONObject d = new JSONObject();
					d.put("classDef", classDef);
					d.put("data", rowColPermissionDataMap.getJSONArray("data").getJSONObject(0).getJSONArray("answer").getJSONObject(0));
					ret.put("data", d);
					ret.put("success", true);
				} else {
					ret.put("code", "DATA_PERMISSION_DENIED");
					ret.put("message", langService.get(lang, "Data.dataPermission.noPermission"));
					ret.put("success", false);
				}
			} else {
				ret.put("code", "OBJECT_NOT_FOUND");
				ret.put("message", langService.get(lang, "Data.object.notExist"));
				ret.put("success", false);
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("code", "QUERY_FAILED");
			ret.put("message", langService.get(lang, "Data.query.error"));
			ret.put("success", false);
		}
		
		return ret;
	}

	@Override
	public JSONObject fullTextSearch(JSONObject textSearch, String lang, UserDataPermission permission, String domainId) {
		JSONObject ret = new JSONObject();
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		String term = textSearch.get("term").toString();
		String limit = textSearch.get("limit").toString();
		int iLimit = Integer.parseInt(limit);
		
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		
		JSONArray allQueryData = new JSONArray();
		for(Map<String, Object> classDef : classDefs){
			String classDesc = (String)classDef.get("showName");
			String className = (String)classDef.get("className");
			String pk = "id";
			for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
	        	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable"))) {
	        		if (attrDef.get("primaryKey") != null && (Boolean)attrDef.get("primaryKey")) {
	        			pk = (String)attrDef.get("name");
	        		}
	        	}
	        }
			
			FieldPermission fieldPermission = permission.getFieldPermissionByClassName(className);
			if (permission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) {
				String sessionId = UUID.randomUUID().toString();
				JSONArray dsls = new JSONArray();
	            JSONObject dsl = new JSONObject();
	            dsl.put("problem", "");
	            JSONObject answer = new JSONObject();
	            JSONArray steps = new JSONArray();
	            JSONObject step0 = new JSONObject();
	            JSONObject graph0 = new JSONObject();
	            JSONArray patterns0 = new JSONArray();
	            JSONObject pattern0 = new JSONObject();
	            JSONArray objects0 = new JSONArray();
	            JSONObject object0 = new JSONObject();
	            object0.put("idx", 0);
	            object0.put("variable", "variable");
	            object0.put("class", className);
	            JSONObject conditions0 = new JSONObject();
	            JSONObject properties0 = new JSONObject();
	            properties0.put("operator", "logic");
	            JSONArray ors0 = new JSONArray();
	            for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
	            	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) && ("text".equals(attrDef.get("type")) || "varchar".equals(attrDef.get("type")))) {
	            		JSONObject or0 = new JSONObject();
	            		or0.put("field", attrDef.get("name"));
	            		or0.put("operator", "like");
	            		or0.put("value", "%" + term + "%");
	            		ors0.add(or0);
	            	}
	            }
	            properties0.put("or", ors0);
	            conditions0.put("properties", properties0);
	            object0.put("conditions", conditions0);
	            objects0.add(object0);
	            pattern0.put("objects", objects0);
	            patterns0.add(pattern0);
	            graph0.put("patterns", patterns0);
	            graph0.put("pattern_logic", "and");
	            step0.put("graph", graph0);
	            JSONObject output0 = new JSONObject();
	            output0.put("to_user", false);
	            output0.put("save_table", "/t-" + sessionId);
	            JSONArray fields0 = new JSONArray();
	            boolean hasId = false;
	            for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
	            	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) && attrDef.get("bizzkey") != null && (Boolean)attrDef.get("bizzkey")) {
	            		JSONObject field0 = new JSONObject();
	            		field0.put("variable", "variable");
	            		field0.put("field", attrDef.get("name"));
	            		field0.put("as", attrDef.get("name"));
	            		fields0.add(field0);
	            		if (pk.equals(attrDef.get("name"))) {
	            			hasId = true;
	            		}
	            	}
	            }
	            if (!hasId) {
	            	JSONObject field0 = new JSONObject();
	        		field0.put("variable", "variable");
	        		field0.put("field", pk);
	        		field0.put("as", pk);
	        		fields0.add(field0);
	            }
	            output0.put("fields", fields0);
	            step0.put("output", output0);
	            steps.add(step0);
	            JSONObject step1 = new JSONObject();
	            JSONObject graph1 = new JSONObject();
	            JSONArray patterns1 = new JSONArray();
	            JSONObject pattern1 = new JSONObject();
	            JSONArray objects1 = new JSONArray();
	            JSONObject object1 = new JSONObject();
	            object1.put("variable", "variable");
	            object1.put("class", "/t-" + sessionId);
	            objects1.add(object1);
	            pattern1.put("objects", objects1);
	            patterns1.add(pattern1);
	            graph1.put("patterns", patterns1);
	            graph1.put("pattern_logic", "and");
	            step1.put("graph", graph1);
	            JSONObject output1 = new JSONObject();
	            output1.put("to_user", true);
	            JSONArray fields1 = new JSONArray();
	            for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
	            	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) && attrDef.get("bizzkey") != null && (Boolean)attrDef.get("bizzkey")) {
	            		JSONObject field1 = new JSONObject();
	            		field1.put("variable", "variable");
	            		field1.put("field", attrDef.get("name"));
	            		field1.put("as", attrDef.get("name"));
	            		fields1.add(field1);
	            	}
	            }
	            if (!hasId) {
	            	JSONObject field1 = new JSONObject();
	        		field1.put("variable", "variable");
	        		field1.put("field", pk);
	        		field1.put("as", pk);
	        		fields1.add(field1);
	            }
	            output1.put("fields", fields1);
	            JSONObject limit1 = new JSONObject();
	            limit1.put("offset", 0);
	            limit1.put("count", iLimit);
	            output1.put("limit", limit1);
	            step1.put("output", output1);
	            steps.add(step1);
	            answer.put("steps", steps);
	            dsl.put("answer", answer);
	            dsls.add(dsl);
	            
	            DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
	            Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
	            JSONArray rows = new JSONArray();
	            if (rowPermissionDataMap.get("data") != null 
	            		&& ((List)rowPermissionDataMap.get("data")).size() > 0 
	            		&& ((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer") != null
	            		&& ((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).size() > 0) {
	            	List _rows = (List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer");
	            	for (Object _row : _rows) {
	            		Map<String, Object> row = (Map<String, Object>)_row;
	            		row.put("classDesc", classDesc);
	            		row.put("className", className);
	            		rows.add(row);
	            	}
	            }
	            allQueryData.addAll(rows);
				if(allQueryData.size() >= iLimit) {
					break;
				}
			}
		}

		if(allQueryData.size() > 0) {
			ret.put("data", allQueryData.subList(0, Math.min(allQueryData.size(), iLimit)));
		} else {
			ret.put("data", allQueryData);
		}

		ret.put("success", true);

		return ret;
	}

	@Override
	public JSONObject getClassAndCount(String lang, UserDataPermission permission, String domainId){
		JSONObject ret = new JSONObject();
		JSONArray allQueryData = new JSONArray();
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		
		for(Map<String, Object> classDef : classDefs) {
			String className = (String)classDef.get("className");
			FieldPermission fieldPermission = permission.getFieldPermissionByClassName(className);
			
			if (permission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) {
				Integer count = getCountByClassName(buildClassQueryObject(className, null), DslUtil.getPrimaryKey(classDef), jsonRule, permission, domainId);
				Map<String,Object> classAndCount = new HashMap<String,Object>();
				classAndCount.put("className", className);
				classAndCount.put("showName", classDef.get("showName"));
				classAndCount.put("count", count);
				allQueryData.add(classAndCount);
			}
		}

		ret.put("data", allQueryData);
		ret.put("success", true);

		return ret;
	}
	
	static JSONObject buildClassQueryObject(String className, String searchTerm) {
		JSONObject object = new JSONObject();
		object.put("idx", 0);
		object.put("variable", "variable");
		object.put("class", className);
		if (searchTerm != null) {
			JSONObject conditions = new JSONObject();
			JSONObject text = new JSONObject();
			text.put("fields", new JSONArray());
			text.put("operator", "match");
			text.put("boost", 1.0);
			text.put("query", searchTerm);
			conditions.put("text", text);
			object.put("conditions", conditions);
		}
		return object;
	}

	private Integer getCountByClassName(JSONObject queryObject, String pk, Map<String, Object> jsonRule,
			UserDataPermission permission, String domainId) {
		String sessionId = UUID.randomUUID().toString();
		JSONArray dsls = new JSONArray();
        JSONObject dsl = new JSONObject();
        dsl.put("problem", "");
        JSONObject answer = new JSONObject();
        JSONArray steps = new JSONArray();
        JSONObject step0 = new JSONObject();
        JSONObject graph0 = new JSONObject();
        JSONArray patterns0 = new JSONArray();
        JSONObject pattern0 = new JSONObject();
        JSONArray objects0 = new JSONArray();
		objects0.add(queryObject);
        pattern0.put("objects", objects0);
        patterns0.add(pattern0);
        graph0.put("patterns", patterns0);
        graph0.put("pattern_logic", "and");
        step0.put("graph", graph0);
        JSONObject output0 = new JSONObject();
        output0.put("to_user", true);
        JSONArray fields0 = new JSONArray();
        JSONObject field0 = new JSONObject();
		field0.put("variable", "variable");
		field0.put("field", pk);
		field0.put("function", "count");
		field0.put("as", "count_id");
		fields0.add(field0);
        output0.put("fields", fields0);
        step0.put("output", output0);
        steps.add(step0);
        answer.put("steps", steps);
        dsl.put("answer", answer);
        dsls.add(dsl);
        
        BusinessConfig businessConfig = businessConfigService.get(domainId);
		DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
		JSONArray rows = classPageRows(results[1]);
		return rows.isEmpty() ? 0 : rows.getJSONObject(0).getIntValue("count_id");
	}

	private static JSONArray classPageRows(DslExecutionResult result) {
		if (result.failed()) {
			throw new IllegalStateException("Class data query failed", result.failure().cause());
		}
		return result.data().getJSONArray("data").getJSONObject(0).getJSONArray("answer");
	}

	private static ResponseStatusException invalidClassPage(String reason) {
		return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
	}

	private static Map<String, Object> requirePageField(Object field, List<Map<String, Object>> attributes,
			String className, UserDataPermission permission) {
		if (!(field instanceof String name) || name.isBlank()) throw invalidClassPage("Expected a field name");
		var attribute = attributes.stream().filter(attr -> name.equals(attr.get("name"))).findFirst()
				.orElseThrow(() -> invalidClassPage("Unknown or disabled field: " + name));
		QueryPermissions.requireField(permission, className, name, QueryPermissions.Use.DETAIL);
		return attribute;
	}

	private static JSONObject pageFilter(Map<?, ?> filter, String className,
			List<Map<String, Object>> attributes, UserDataPermission permission) {
		Object field = filter.get("field");
		var attribute = requirePageField(field, attributes, className, permission);
		if (!(filter.get("operator") instanceof String operator)) throw invalidClassPage("Expected a filter operator");
		Object value = filter.get("value");
		String dslOperator = switch (operator) {
			case "eq" -> "=";
			case "ne" -> "!=";
			case "contains" -> "like";
			case "gt" -> ">";
			case "lt" -> "<";
			case "gte" -> ">=";
			case "lte" -> "<=";
			case "null" -> "is";
			case "notnull" -> "is not";
			default -> throw invalidClassPage("Unknown filter operator: " + operator);
		};
		if ("is".equals(dslOperator) || "is not".equals(dslOperator)) {
			if (filter.containsKey("value")) throw invalidClassPage("Null filters do not take a value");
			return JSONObject.of("field", field, "operator", dslOperator, "value", null);
		}
		if (!(value instanceof String || value instanceof Number || value instanceof Boolean))
			throw invalidClassPage("Expected a scalar filter value for " + field);
		if ("like".equals(dslOperator)) {
			if (!(value instanceof String text)) throw invalidClassPage("Contains requires a text value");
			String pattern = text.replace("!", "!!").replace("%", "!%").replace("_", "!_");
			return JSONObject.of("field", field, "operator", dslOperator, "value", "%" + pattern + "%", "escape", "!");
		}
		// Numeric columns are rendered as numeric literals by the data adapters.
		if (attribute.get("type") instanceof String type
				&& List.of("int", "long", "double", "float", "decimal", "number").contains(type)
				&& !(value instanceof Number)) {
			if (!(value instanceof String text)) throw invalidClassPage("Expected a numeric value for " + field);
			try {
				value = new BigDecimal(text);
			} catch (NumberFormatException e) {
				throw invalidClassPage("Expected a numeric value for " + field);
			}
		}
		return JSONObject.of("field", field, "operator", dslOperator, "value", value);
	}

	private static void applyPageFilters(JSONObject queryObject, Object filters, String className,
			List<Map<String, Object>> attributes, UserDataPermission permission) {
		if (!(filters instanceof List<?> list)) throw invalidClassPage("Expected a filters array");
		JSONArray clauses = new JSONArray();
		for (Object item : list) {
			if (!(item instanceof Map<?, ?> filter)) throw invalidClassPage("Expected a filter object");
			clauses.add(pageFilter(filter, className, attributes, permission));
		}
		if (clauses.isEmpty()) return;
		JSONObject conditions = queryObject.getJSONObject("conditions");
		if (conditions == null) {
			conditions = new JSONObject();
			queryObject.put("conditions", conditions);
		}
		conditions.put("properties", JSONObject.of("operator", "logic", "and", clauses));
	}

	@Override
	public JSONObject getClassDataByPage(JSONObject classSearch, String lang, UserDataPermission permission, String domainId) {
		return getClassDataByPage(classSearch, lang, permission, true, domainId);
	}
	
	@Override
	public JSONObject getWholeClassDataByPage(JSONObject classSearch, String lang, UserDataPermission permission, String domainId) {
		return getClassDataByPage(classSearch, lang, permission, false, domainId);
	}

	private JSONObject getClassDataByPage(JSONObject classSearch, String lang, UserDataPermission permission, boolean withBizzKey, String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		
		JSONObject ret = new JSONObject();
		
		String className = classSearch.get("classname").toString();
		String searchTerm = classSearch.getString("search");
		if (searchTerm != null ) {
			searchTerm = searchTerm.trim();
			if ("".equals(searchTerm)) {
				searchTerm = null;
			}
		}
		int pageNum = Integer.valueOf(classSearch.get("pagenum").toString());
		int pagecount = Integer.valueOf(classSearch.get("pagecount").toString());
		int start = (pageNum-1)*pagecount <0 ? 0 : (pageNum-1)*pagecount;

		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for(Map<String, Object> mapClassDef : classDefs) {
			String classNameDef = (String) mapClassDef.get("className");
			if (classNameDef.equals(className)) {
				classDef = mapClassDef;
				break;
			}
		}
		if (classDef == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown class: " + className);
		List<Map<String, Object>> attributes = ((List<Map<String, Object>>)classDef.get("attrs")).stream()
				.filter(attr -> !Boolean.FALSE.equals(attr.get("enable"))).toList();
		String pk = DslUtil.getPrimaryKey(classDef);
		JSONObject queryObject = buildClassQueryObject(className, searchTerm);
		if (!withBizzKey && classSearch.containsKey("filters"))
			applyPageFilters(queryObject, classSearch.get("filters"), className, attributes, permission);
		JSONArray sortFields = JSONArray.of(JSONObject.of("variable", "variable", "field", pk, "order", "asc"));
		if (!withBizzKey && classSearch.containsKey("sort")) {
			if (!(classSearch.get("sort") instanceof Map<?, ?> sort)) throw invalidClassPage("Expected a sort object");
			Object field = sort.get("field");
			requirePageField(field, attributes, className, permission);
			Object order = sort.get("order");
			if (!"asc".equals(order) && !"desc".equals(order)) throw invalidClassPage("Expected sort order asc or desc");
			if (pk.equals(field) || !QueryPermissions.allowed(permission, className, pk, QueryPermissions.Use.DETAIL))
				sortFields.clear();
			sortFields.addFirst(JSONObject.of("variable", "variable", "field", field, "order", order));
		}

		FieldPermission fieldPermission = permission.getFieldPermissionByClassName(className);
		if (permission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) {
			// Query details by page
			String sessionId = UUID.randomUUID().toString();
			JSONArray dsls = new JSONArray();
            JSONObject dsl = new JSONObject();
            dsl.put("problem", "");
            JSONObject answer = new JSONObject();
            JSONArray steps = new JSONArray();
            JSONObject step0 = new JSONObject();
            JSONObject graph0 = new JSONObject();
            JSONArray patterns0 = new JSONArray();
            JSONObject pattern0 = new JSONObject();
            JSONArray objects0 = new JSONArray();
			objects0.add(queryObject);
            pattern0.put("objects", objects0);
            patterns0.add(pattern0);
            graph0.put("patterns", patterns0);
            graph0.put("pattern_logic", "and");
            step0.put("graph", graph0);
            JSONObject output0 = new JSONObject();
            output0.put("to_user", true);
            JSONArray fields0 = new JSONArray();
            boolean hasId = false;
            for (Map<String, Object> attrDef : (List<Map<String, Object>>)classDef.get("attrs")) {
            	if ((attrDef.get("enable") == null || (Boolean)attrDef.get("enable"))) {
            		if (withBizzKey && attrDef.get("bizzkey") != null && (Boolean)attrDef.get("bizzkey") || !withBizzKey) {
            			JSONObject field0 = new JSONObject();
                		field0.put("variable", "variable");
                		field0.put("field", attrDef.get("name"));
                		field0.put("as", attrDef.get("name"));
                		fields0.add(field0);
                		if (pk.equals(attrDef.get("name"))) {
                			hasId = true;
                		}
            		}
            	}
            }
            if (!hasId) {
            	JSONObject field0 = new JSONObject();
        		field0.put("variable", "variable");
        		field0.put("field", pk);
        		field0.put("as", pk);
        		fields0.add(field0);
            }
            
            output0.put("fields", fields0);
            output0.put("sort", JSONObject.of("fields", sortFields));
            JSONObject limit0 = new JSONObject();
            limit0.put("offset", start);
            limit0.put("count", pagecount);
            output0.put("limit", limit0);
            step0.put("output", output0);
            steps.add(step0);
            answer.put("steps", steps);
            dsl.put("answer", answer);
            dsls.add(dsl);
            
			DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
            JSONArray rows = classPageRows(results[1]);
			Integer totalCount = getCountByClassName(queryObject, pk, jsonRule, permission, domainId);
            int totalPage = totalCount % pagecount == 0 ? totalCount / pagecount : totalCount / pagecount + 1;
            rows = io.ontomato.dataengine.service.QueryPermissions.mask(rows,
                io.ontomato.dataengine.service.QuerySourceAnalysis.fromDsl(dsl, classDefs), permission);
            ret.put("data", rows);
            if (!withBizzKey) {
                ret.put("readable_fields", attributes.stream().map(attr -> (String) attr.get("name"))
                        .filter(field -> QueryPermissions.allowed(permission, className, field, QueryPermissions.Use.DETAIL))
                        .toList());
            }
    		ret.put("total_count", totalCount);
    		ret.put("total_page", totalPage);
    		ret.put("cur_page", pageNum);
    		ret.put("success", true);
		} else {
			ret.put("code", "DATA_PERMISSION_DENIED");
			ret.put("message", langService.get(lang, "Data.dataPermission.noPermission"));
			ret.put("success", false);
		}
		
		return ret;
	}
	
	@Override
	public List<String> queryDistinctAttrValue(String className, String attrName, String query, UserDataPermission permission, String domainId) throws Exception {
        io.ontomato.dataengine.service.QueryPermissions.requireField(permission, className, attrName, io.ontomato.dataengine.service.QueryPermissions.Use.GROUP);
		List<String> values = new ArrayList<String>();
		
		Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
		List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
		Map<String, Object> classDef = null;
		for (Map<String, Object> cd : classDefs) {
			if (cd.get("className").equals(className)) {
				classDef = cd;
				break;
			}
		}
		if (classDef != null) {
			List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
			Map<String, Object> attrDef = null;
			for (Map<String, Object> ad : attrDefs) {
				if (ad.get("name").equals(attrName)) {
					attrDef = ad;
					break;
				}
			}
			if (attrDef != null) {
				if ("varchar".equals(attrDef.get("type")) || "text".equals(attrDef.get("type"))) {
					String sessionId = UUID.randomUUID().toString();
					JSONArray dsls = new JSONArray();
			        JSONObject dsl = new JSONObject();
			        dsl.put("problem", "");
			        JSONObject answer = new JSONObject();
			        JSONArray steps = new JSONArray();
			        JSONObject step0 = new JSONObject();
			        JSONObject graph0 = new JSONObject();
			        JSONArray patterns0 = new JSONArray();
			        JSONObject pattern0 = new JSONObject();
			        JSONArray objects0 = new JSONArray();
			        JSONObject object0 = new JSONObject();
			        object0.put("idx", 0);
			        object0.put("variable", "variable");
			        object0.put("class", className);
			        if (query != null && !"".equals(query.trim())) {
			        	query = "%" + query.trim() + "%";
			        	JSONObject conditions = new JSONObject();
			        	JSONObject properties = new JSONObject();
			        	properties.put("field", attrName);
			        	properties.put("operator", "like");
			        	properties.put("value", query);
			        	conditions.put("properties", properties);
			        	object0.put("conditions", conditions);
			        }
			        objects0.add(object0);
			        pattern0.put("objects", objects0);
			        patterns0.add(pattern0);
			        graph0.put("patterns", patterns0);
			        graph0.put("pattern_logic", "and");
			        step0.put("graph", graph0);
			        JSONObject output0 = new JSONObject();
			        output0.put("to_user", true);
			        JSONArray fields0 = new JSONArray();
			        JSONObject field0 = new JSONObject();
					field0.put("variable", "variable");
					field0.put("field", attrName);
					field0.put("distinct", true);
					field0.put("as", attrName);
					fields0.add(field0);
			        output0.put("fields", fields0);
			        step0.put("output", output0);
			        steps.add(step0);
			        answer.put("steps", steps);
			        dsl.put("answer", answer);
			        dsls.add(dsl);
			        
			        BusinessConfig businessConfig = businessConfigService.get(domainId);
			        DslExecutionResult[] results = HttpRequestUtil.executeDsl(dataRagConfig, dataAdapterRegistry.create(businessConfig, jsonRule), JSON.toJSONString(dsls, Feature.WriteMapNullValue), sessionId, true, jsonRule, vectorResourceDao, permission, DslExecutionMode.OPTIMIZED, domainId);
			        Map<String, Object> rowPermissionDataMap = results[1].rawResponse();
			        if (rowPermissionDataMap.get("data") != null 
			        		&& ((List)rowPermissionDataMap.get("data")).size() > 0 
			        		&& ((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer") != null
			        		&& ((List)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer")).size() > 0) {
			        	List<Map<String, Object>> rows = (List<Map<String, Object>>)((Map)((List)rowPermissionDataMap.get("data")).get(0)).get("answer");
			        	for (Map<String, Object> row : rows) {
			        		if (row.get(attrName) != null) {
			        			values.add(((String)row.get(attrName)).trim());
			        		}
			        	}
			        }
				}
			}
		}
		
		return values;
	}
}
