package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.bean.function.Parameter;

import java.util.*;

public class DBSchemaUtil {

    public static final String KEY_DATASET_DESC = "KEY_DATASET_DESC";
    public static final String KEY_CLASS_DEF = "KEY_CLASS_DEF";
    public static final String KEY_RELATIONSHIP_DEF = "KEY_RELATIONSHIP_DEF";

    public static String normalizeClassName(String className, List<Map<String, Object>> classDefs) {
        if (className == null) {
            return null;
        }
        for (Map<String, Object> classDef : classDefs) {
            String formalName = (String)classDef.get("className");
            if (className.equals(formalName)) {
                return formalName;
            }
        }
        for (Map<String, Object> classDef : classDefs) {
            String formalName = (String)classDef.get("className");
            // Bare schemas accept the "/customers" form, and schemas that use a leading slash
            // (for example the M3 adapter) accept the bare "customers" form too. Always return the
            // schema's own spelling so the adapter receives the name it expects.
            if (!formalName.startsWith("/") && className.equals("/" + formalName)) {
                return formalName;
            }
            if (formalName.startsWith("/") && className.equals(formalName.substring(1))) {
                return formalName;
            }
        }
        return className;
    }

    /** Builds parameters from the object list defined by the parameters; the field mapping and baseline are exactly the same as those parsed from the body, and are shared by the test tools and all submission paths. */
    public static List<Parameter> buildParameters(List<Map> defs, List<Map<String, Object>> classDefs) {
        List<Parameter> parameters = new ArrayList<Parameter>();
        for (int i = 0; i < defs.size(); i++) {
            Map def = defs.get(i);
            String field = "parameterDefs[" + i + "].";
            Parameter parameter = new Parameter();
            parameter.setName(str(def.get("name"), field + "name"));
            parameter.setType(str(def.get("type"), field + "type"));
            parameter.setDescription(str(def.get("description"), field + "description"));
            Object value = ParameterValues.normalize(parameter.getType(), def.get("value"));
            parameter.setValue(value);
            parameter.setSample(value);
            String className = normalizeClassName(str(def.get("className"), field + "className"), classDefs);
            List<String> classNames = new ArrayList<String>();
            if (className != null && !"".equals(className.trim())) {
                classNames.add(className);
            }
            parameter.setClassNames(classNames);
            parameters.add(parameter);
        }
        return parameters;
    }

    private static String str(Object value, String field) {
        return value == null ? null : requireString(value, field);
    }

    private static String requireString(Object value, String field) {
        if (!(value instanceof String text)) throw new IllegalArgumentException(field + ": expected a JSON string; received " + value.getClass().getSimpleName() + "; replace this field with text");
        return text;
    }

    /** Returns the dataset description, class definitions and direct relationship definitions. */
    public static Map<String, String> getDBSchema(Map<String, Object> jsonRule, List<String> classNames) {

        Map<String, String> mapDBSchema =  new HashMap<String, String>();

        String datasetDesc = (String)jsonRule.get("datasetdesc");
        mapDBSchema.put(KEY_DATASET_DESC, datasetDesc);

        List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
        StringBuffer sbMarkDownClassDefs = new StringBuffer();
        for (Map<String, Object> classDef : classDefs) {
        	if (classNames == null || classNames.size() == 0 || classNames.contains(classDef.get("className"))) {
        		sbMarkDownClassDefs.append(generateMarkDownByClassDef(classDef));
                sbMarkDownClassDefs.append("\n");
        	}
        }

        mapDBSchema.put(KEY_CLASS_DEF, sbMarkDownClassDefs.toString());

        //relationship definition
        Map<String, Object> relationship_rule = (Map<String, Object>)jsonRule.get("relationship_rule");
        StringBuffer sbMarkDownRelationship = new StringBuffer();
        sbMarkDownRelationship.append("| source class | target class | relationship type | relationship description |\n");
        sbMarkDownRelationship.append("| ---------- | ---------- | ---------- | -------------------- |\n");
        for (String key : relationship_rule.keySet()) {
            Map<String, String> rel = (Map<String, String>)relationship_rule.get(key);
            if (classNames == null || classNames.size() == 0 || classNames.contains(rel.get("fromclass")) && classNames.contains(rel.get("toclass"))) {
            	sbMarkDownRelationship.append("| ").append(rel.get("fromclass"))
	                .append(" | ").append(rel.get("toclass"))
	                .append(" | ").append(key)
	                .append(" | ").append(rel.get("desc"))
	                .append(" |\n");
            }
        }
        sbMarkDownRelationship.append("\n");

        mapDBSchema.put(KEY_RELATIONSHIP_DEF, sbMarkDownRelationship.toString());

        return mapDBSchema;
    }
    
