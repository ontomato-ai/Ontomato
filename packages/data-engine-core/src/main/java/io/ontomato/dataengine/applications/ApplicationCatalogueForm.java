package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONException;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.service.PanelFormErrors;
import io.ontomato.dataengine.service.PanelFormFields;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.ResourceBundle;
import java.util.function.Function;
import org.springframework.web.server.ResponseStatusException;

/** Typed forms use the same body shape accepted by the existing application writers. */
final class ApplicationCatalogueForm {
    private static final String APPLICATIONS = "/platform/applications/";
    private static final JSONObject STRING = PanelFormFields.schema("string");
    private static final JSONObject OBJECT = PanelFormFields.schema("object");
    private static final JSONObject BOOLEAN = PanelFormFields.schema("boolean");
    private static final JSONObject INTEGER = PanelFormFields.schema("integer");
    private static final JSONObject STRING_MAP = JSONObject.of("type", "object", "additionalProperties", STRING);
    private static final JSONObject STRING_ARRAY = PanelFormFields.arraySchema(STRING);
    private static final JSONObject INPUTS = JSONObject.of("type", "object", "additionalProperties", JSONObject.of("oneOf", List.of(
        objectSchema(JSONObject.of("frameState", STRING), List.of("frameState")),
        objectSchema(JSONObject.of("literal", new JSONObject()), List.of("literal")))));
    private static final JSONObject DEFAULT_AGENT = JSONObject.of("oneOf", List.of(
        objectSchema(JSONObject.of("kind", JSONObject.of("const", "id"), "id", STRING), List.of("kind", "id")),
        objectSchema(JSONObject.of("kind", JSONObject.of("const", "preset"), "agentKind", STRING), List.of("kind", "agentKind"))));
    private static final JSONObject IDENTITY_SCHEMA = objectSchema(JSONObject.of(
        "names", STRING_MAP, "descriptions", STRING_MAP, "icon", STRING, "allowStandalone", BOOLEAN),
        List.of("names", "descriptions", "icon"));
    private static final JSONObject GROUPS_SCHEMA = PanelFormFields.arraySchema(objectSchema(
        JSONObject.of("key", STRING, "names", STRING_MAP, "sort", INTEGER), List.of("key", "names", "sort")));
    private static final JSONObject DECLARATION_SCHEMA = objectSchema(JSONObject.of(
        "names", STRING_MAP, "descriptions", STRING_MAP, "icon", STRING, "groups", GROUPS_SCHEMA),
        List.of("names", "descriptions", "icon", "groups"));
    private static final JSONObject ENTRY_SCHEMA = objectSchema(JSONObject.of(
        "path", STRING, "renderer", JSONObject.of("const", "panels")), List.of("path", "renderer"));
    private static final JSONObject PAGE_COMPOSER = JSONObject.of("type", "string", "enum", List.of(
        ApplicationPanelUse.PAGE_COMPOSER_BOTTOM, ApplicationPanelUse.PAGE_COMPOSER_NONE));
    private static final JSONObject USE_SCHEMA = objectSchema(JSONObject.of(
        "id", STRING, "pageKey", STRING, "panelId", STRING, "path", STRING,
        "names", STRING_MAP, "descriptions", STRING_MAP, "icon", STRING, "groupKey", STRING, "inputs", INPUTS,
        "defaultAgent", DEFAULT_AGENT, "pageComposer", PAGE_COMPOSER, "inMenu", BOOLEAN),
        List.of("id", "pageKey", "panelId", "path", "names"));

    private static final List<Locale> LOCALES = List.of("en", "zh-CN", "zh-TW", "ja", "fr", "de", "it", "ar")
        .stream().map(Locale::forLanguageTag).toList();
    private final Locale locale;
    private final ResourceBundle copy;

