package io.ontomato.dataengine.controller;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.LangService;

/**
 * The business knowledge form, described as the panel form contract takes it: the fields, the values of the target and
 * the native save request. Labels and tag candidates come from the requested language pack, so each edition declares its
 * own tag values instead of keeping a copy in the browser profile.
 */
public final class BussinessKnowledgeForm {

    public static final String OBJECT_TYPE = "platform:BusinessKnowledge";

    private BussinessKnowledgeForm() {}

    public static JSONObject describe(String lang, String domainId, Map<String, Object> request,
            KnowledgeService knowledgeService, LangService langService) {
        Map<String, Object> target = object(request.get("target"), lang, langService, "Admin.knowledge.form.invalidTarget");
        String kind = string(target.get("kind"));
        KnowledgeEntity current;
        if ("draft".equals(kind)) {
            current = null;
        } else if ("object".equals(kind)) {
            String objectType = string(target.get("objectType"));
            String primaryKey = string(target.get("primaryKey"));
            if (!OBJECT_TYPE.equals(objectType) || primaryKey == null || primaryKey.isBlank())
                throw new IllegalArgumentException(langService.get(lang, "Admin.knowledge.form.invalidTarget"));
            current = knowledgeService.getBussinessKnowledge(domainId).get(primaryKey);
            if (current == null)
                throw new IllegalArgumentException("Business knowledge not found in the current domain");
        } else {
            throw new IllegalArgumentException(langService.get(lang, "Admin.knowledge.form.invalidTarget"));
        }

        JSONObject values = current == null
                ? new JSONObject()
                        .fluentPut("knowledgeID", "")
                        .fluentPut("knowledgeTitle", "")
                        .fluentPut("knowledgeText", "")
                        .fluentPut("knowledgeTags", new JSONArray())
                        .fluentPut("status", 1)
                : new JSONObject()
                        .fluentPut("knowledgeID", current.getKnowledgeID())
                        .fluentPut("knowledgeTitle", current.getKnowledgeTitle())
                        .fluentPut("knowledgeText", current.getKnowledgeText())
                        .fluentPut("knowledgeTags",
                                current.getKnowledgeTags() == null ? new JSONArray() : current.getKnowledgeTags())
                        .fluentPut("status", current.getStatus());
        if (request.get("values") != null)
            values = new JSONObject(object(request.get("values"), lang, langService, "Admin.knowledge.form.invalidValues"));
        if (!values.containsKey("knowledgeID"))
            values.put("knowledgeID", current == null ? "" : current.getKnowledgeID());

        JSONObject form = new JSONObject();
        form.put("values", values);
        form.put("fields", fields(lang, langService));
        form.put("save", save(current == null));
        return form;
    }

    private static JSONArray fields(String lang, LangService langService) {
        JSONArray fields = new JSONArray();
        fields.add(field("/knowledgeTitle", langService.get(lang, "Admin.knowledge.form.title"),
                new JSONObject().fluentPut("kind", "text").fluentPut("multiline", false).fluentPut("placeholder", null),
                stringSchema(), true, ""));
        fields.add(field("/knowledgeText", langService.get(lang, "Admin.knowledge.form.content"),
                new JSONObject().fluentPut("kind", "text").fluentPut("multiline", true).fluentPut("placeholder", null),
                stringSchema(), true, ""));
        fields.add(field("/knowledgeTags", langService.get(lang, "Admin.knowledge.form.tags"),
                new JSONObject()
                        .fluentPut("kind", "select")
                        .fluentPut("multiple", true)
                        .fluentPut("allowCreate", true)
                        .fluentPut("options", tagOptions(lang, langService)),
                new JSONObject().fluentPut("type", "array").fluentPut("items", stringSchema()), false, new JSONArray()));
        fields.add(field("/status", langService.get(lang, "Admin.knowledge.form.status"),
                new JSONObject().fluentPut("kind", "select").fluentPut("options", statusOptions(lang, langService)),
                new JSONObject().fluentPut("type", "integer").fluentPut("enum", JSONArray.of(0, 1)), true, 1));
        fields.add(field("/knowledgeID", langService.get(lang, "Admin.knowledge.form.id"),
                new JSONObject().fluentPut("kind", "hidden"), stringSchema(), false, ""));
        return fields;
    }

    private static JSONObject field(String path, String label, JSONObject control, JSONObject valueSchema,
            boolean required, Object defaultValue) {
        return new JSONObject()
                .fluentPut("path", path)
                .fluentPut("label", label)
                .fluentPut("control", control)
                .fluentPut("valueSchema", valueSchema)
                .fluentPut("required", required)
                .fluentPut("readOnly", false)
                .fluentPut("defaultValue", defaultValue);
    }

    private static JSONArray tagOptions(String lang, LangService langService) {
        JSONArray options = new JSONArray();
        for (String key : List.of("general", "business", "tech"))
            options.add(option(
                    langService.get(lang, "Admin.knowledge.tag." + key + ".value"),
                    langService.get(lang, "Admin.knowledge.tag." + key + ".label")));
        return options;
    }

    private static JSONArray statusOptions(String lang, LangService langService) {
        return JSONArray.of(
                option(0, langService.get(lang, "Admin.knowledge.form.pending")),
                option(1, langService.get(lang, "Admin.knowledge.form.approved")));
    }

    private static JSONObject option(Object value, String label) {
        return new JSONObject()
                .fluentPut("value", value)
                .fluentPut("label", label)
                .fluentPut("description", null)
                .fluentPut("disabled", false)
                .fluentPut("disabledReason", null);
    }

    private static JSONObject save(boolean create) {
        return new JSONObject()
                .fluentPut("method", "POST")
                .fluentPut("path", create ? "/admin/addBussinessKnowledge" : "/admin/editBussinessKnowledge")
                .fluentPut("bodySchema", bodySchema())
                .fluentPut("draftOperation", create ? "knowledge.create" : "knowledge.update");
    }

    private static JSONObject bodySchema() {
        return new JSONObject()
                .fluentPut("type", "object")
                .fluentPut("properties", new JSONObject()
                        .fluentPut("knowledgeID", stringSchema())
                        .fluentPut("knowledgeTitle", stringSchema())
                        .fluentPut("knowledgeText", stringSchema())
                        .fluentPut("knowledgeTags", new JSONObject().fluentPut("type", "array").fluentPut("items", stringSchema()))
                        .fluentPut("status", new JSONObject().fluentPut("type", "integer").fluentPut("enum", JSONArray.of(0, 1))))
                .fluentPut("required", JSONArray.of("knowledgeTitle", "knowledgeText", "knowledgeTags", "status"))
                .fluentPut("additionalProperties", false);
    }

    private static JSONObject stringSchema() {
        return new JSONObject().fluentPut("type", "string");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> object(Object value, String lang, LangService langService, String messageKey) {
        if (value instanceof Map<?, ?> map)
            return (Map<String, Object>) map;
        throw new IllegalArgumentException(langService.get(lang, messageKey));
    }

    private static String string(Object value) {
        return value instanceof String text ? text : null;
    }
}
