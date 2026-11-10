package io.ontomato.dataengine.bean.function;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import java.util.List;

import lombok.Data;

@Data
public class Function {
	
	public static final String OPERATION_READ = "OPERATION_READ";
	public static final String OPERATION_WRITE = "OPERATION_WRITE";
	
	public static final String ORIGIN_SYSTEM = "SYSTEM";
	public static final String ORIGIN_USER = "USER";

	private String id;
	private String name;
	private String origin;
	private String description;
	private String operation;
	private List<Parameter> parameters;
	private ReturnDef returnDef;
	private String code;
	private JSONObject queryPackage;

    public static Function fromAsset(JSONObject asset) {
        if (!(asset.get("function") instanceof JSONObject function))
            throw new IllegalArgumentException("function: expected an embedded Function object; supply its definition");
        return fromInput(function);
    }

    /** Parse an externally authored Function before bean conversion can coerce its field types. */
    public static Function fromInput(JSONObject input) {
        for (String field : List.of("operation", "name", "code", "logic"))
            if (input.get(field) != null && !(input.get(field) instanceof String))
                throw new IllegalArgumentException("Function." + field + ": expected a string; supply text");
        if (input.get("queryPackage") != null && !(input.get("queryPackage") instanceof JSONObject))
            throw new IllegalArgumentException("Function.queryPackage: expected an object; supply the package manifest and files");
        Object parameters = input.get("parameters");
        if (parameters != null) {
            if (!(parameters instanceof JSONArray list))
                throw new IllegalArgumentException("Function.parameters: expected an array of parameter definitions");
            for (int i = 0; i < list.size(); i++) {
                if (!(list.get(i) instanceof JSONObject definition))
                    throw new IllegalArgumentException("Function.parameters[" + i + "]: expected a parameter definition object");
                for (String field : List.of("name", "type", "description"))
                    if (definition.get(field) != null && !(definition.get(field) instanceof String))
                        throw new IllegalArgumentException("Function.parameters[" + i + "]." + field + ": expected a string");
            }
        }
        return input.to(Function.class);
    }

	public List<Parameter> getParameters() {
		return queryPackage == null ? parameters : queryPackage.getJSONObject("manifest")
			.getJSONArray("parameterDefs").toJavaList(Parameter.class);
	}
	private String logic;
	private Long createTimestamp;
	private Long modifyTimestamp;
	private String domainId;
	
}