    ApplicationCatalogueForm(Locale requested) {
        var language = Locale.forLanguageTag(requested == null ? "en" : requested.getLanguage());
        locale = requested != null && LOCALES.contains(requested) ? requested
            : LOCALES.contains(language) ? language : Locale.ENGLISH;
        copy = ResourceBundle.getBundle("application_catalogue_form", locale,
            ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES));
    }

    static String notFoundMessage(Locale requested) {
        return new ApplicationCatalogueForm(requested).copy.getString("error.notFound");
    }

    JSONObject identity(JSONObject app, JSONObject draft) {
        var values = draft == null ? JSONObject.of("names", app.getJSONObject("names"),
            "descriptions", app.getJSONObject("descriptions"), "icon", app.getString("icon"),
            "allowStandalone", ApplicationCatalog.allowsStandalone(app)) : draft;
        var fields = identityFields();
        fields.add(allowStandaloneField());
        return describe(fields, values, draft == null ? List.of() : identityErrors(draft),
            APPLICATIONS + app.getString("id") + "/identity", IDENTITY_SCHEMA);
    }

    JSONObject entries(JSONObject app, JSONObject draft, Function<String, String> conflicts) {
        var id = app.getString("id");
        var values = draft;
        List<ObjectNode> errors;
        if (values == null) {
            var uses = app.getList("panelUses", ApplicationPanelUse.class);
            values = JSONObject.of("entry", app.getJSONObject("entry"), "panelUses", uses.stream().map(ApplicationCatalogueForm::editableUse).toList());
            values.putAll(app.getJSONObject("panelSettings"));
            var savedErrors = new PanelFormErrors();
            for (int i = 0; i < uses.size(); i++)
                validatePageKey(uses.get(i).pageKey(), "/panelUses/" + i + "/pageKey", conflicts, savedErrors);
            errors = savedErrors.list();
        } else {
            errors = entryErrors(id, draft, app, conflicts);
        }
        return describe(entryFields(id), values, errors,
            APPLICATIONS + id + "/panel-uses", registrationSchema(false));
    }

    JSONObject entry(JSONObject app, String entryId, JSONObject draft, Function<String, String> conflicts) {
        var id = app.getString("id");
        var root = ApplicationCatalog.assignedPanelRoot(id);
        var uses = app.getList("panelUses", ApplicationPanelUse.class);
        boolean isNew = entryId == null || entryId.isBlank() || "__new__".equals(entryId);
        ApplicationPanelUse existingUse = isNew ? null : uses.stream()
            .filter(u -> entryId.equals(u.id())).findFirst()
            .orElseThrow(() -> new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, copy.getString("error.entryNotFound")));
        JSONObject values;
        List<ObjectNode> errors;
        if (draft == null) {
            if (existingUse != null) {
                values = editableUse(existingUse);
                var savedErrors = new PanelFormErrors();
                validatePageKey(existingUse.pageKey(), "/pageKey", conflicts, savedErrors);
                errors = savedErrors.list();
            } else {
                values = JSONObject.of("id", "", "pageKey", "", "panelId", "", "path", root + "/", "inMenu", true);
                errors = List.of();
            }
        } else {
            values = draft;
            errors = singleEntryErrors(id, draft, app, conflicts);
        }
        var itemFields = singleEntryFields(!isNew);
        return describe(itemFields, values, errors, APPLICATIONS + id + "/panel-uses", USE_SCHEMA);
    }

    JSONObject create(String id, JSONObject draft, Function<String, String> conflicts) {
        var values = draft == null ? JSONObject.of(
            "declaration", JSONObject.of("names", new JSONObject(), "descriptions", new JSONObject(),
                "icon", "pages", "groups", List.of()),
            "shared", false,
            "allowStandalone", true,
            "entry", JSONObject.of("path", ApplicationCatalog.assignedPanelRoot(id), "renderer", "panels"),
            "initialOpenEntryIds", List.of(), "panelUses", List.of()) : draft;
        var fields = entryFields(id);
        var metadata = identityFields();
        metadata.add(groupsField());
        fields.addFirst(field("/declaration", "identity", PanelFormFields.object(metadata, null), DECLARATION_SCHEMA, true));
        fields.add(field("/initialOpenEntryIds", "applicationAccess", PanelFormFields.stringArray(), STRING_ARRAY, true));
        fields.add(field("/shared", "initialGrant", PanelFormFields.select(JSONArray.of(
            PanelFormFields.option(false, copy.getString("initialGrant.private")),
            PanelFormFields.option(true, copy.getString("initialGrant.domain")))),
            BOOLEAN, false, "initialGrant.help"));
        fields.add(allowStandaloneField());
        return describe(fields, values, draft == null ? List.of() : entryErrors(id, draft, null, conflicts),
            APPLICATIONS + id + "/panel-uses?create=true", registrationSchema(true));
    }

    private static JSONObject editableUse(ApplicationPanelUse use) {
        var values = JSONObject.from(use);
        values.put("inMenu", use.appearsInMenu());
        return values;
    }

    private JSONObject allowStandaloneField() {
        return field("/allowStandalone", "allowStandalone", PanelFormFields.switchControl(), BOOLEAN, false, "allowStandalone.help");
    }

    private JSONArray identityFields() {
        return JSONArray.of(
            field("/names", "name", localizedText(List.of(), false), STRING_MAP, true, "name.help"),
            field("/descriptions", "description", localizedText(List.of(), true), STRING_MAP, true, "description.help"),
            field("/icon", "icon", JSONObject.of("kind", "application-icon"), STRING, true, "icon.help"));
    }

    private JSONObject groupsField() {
        var fields = JSONArray.of(
            field("/key", "groupKey", PanelFormFields.text(false), STRING, true),
            field("/names", "name", localizedText(List.of(), false), STRING_MAP, true),
            field("/sort", "groupSort", JSONObject.of("kind", "number"), INTEGER, true));
        var empty = JSONObject.of("key", "", "names", new JSONObject(), "sort", 0);
        return field("/groups", "groups", PanelFormFields.objectArray(fields, empty, null), GROUPS_SCHEMA, true);
    }

    private JSONObject localizedText(List<String> requiredLocales, boolean multiline) {
        var languages = LOCALES.stream()
            .map(language -> JSONObject.of("code", language.toLanguageTag(), "label", language.getDisplayName(locale)))
            .toList();
        return JSONObject.of("kind", "localized-text", "primaryLocale", locale.toLanguageTag(), "locales", languages,
            "requiredLocales", requiredLocales, "multiline", multiline);
    }

    private JSONArray singleEntryFields(boolean idReadOnly) {
        var inputs = field("/inputs", "inputs", PanelFormFields.code("json"), INPUTS, false);
        inputs.put("advanced", true);
        var entryIdField = PanelFormFields.field("/id", copy.getString("entryId"), PanelFormFields.text(false), STRING,
            true, idReadOnly, null, null, false);
        return JSONArray.of(
            entryIdField,
            field("/pageKey", "pageKey", PanelFormFields.text(false), STRING, true),
            field("/path", "address", PanelFormFields.text(false), STRING, true),
            field("/panelId", "panelId", PanelFormFields.text(false), STRING, true),
            field("/names", "entryNames", localizedText(List.of(), false), STRING_MAP, true),
            field("/inMenu", "inMenu", PanelFormFields.switchControl(), BOOLEAN, false),
            field("/descriptions", "entryDescriptions", localizedText(List.of(), true), STRING_MAP, false),
            field("/groupKey", "menuGroup", PanelFormFields.text(false), STRING, false),
            field("/defaultAgent", "defaultAgent", PanelFormFields.select(new JSONArray()), DEFAULT_AGENT, false),
            inputs);
    }

    private JSONArray entryFields(String id) {
        var inputs = field("/inputs", "inputs", PanelFormFields.code("json"), INPUTS, false);
        inputs.put("advanced", true);
        var item = JSONArray.of(
            field("/id", "entryId", PanelFormFields.text(false), STRING, true),
            field("/pageKey", "pageKey", PanelFormFields.text(false), STRING, true),
            field("/path", "address", PanelFormFields.text(false), STRING, true),
            field("/panelId", "panelId", PanelFormFields.text(false), STRING, true),
            inputs,
            field("/names", "entryNames", localizedText(List.of(), false), STRING_MAP, true),
            field("/inMenu", "inMenu", PanelFormFields.switchControl(), BOOLEAN, false),
            field("/descriptions", "entryDescriptions", localizedText(List.of(), true), STRING_MAP, false),
            field("/groupKey", "menuGroup", PanelFormFields.text(false), STRING, false),
            field("/defaultAgent", "defaultAgent", PanelFormFields.select(new JSONArray()), DEFAULT_AGENT, false));
        var root = ApplicationCatalog.assignedPanelRoot(id);
        return JSONArray.of(
            field("/entry/path", "applicationAddress", PanelFormFields.text(false), STRING, true),
            field("/panelUses", "entries", PanelFormFields.objectArray(item,
                JSONObject.of("id", "", "pageKey", "", "panelId", "", "path", root + "/", "inMenu", true), "/id"),
                PanelFormFields.arraySchema(USE_SCHEMA), true));
    }

    private JSONObject field(String path, String label, JSONObject control, JSONObject schema, boolean required) {
        return field(path, label, control, schema, required, null);
    }

    private JSONObject field(String path, String label, JSONObject control, JSONObject schema, boolean required, String help) {
        return PanelFormFields.field(path, copy.getString(label), control, schema, required, false,
            null, help == null ? null : copy.getString(help), false);
    }

    private static JSONObject registrationSchema(boolean create) {
        var props = JSONObject.of("entry", ENTRY_SCHEMA, "panelUses", PanelFormFields.arraySchema(USE_SCHEMA),
            "declaration", DECLARATION_SCHEMA,
            "framePanelId", STRING, "theme", OBJECT, "delivery", OBJECT, "allowStandalone", BOOLEAN);
        if (create) {
            props.put("shared", BOOLEAN);
            props.put("initialOpenEntryIds", STRING_ARRAY);
        }
        return objectSchema(props,
            create ? List.of("entry", "panelUses", "initialOpenEntryIds", "declaration") : List.of("entry", "panelUses"));
    }

    private static JSONObject objectSchema(JSONObject properties, List<String> required) {
        return JSONObject.of("type", "object", "properties", properties, "required", required, "additionalProperties", false);
    }

    private static JSONObject describe(JSONArray fields, JSONObject values, List<ObjectNode> errors,
            String path, JSONObject schema) {
        return JSONObject.of("fields", fields, "values", values, "errors", errors, "save",
            JSONObject.of("method", "PUT", "path", path, "bodySchema", schema));
    }

    static List<ObjectNode> identityErrors(JSONObject values) {
        var errors = new PanelFormErrors();
        validateIdentity(values, "", errors);
        validateAllowStandalone(values, errors);
        return errors.list();
    }

    private static void validateAllowStandalone(JSONObject values, PanelFormErrors errors) {
        if (values.containsKey("allowStandalone") && values.get("allowStandalone") != null
                && !(values.get("allowStandalone") instanceof Boolean)) {
            errors.invalidOption("/allowStandalone", "Expected a boolean value");
        }
    }

    private static void validateIdentity(JSONObject values, String prefix, PanelFormErrors errors) {
        validateNames(values, prefix + "/names", errors);
        var descriptions = errors.requiredObject(values, "descriptions", prefix + "/descriptions");
        if (descriptions != null) validateTranslations(descriptions, prefix + "/descriptions", false, errors);
        if (!(values.get("icon") instanceof String)) errors.requiredString(values, "icon", prefix + "/icon");
    }

    private static void validateNames(JSONObject values, String path, PanelFormErrors errors) {
        var names = errors.requiredObject(values, "names", path);
        if (names != null) {
            if (names.isEmpty()) errors.required(path, "At least one localized name is required");
            validateTranslations(names, path, true, errors);
        }
    }

    private static void validateTranslations(JSONObject values, String path, boolean nonempty, PanelFormErrors errors) {
        for (var entry : values.entrySet()) {
            if (!(entry.getValue() instanceof String text) || (nonempty && text.isBlank()))
                errors.invalidObject(path + "/" + PanelFormFields.pointer(entry.getKey()),
                    nonempty ? "Expected a nonblank text value" : "Expected a text value");
        }
    }

    private static List<ObjectNode> entryErrors(String id, JSONObject values, JSONObject existing,
            Function<String, String> conflicts) {
        var errors = new PanelFormErrors();
        var root = ApplicationCatalog.assignedPanelRoot(id);
        var entry = errors.requiredObject(values, "entry", "/entry");
        if (entry != null) {
            validatePath(entry, "/entry/path", root, errors);
            if (!"panels".equals(entry.get("renderer")))
                errors.invalidOption("/entry/renderer", "Application renderer must be panels");
        }
        var declaration = existing;
        if (existing == null) {
            declaration = errors.requiredObject(values, "declaration", "/declaration");
            if (declaration != null) {
                validateIdentity(declaration, "/declaration", errors);
                if (!(declaration.get("groups") instanceof List<?> groups) || groups.stream().anyMatch(group -> !(group instanceof Map<?, ?>)))
                    errors.invalidArray("/declaration/groups", "Expected an array of objects");
            }
            if (!(values.get("initialOpenEntryIds") instanceof List<?> openIds)
                    || openIds.stream().anyMatch(key -> !(key instanceof String idKey) || !ApplicationCatalog.validEntryKey(idKey)))
                errors.invalidArray("/initialOpenEntryIds", "Expected an array of entry IDs");
        }
        validateAllowStandalone(values, errors);
        validateUses(values, root, declaration, existing == null, conflicts, errors);
        return errors.list();
    }

    static List<ObjectNode> singleEntryErrors(String id, JSONObject use, JSONObject app, Function<String, String> conflicts) {
        var errors = new PanelFormErrors();
        var root = ApplicationCatalog.assignedPanelRoot(id);
        for (var key : List.of("id", "panelId"))
            errors.requiredString(use, key, "/" + key);
        var pageKey = errors.requiredString(use, "pageKey", "/pageKey");
        if (pageKey != null) validatePageKey(pageKey, "/pageKey", conflicts, errors);
        if (use.containsKey("names")) {
            var names = errors.requiredObject(use, "names", "/names");
            if (names != null) {
                if (names.isEmpty()) errors.required("/names", "At least one localized name is required");
                validateTranslations(names, "/names", true, errors);
            }
        }
        if (use.containsKey("descriptions")) {
            var descriptions = errors.requiredObject(use, "descriptions", "/descriptions");
            if (descriptions != null) {
                if (descriptions.isEmpty()) errors.required("/descriptions", "At least one localized description is required");
                for (var description : descriptions.entrySet()) {
                    if (!(description.getValue() instanceof String text) || ApplicationPanelUse.blankDescription(text))
                        errors.invalidObject("/descriptions/" + PanelFormFields.pointer(description.getKey()), "Expected a nonblank description");
                }
            }
        }
        if (use.containsKey("icon") && (!(use.get("icon") instanceof String text) || text.isBlank())) {
            errors.invalidObject("/icon", "Expected a nonblank icon");
        }
        validatePath(use, "/path", root, errors);
        if (!errors.isEmpty()) return errors.list();
        try {
            var canonical = ApplicationPanelUse.canonical(List.of(use.toJavaObject(ApplicationPanelUse.class)));
            ApplicationCatalog.validateUseGroups(canonical, app.getList("groups", ApplicationCatalog.Group.class));
        } catch (ResponseStatusException | JSONException error) {
            errors.invalidObject("/id", error);
        }
        return errors.list();
    }

    private static void validateUses(JSONObject values, String root, JSONObject declaration,
            boolean create, Function<String, String> conflicts, PanelFormErrors errors) {
        if (!(values.get("panelUses") instanceof List<?> uses)) {
            errors.invalidArray("/panelUses", "Expected the complete entry array");
            return;
        }
        for (int i = 0; i < uses.size(); i++) {
            var path = "/panelUses/" + i;
            if (!(uses.get(i) instanceof Map<?, ?>)) {
                errors.invalidObject(path, "Expected an entry object");
                continue;
            }
            var use = values.getJSONArray("panelUses").getJSONObject(i);
            for (var key : List.of("id", "panelId"))
                errors.requiredString(use, key, path + "/" + key);
            var pageKey = errors.requiredString(use, "pageKey", path + "/pageKey");
            if (pageKey != null) validatePageKey(pageKey, path + "/pageKey", conflicts, errors);
            if (use.containsKey("names")) {
                var pointer = path + "/names";
                var names = errors.requiredObject(use, "names", pointer);
                if (names != null) {
                    if (names.isEmpty()) errors.required(pointer, "At least one localized name is required");
                    validateTranslations(names, pointer, true, errors);
                }
            }
            if (use.containsKey("descriptions")) {
                var pointer = path + "/descriptions";
                var descriptions = errors.requiredObject(use, "descriptions", pointer);
                if (descriptions != null) {
                    if (descriptions.isEmpty()) errors.required(pointer, "At least one localized description is required");
                    for (var description : descriptions.entrySet()) {
                        if (!(description.getValue() instanceof String text) || ApplicationPanelUse.blankDescription(text))
                            errors.invalidObject(pointer + "/" + PanelFormFields.pointer(description.getKey()), "Expected a nonblank description");
                    }
                }
            }
            if (use.containsKey("icon") && (!(use.get("icon") instanceof String text) || text.isBlank())) {
                errors.invalidObject(path + "/icon", "Expected a nonblank icon");
            }
            validatePath(use, path + "/path", root, errors);
        }
        if (!errors.isEmpty()) return;
        if (create) {
            try {
                ApplicationCatalog.validate(declaration.toJavaObject(ApplicationCatalog.Declaration.class));
            } catch (ResponseStatusException | JSONException error) {
                errors.invalidObject("/declaration", error);
                return;
            }
        }
        try {
            var canonical = ApplicationPanelUse.canonical(values.getJSONArray("panelUses").toJavaList(ApplicationPanelUse.class));
            ApplicationCatalog.validateUseGroups(canonical, declaration.getList("groups", ApplicationCatalog.Group.class));
            if (create) {
                var ids = canonical.stream().map(ApplicationPanelUse::id).toList();
                if (!ids.containsAll(values.getList("initialOpenEntryIds", String.class)))
                    errors.invalidOption("/initialOpenEntryIds", "Use IDs declared in the entry list");
            }
        } catch (ResponseStatusException | JSONException error) {
            errors.invalidObject("/panelUses", error);
        }
    }

    private static void validatePageKey(String pageKey, String field, Function<String, String> conflicts, PanelFormErrors errors) {
        var conflict = conflicts.apply(pageKey);
        if (conflict != null) errors.invalidOption(field, conflict);
    }

    private static void validatePath(JSONObject values, String field, String root, PanelFormErrors errors) {
        var path = errors.requiredString(values, "path", field);
        if (path == null) return;
        try {
            if (!ApplicationPanelUse.under(ApplicationPanelUse.canonicalPath(path), root))
                errors.invalidOption(field, "Path must be within " + root);
        } catch (ResponseStatusException error) {
            errors.invalidObject(field, error.getReason());
        }
    }
}