    public static String generateClassNameMarkDown(Map<String, Object> jsonRule, List<String> classNames) {
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
        StringBuffer sbMarkDownClassDefs = new StringBuffer();
        sbMarkDownClassDefs.append("| class name | description |\n| --- | --- |\n");
        for (Map<String, Object> classDef : classDefs) {
        	if (classNames == null || classNames.size() == 0 || classNames.contains(classDef.get("className"))) {
        		sbMarkDownClassDefs.append("| " + classDef.get("className") + " | " + classDef.get("classDesc") + " |\n");
        	}
        }
        return sbMarkDownClassDefs.toString();
    }

    private static String generateMarkDownByClassDef(Map<String, Object> classDef) {
    	StringBuffer sbMarkDownClassDefs = new StringBuffer();
    	sbMarkDownClassDefs.append(" - class name: " + classDef.get("className") + "\n");
        sbMarkDownClassDefs.append("class description: " + classDef.get("classDesc") + "\n");
        sbMarkDownClassDefs.append("| field name | field type | primary key | field description |\n");
        sbMarkDownClassDefs.append("| ---------- | ---------- | ---------- | -------------------- |\n");
        List<Map<String, Object>> attrs = (List<Map<String, Object>>)classDef.get("attrs");
        StringBuffer sbMarkDownIndicatorDefs = new StringBuffer();
        for (Map<String, Object> attr : attrs) {
            Boolean enable = (Boolean)attr.get("enable");
            if(enable == null || enable == true){
                sbMarkDownClassDefs.append("| ").append(attr.get("name"))
                        .append(" | ").append(attr.get("type"))
                        .append(" | ").append(attr.get("primaryKey") != null && (Boolean)attr.get("primaryKey"))
                        .append(" | ").append(attr.get("attrDesc")).append(" |\n");
                if (attr.get("indicators") != null) {
                	List<Map<String, Object>> indicators = (List<Map<String, Object>>)attr.get("indicators");
                	sbMarkDownIndicatorDefs.append("Class \"" + classDef.get("className") + "(" + classDef.get("classDesc") + ")\" time series field " + attr.get("name") + " metric description\n");
                	sbMarkDownIndicatorDefs.append("| metric name | metric description | unit |\n");
                	sbMarkDownIndicatorDefs.append("| ----- | ------- | --- |\n");
                	for (Map<String, Object> indicator : indicators) {
                		sbMarkDownIndicatorDefs.append("| " + indicator.get("name") + " | " + indicator.get("desc") + " | " + indicator.get("unit") + " |\n");
                	}
                }
            }
        }
        return sbMarkDownClassDefs.toString() + "\n" + sbMarkDownIndicatorDefs.toString();
    }

    public static String generateMarkDownByClassName(String className, Map<String, Object> jsonRule) throws Exception {
    	List<Map<String, Object>> classDefs = (List<Map<String, Object>>)jsonRule.get("classDef");
    	Map<String, Object> def = null;
    	for (Map<String, Object> classDef : classDefs) {
    		if (className.trim().equals(classDef.get("className"))) {
                def = classDef;
                break;
            }
    	}
    	if (def != null) {
    		return generateMarkDownByClassDef(def);
    	} else {
    		return "Object class `" + className + "` does not exist";
    	}
    }
}
