package io.ontomato.dataengine.dataAdapter;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import java.util.function.Consumer;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** A source adapter is created for one operation, with its own ontomap and execution target. */
public abstract class SandboxDataAdapter implements DataAdapter {
    protected SandboxTarget sandboxTarget;

    @Override
    public final DataAdapter forSandbox(SandboxTarget target) {
        this.sandboxTarget = Objects.requireNonNull(target);
        return this;
    }

    protected final List<Map<String, Object>> sandboxClasses(List<Map<String, Object>> definitions) {
        if (sandboxTarget == null) return definitions;
        return definitions.stream()
            .filter(definition -> sandboxTarget.classTables().containsKey((String) definition.get("className")))
            .<Map<String, Object>>map(java.util.LinkedHashMap::new).toList();
    }

    protected final String rewriteSandboxDsl(String source, String namespace) {
        return rewriteSandboxDsl(source, namespace, object -> {});
    }

    protected final String rewriteSandboxDsl(String source, String namespace, Consumer<JSONObject> rewriteObject) {
        var dsls = JSON.parseArray(source);
        for (var dsl : dsls.toJavaList(JSONObject.class)) {
            var steps = dsl.getJSONObject("answer").getJSONArray("steps");
            var intermediateTables = new HashSet<String>();
            for (var step : steps.toJavaList(JSONObject.class)) {
                var graph = step.getJSONObject("graph");
                if (graph == null) continue;
                for (var pattern : graph.getJSONArray("patterns").toJavaList(JSONObject.class)) {
                    for (var object : pattern.getJSONArray("objects").toJavaList(JSONObject.class)) {
                        String name = object.getString("class");
                        if (name != null && !name.isBlank() && !intermediateTables.contains(name)) {
                            object.put("class", sandboxClassName(namespace, name));
                            rewriteObject.accept(object);
                        }
                    }
                }
                var output = step.getJSONObject("output");
                if (output != null && output.getString("save_table") != null)
                    intermediateTables.add(output.getString("save_table"));
                if (step.getString("ref_name") != null)
                    intermediateTables.add("$" + step.getString("ref_name"));
            }
        }
        return JSON.toJSONString(dsls, JSONWriter.Feature.WriteMapNullValue);
    }

    @Override
    public JSONObject sandboxEdgeArtifact(String name) {
        return JSONObject.of("kind", "table", "name", sandboxTarget.edgeTable(name));
    }

    @Override
    public String sandboxVectorTable(String physicalClass, String attribute) {
        if (sandboxTarget == null) return null;
        String logicalClass = sandboxTarget.classTables().keySet().stream()
            .filter(name -> sandboxClassName(sandboxTarget.namespace(), name).equals(physicalClass))
            .findFirst().orElseThrow();
        return sandboxTarget.vectorTable(logicalClass, attribute);
    }
}
