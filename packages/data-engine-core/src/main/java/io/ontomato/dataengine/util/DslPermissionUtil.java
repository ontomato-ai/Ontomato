package io.ontomato.dataengine.util;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.DslConsanguinity;
import io.ontomato.dataengine.core.exception.ServiceException;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class DslPermissionUtil {
	
    public static Object[] addRowPermission(String dslStr, List<Map<String, Object>> classDefs, UserDataPermission permission) {
        JSONArray dsls = JSON.parseArray(dslStr);
        if (dsls.size() != 1) throw new IllegalArgumentException("One DSL query is required");
        JSONObject dsl = dsls.getJSONObject(0);
        Set<String> temporary = new HashSet<>();
        boolean changed = false;
        for (Object value : dsl.getJSONObject("answer").getJSONArray("steps")) {
            JSONObject step = JSONObject.from(value);
            for (Object patternValue : step.getJSONObject("graph").getJSONArray("patterns")) {
                JSONObject pattern = JSONObject.from(patternValue);
                for (Object objectValue : pattern.getJSONArray("objects")) {
                    JSONObject object = (JSONObject) objectValue;
                    String name = object.getString("class");
                    if (temporary.contains(name)) continue;
                    JSONObject rule = permission.getRowPermissionMQLByClassName(name);
                    if (rule == null) continue;
                    JSONObject conditions = object.getJSONObject("conditions");
                    if (conditions == null) { conditions = new JSONObject(); object.put("conditions", conditions); }
                    JSONObject original = conditions.getJSONObject("properties");
                    conditions.put("properties", original == null ? rule : JSONObject.of("operator", "logic", "and", JSONArray.of(original, rule)));
                    changed = true;
                }
            }
            JSONObject output = step.getJSONObject("output");
            if (output != null && output.getString("save_table") != null) temporary.add(output.getString("save_table"));
        }
        return new Object[] {dsl, changed};
    }

	public static JSONObject dealDslAnswerWithPermission(JSONObject dataMap, UserDataPermission permission, List<Map<String, Object>> classDefs) {
		SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
		
		JSONObject dsl = dataMap.getJSONObject("dsl");
		if (dsl != null) {
			// Get the DSL lineage
			Map<String, DslConsanguinity> consanguinityMap = DslUtil.findConsanguinityFromDsl(dsl, classDefs);
			// Output attributes without permission
			List<String> noPermissionKeys = new ArrayList<String>();
            var graphSources = io.ontomato.dataengine.service.QueryPermissions.sources(
                io.ontomato.dataengine.service.QuerySourceAnalysis.fromDsl(dsl, classDefs));
            graphSources.forEach((key, sources) -> {
                if (sources.stream().anyMatch(source -> !io.ontomato.dataengine.service.QueryPermissions.allowed(
                    permission, source.className(), source.attrName(), source.use()))) noPermissionKeys.add(key);
            });

			// Output metrics without permission
			Map<String, Set<String>> noPermissionIndicatorsMap = new HashMap<String, Set<String>>();
			// Definition mapping of time series type fields
			Map<String, Map<String, String>> bucketIndicatorDefMap = new HashMap<String, Map<String, String>>();
			// The ID field of all classes should not be returned
			Set<String> notReturnIds = new HashSet<String>();
			for (String as : consanguinityMap.keySet()) {
				DslConsanguinity consanguinity = consanguinityMap.get(as);
				if (!"".equals(consanguinity.getClassName())) { // Output attributes after multi-field calculation are not subject to permission control
					String className = consanguinity.getClassName();
					var use = Boolean.TRUE.equals(consanguinity.getAsGroupBy())
                            ? io.ontomato.dataengine.service.QueryPermissions.Use.GROUP
                            : io.ontomato.dataengine.service.QuerySourceAnalysis.aggregate(consanguinity.getFunction())
                              ? io.ontomato.dataengine.service.QueryPermissions.Use.AGGREGATE
                              : io.ontomato.dataengine.service.QueryPermissions.Use.DETAIL;
                        if (consanguinity.getIndicatorNames() != null &&
                            io.ontomato.dataengine.service.QueryPermissions.fieldAvailable(permission, className, consanguinity.getAttrName())) {
                            noPermissionKeys.remove(as);
                            Set<String> denied = new HashSet<>();
                            for (String indicator : consanguinity.getIndicatorNames())
                                if (!io.ontomato.dataengine.service.QueryPermissions.allowed(permission, className, consanguinity.getAttrName(), use) &&
                                    !io.ontomato.dataengine.service.QueryPermissions.allowed(permission, className, consanguinity.getAttrName() + "." + indicator, use)) denied.add(indicator);
                            if (!denied.isEmpty()) noPermissionIndicatorsMap.put(as, denied);
                        }
                        // Definition mapping of time series type fields
					if (consanguinity.getIndicatorNames() != null) {
						Map<String, Object> attrDef = null;
						for (Map<String, Object> classDef : classDefs) {
							if (classDef.get("className").equals(className)) {
								for (Map<String, Object> ad : (List<Map<String, Object>>)classDef.get("attrs")) {
									if (ad.get("name").equals(consanguinity.getAttrName())) {
										attrDef = ad;
										break;
									}
								}
								break;
							}
						}
						if (attrDef != null) {
							Map<String, String> indicatorDefMap = new HashMap<String, String>();
							if (attrDef.get("indicators") != null && attrDef.get("indicators") instanceof List) {
								for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
									String desc = (String)indicatorDef.get("desc");
									if (indicatorDef.get("unit") != null && !"".equals(((String)indicatorDef.get("unit")).trim())) {
										desc += "(unit: " + indicatorDef.get("unit") + ")";
									}
									indicatorDefMap.put((String)indicatorDef.get("name"), desc);
								}
							}
							if (indicatorDefMap.size() > 0) {
								bucketIndicatorDefMap.put(as, indicatorDefMap);
							}
						}
					}
					// The ID field of all classes should not be returned
					if (consanguinity.getFunction() == null && (consanguinity.getAsGroupBy() == null || !consanguinity.getAsGroupBy()) && "id".equals(consanguinity.getAttrName())) {
						notReturnIds.add(as);
					}
				}
			}
			
			// Change the values of attributes or metrics without permission to "****"
			String password = "****";
			if (dataMap.getJSONArray("data") != null) {
	    		JSONArray data = dataMap.getJSONArray("data");
	    		for (int i = 0; i < data.size(); i++) {
	    			JSONObject datum = data.getJSONObject(i);
	    			if (datum.getJSONArray("answer") != null) {
	    				JSONArray answer = datum.getJSONArray("answer");
	    				for (int j = 0; j < answer.size(); j++) {
	    					JSONObject row = answer.getJSONObject(j);
	    					if (row != null) {
	    						// Handle attributes without permission
	    						for (String noPermissionKey : noPermissionKeys) {
	    							// Time series, vector, normal or full-text search fields are all replaced with ****
//	    							if (row.get(noPermissionKey) != null) {
	    								row.put(noPermissionKey, password);
//	    							}
	    						}
	    						// Handle metrics without permission
	    						for (String as : noPermissionIndicatorsMap.keySet()) {
	    							Set<String> noPermissionIndicators = noPermissionIndicatorsMap.get(as);
	    							JSONArray value = row.getJSONArray(as);
	    							if (value != null) {
	    								for (int k = 0; k < value.size(); k++) {
	    									JSONArray bucketRow = value.getJSONArray(k);
	    									if (bucketRow != null && bucketRow.size() >= 3) {
	    										String indicator = bucketRow.getString(1);
	    										if (noPermissionIndicators.contains(indicator)) {
	    											for (int l = 0; l < bucketRow.size(); l++) {
	    												if (l != 1) {
	    													bucketRow.set(l, password);
	    												}
	    											}
	    										}
	    									}
	    								}
	    							}
	    						}
	    						// Convert time series type fields into [{"time":"SimpleDateFormat", "indicator":"", "value": 123.45}, ...]
	    						for (String as : bucketIndicatorDefMap.keySet()) {
	    							Map<String, String> indicatorDefMap = bucketIndicatorDefMap.get(as);
	    							JSONArray value = row.getJSONArray(as);
	    							if (value != null) {
	    								JSONArray objFormatBucketValue = new JSONArray();
	    								for (int k = 0; k < value.size(); k++) {
	    									JSONArray bucketRow = value.getJSONArray(k);
	    									if (bucketRow != null && bucketRow.size() >= 3) {
	    										JSONObject objFormatBucketRow = new JSONObject();
	    										String timestamp = null;
	    										try {
	    											timestamp = sdf.format(new Date(bucketRow.getLong(0)));
	    										} catch (Exception e) {}
	    										objFormatBucketRow.put("time", timestamp == null ? bucketRow.get(0) : timestamp);
	    										String desc = null;
	    										try {
	    											desc = indicatorDefMap.get(bucketRow.getString(1));
	    										} catch (Exception e) {}
	    										objFormatBucketRow.put("indicator", desc == null ? bucketRow.get(1) : desc);
	    										objFormatBucketRow.put("value", bucketRow.get(2));
	    										objFormatBucketValue.add(objFormatBucketRow);
	    									}
	    								}
	    								row.put(as, objFormatBucketValue);
	    							}
	    						}
	    						// The ID field of all classes should not be returned
	    						for (String notReturnId : notReturnIds) {
	    							row.remove(notReturnId);
	    						}
	    					}
	    				}
	    			}
	    		}
			}
			
			// Semantic explanation of the returned fields
			Map<String, String[]> descriptionMap = new HashMap<String, String[]>();
	        for (String as : consanguinityMap.keySet()) {
	        	DslConsanguinity consanguinity = consanguinityMap.get(as);
	        	Map<String, Object> classDef = null;
	        	for (Map<String, Object> cd : classDefs) {
	        		if (cd.get("className").equals(consanguinity.getClassName())) {
	        			classDef = cd;
	        			break;
	        		}
	        	}
	        	if (classDef != null) {
	        		String classDesc = (String)classDef.get("classDesc");
	        		Map<String, Object> attrDef = null;
	        		for (Map<String, Object> ad : (List<Map<String, Object>>)classDef.get("attrs")) {
	        			if (ad.get("name").equals(consanguinity.getAttrName())) {
	        				attrDef = ad;
	        				break;
	        			}
	        		}
	        		if (attrDef != null) {
	        			String attrDesc = (String)attrDef.get("attrDesc");
	        			String indicatorDescs = "";
	        			if (consanguinity.getIndicatorNames() != null && attrDef.get("indicators") != null) {
	        				for (Map<String, Object> indicatorDef : (List<Map<String, Object>>)attrDef.get("indicators")) {
	        					if (consanguinity.getIndicatorNames().contains(indicatorDef.get("name"))) {
	        						String indicatorDesc = (String)indicatorDef.get("desc");
	        						if (indicatorDef.get("unit") != null && !"".equals(((String)indicatorDef.get("unit")).trim())) {
	        							indicatorDesc += "(unit:" + indicatorDef.get("unit") + ")";
	        						}
	        						indicatorDescs += indicatorDesc + "; ";
	        					}
	        				}
	        			}
	        			descriptionMap.put(as, new String[] {classDesc, attrDesc, indicatorDescs, consanguinity.getFunction()});
	        		}
	        	}
	        }
	        for (String notReturnId : notReturnIds) {
	        	descriptionMap.remove(notReturnId);
	        }
	        dataMap.put("outputKeyDescriptionMDTable", OutputKeyDescription.getOutputKeyDescriptionMDTable(descriptionMap));
		}
		
		return dataMap;
	}

}
