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
import java.util.stream.Collectors;
import org.springframework.web.server.ResponseStatusException;

/** Typed forms use the same body shape accepted by the existing application writers. */
final class ApplicationCatalogueForm {
    private static final String APPLICATIONS = "/platform/applications/";
    private static final String DOMAIN_MEMBER = ApplicationCatalog.DOMAIN_MEMBER_ENTRY;
    private static final JSONObject STRING = PanelFormFields.schema("string");
    private static final JSONObject OBJECT = PanelFormFields.schema("object");
    private static final JSONObject INTEGER = PanelFormFields.schema("integer");
    private static final JSONObject STRING_MAP = JSONObject.of("type", "object", "additionalProperties", STRING);
    private static final JSONObject OBJECT_ARRAY = PanelFormFields.arraySchema(OBJECT);
    private static final JSONObject STRING_ARRAY = PanelFormFields.arraySchema(STRING);
    private static final JSONObject ACCESS = JSONObject.of("oneOf", List.of(
        objectSchema(JSONObject.of("kind", JSONObject.of("const", DOMAIN_MEMBER)), List.of("kind")),
        objectSchema(JSONObject.of("permissionCode", STRING), List.of("permissionCode"))));
    private static final JSONObject INPUTS = JSONObject.of("type", "object", "additionalProperties", JSONObject.of("oneOf", List.of(
        objectSchema(JSONObject.of("frameState", STRING), List.of("frameState")),
        objectSchema(JSONObject.of("literal", new JSONObject()), List.of("literal")))));
    private static final JSONObject DEFAULT_AGENT = JSONObject.of("oneOf", List.of(
        objectSchema(JSONObject.of("kind", JSONObject.of("const", "id"), "id", STRING), List.of("kind", "id")),
        objectSchema(JSONObject.of("kind", JSONObject.of("const", "preset"), "agentKind", STRING), List.of("kind", "agentKind"))));
    private static final JSONObject IDENTITY_SCHEMA = objectSchema(JSONObject.of(
        "names", STRING_MAP, "descriptions", STRING_MAP, "icon", STRING), List.of("names", "descriptions", "icon"));
    private static final JSONObject GROUPS_SCHEMA = PanelFormFields.arraySchema(objectSchema(
        JSONObject.of("key", STRING, "names", STRING_MAP, "sort", INTEGER), List.of("key", "names", "sort")));
    private static final JSONObject DECLARATION_SCHEMA = objectSchema(JSONObject.of(
        "names", STRING_MAP, "descriptions", STRING_MAP, "icon", STRING, "groups", GROUPS_SCHEMA, "permissions", OBJECT_ARRAY),
        List.of("names", "descriptions", "icon", "groups", "permissions"));
    private static final JSONObject ENTRY_SCHEMA = objectSchema(JSONObject.of(
        "path", STRING, "renderer", JSONObject.of("const", "panels")), List.of("path", "renderer"));
    private static final JSONObject USE_SCHEMA = objectSchema(JSONObject.of(
        "id", STRING, "pageKey", STRING, "panelId", STRING, "path", STRING, "access", ACCESS,
        "names", STRING_MAP, "descriptions", STRING_MAP, "groupKey", STRING, "inputs", INPUTS, "defaultAgent", DEFAULT_AGENT),
        List.of("id", "pageKey", "panelId", "path", "access"));

    private static final List<Locale> LOCALES = List.of("en", "zh-CN", "zh-TW", "ja", "fr", "de", "it", "ar")
        .stream().map(Locale::forLanguageTag).toList();
    private final Locale locale;
    private final ResourceBundle copy;

    ApplicationCatalogueForm(Locale requested) {
        var language = Locale.forLanguageTag(requested.getLanguage());
        locale = LOCALES.contains(requested) ? requested : LOCALES.contains(language) ? language : Locale.ENGLISH;
        copy = ResourceBundle.getBundle("application_catalogue_form", locale,
            ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES));
    }

    JSONObject identity(JSONObject app, JSONObject draft) {
        var values = draft == null ? JSONObject.of("names", app.getJSONObject("names"),
            "descriptions", app.getJSONObject("descriptions"), "icon", app.getString("icon")) : draft;
        return describe(identityFields(), values, draft == null ? List.of() : identityErrors(draft),
            APPLICATIONS + app.getString("id") + "/identity", "saveIdentity", IDENTITY_SCHEMA);
    }

    JSONObject entries(JSONObject app, JSONObject draft, Function<String, String> conflicts) {
        var id = app.getString("id");
        var values = draft;
        List<ObjectNode> errors;
        if (values == null) {
            var uses = app.getList("panelUses", ApplicationPanelUse.class);
            values = JSONObject.of("entry", app.getJSONObject("entry"), "panelUses", uses);
            values.putAll(app.getJSONObject("panelSettings"));
            var savedErrors = new PanelFormErrors();
            for (int i = 0; i < uses.size(); i++)
                validatePageKey(uses.get(i).pageKey(), "/panelUses/" + i + "/pageKey", conflicts, savedErrors);
            errors = savedErrors.list();
        } else {
            errors = entryErrors(id, draft, app, conflicts);
        }
        return describe(entryFields(id), values, errors, APPLICATIONS + id + "/panel-uses", "saveEntries", registrationSchema(false));
    }

    JSONObject create(String id, JSONObject draft, Function<String, String> conflicts) {
        var values = draft == null ? JSONObject.of(
            "declaration", JSONObject.of("names", JSONObject.of("en", ""), "descriptions", new JSONObject(),
                "icon", "pages", "groups", List.of(), "permissions", List.of()),
            "entry", JSONObject.of("path", ApplicationCatalog.assignedPanelRoot(id), "renderer", "panels"),
            "entryAccess", List.of(DOMAIN_MEMBER), "panelUses", List.of()) : draft;
        var fields = entryFields(id);
        var metadata = identityFields();
        metadata.add(groupsField());
        metadata.add(field("/permissions", "permissions", PanelFormFields.code("json"), OBJECT_ARRAY, true));
        fields.addFirst(field("/declaration", "identity", PanelFormFields.object(metadata, null), DECLARATION_SCHEMA, true));
        fields.add(field("/entryAccess", "applicationAccess", PanelFormFields.stringArray(), STRING_ARRAY, true));
        return describe(fields, values, draft == null ? List.of() : entryErrors(id, draft, null, conflicts),
            APPLICATIONS + id + "/panel-uses?create=true", "create", registrationSchema(true));
    }

    private JSONArray identityFields() {
        return JSONArray.of(
            field("/names", "name", localizedText(List.of("en"), false), STRING_MAP, true, "name.help"),
            field("/descriptions", "description", localizedText(List.of(), true), STRING_MAP, true, "description.help"),
            field("/icon", "icon", JSONObject.of("kind", "application-icon"), STRING, true, "icon.help"));
    }

    private JSONObject groupsField() {
        var fields = JSONArray.of(
            field("/key", "groupKey", PanelFormFields.text(false), STRING, true),
            field("/names", "name", localizedText(List.of("en"), false), STRING_MAP, true),
            field("/sort", "groupSort", JSONObject.of("kind", "number"), INTEGER, true));
        var empty = JSONObject.of("key", "", "names", JSONObject.of("en", ""), "sort", 0);
        return field("/groups", "groups", PanelFormFields.objectArray(fields, empty, null), GROUPS_SCHEMA, true);
    }

    private JSONObject localizedText(List<String> requiredLocales, boolean multiline) {
        var languages = LOCALES.stream()
            .map(language -> JSONObject.of("code", language.toLanguageTag(), "label", language.getDisplayName(locale)))
            .toList();
        return JSONObject.of("kind", "localized-text", "primaryLocale", locale.toLanguageTag(), "locales", languages,
            "requiredLocales", requiredLocales, "multiline", multiline);
    }

    private JSONArray entryFields(String id) {
        var path = field("/path", "address", PanelFormFields.text(false), STRING, true);
        var item = JSONArray.of(
            field("/id", "entryId", PanelFormFields.text(false), STRING, true),
            field("/pageKey", "pageKey", PanelFormFields.text(false), STRING, true),
            path,
            field("/panelId", "panelId", PanelFormFields.text(false), STRING, true),
            field("/inputs", "inputs", PanelFormFields.code("json"), INPUTS, false),
            field("/names", "menuNames", PanelFormFields.code("json"), STRING_MAP, false),
            field("/descriptions", "entryDescriptions", PanelFormFields.code("json"), STRING_MAP, false),
            field("/groupKey", "menuGroup", PanelFormFields.text(false), STRING, false),
            field("/access", "entryAccess", PanelFormFields.code("json"), ACCESS, true),
            field("/defaultAgent", "defaultAgent", PanelFormFields.code("json"), DEFAULT_AGENT, false));
        var root = ApplicationCatalog.assignedPanelRoot(id);
        return JSONArray.of(
            field("/entry", "applicationAddress", PanelFormFields.object(JSONArray.of(path), null), ENTRY_SCHEMA, true),
            field("/panelUses", "entries", PanelFormFields.objectArray(item,
                JSONObject.of("id", "", "pageKey", "", "panelId", "", "path", root + "/",
                    "access", JSONObject.of("kind", DOMAIN_MEMBER)), "/id"),
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
        return objectSchema(JSONObject.of("entry", ENTRY_SCHEMA, "panelUses", PanelFormFields.arraySchema(USE_SCHEMA),
            "entryAccess", STRING_ARRAY, "declaration", DECLARATION_SCHEMA,
            "framePanelId", STRING, "theme", OBJECT, "delivery", OBJECT),
            create ? List.of("entry", "panelUses", "entryAccess", "declaration") : List.of("entry", "panelUses"));
    }

    private static JSONObject objectSchema(JSONObject properties, List<String> required) {
        return JSONObject.of("type", "object", "properties", properties, "required", required, "additionalProperties", false);
    }

    private static JSONObject describe(JSONArray fields, JSONObject values, List<ObjectNode> errors,
            String path, String operation, JSONObject schema) {
        return JSONObject.of("fields", fields, "values", values, "errors", errors, "save",
            JSONObject.of("method", "PUT", "path", path, "bodySchema", schema, "draftOperation", operation));
    }

    static List<ObjectNode> identityErrors(JSONObject values) {
        var errors = new PanelFormErrors();
        validateIdentity(values, "", errors);
        return errors.list();
    }

    private static void validateIdentity(JSONObject values, String prefix, PanelFormErrors errors) {
        var names = errors.requiredObject(values, "names", prefix + "/names");
        if (names != null) {
            if (!names.containsKey("en")) errors.required(prefix + "/names/en", "English name is required");
            validateTranslations(names, prefix + "/names", true, errors);
        }
        var descriptions = errors.requiredObject(values, "descriptions", prefix + "/descriptions");
        if (descriptions != null) validateTranslations(descriptions, prefix + "/descriptions", false, errors);
        var icon = errors.requiredString(values, "icon", prefix + "/icon");
        if (icon != null && !ApplicationCatalog.validIcon(icon))
            errors.invalidOption(prefix + "/icon", "Icon must be a lowercase identifier up to 64 characters");
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
                for (var array : List.of("groups", "permissions"))
                    if (!(declaration.get(array) instanceof List<?> items) || items.stream().anyMatch(item -> !(item instanceof Map<?, ?>)))
                        errors.invalidArray("/declaration/" + array, "Expected an array of objects");
            }
            var access = values.get("entryAccess");
            if (!(access instanceof List<?> list) || list.size() != 1 || !(list.getFirst() instanceof String code)
                    || !(DOMAIN_MEMBER.equals(code) || ApplicationCatalog.ownsPermissionCode(id, code)))
                errors.invalidOption("/entryAccess", "Use domain-member or one permission of this application");
        }
        validateUses(id, values, root, declaration, existing == null, conflicts, errors);
        return errors.list();
    }

    private static void validateUses(String id, JSONObject values, String root, JSONObject declaration,
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
            if (use.containsKey("descriptions")) {
                var pointer = path + "/descriptions";
                var descriptions = errors.requiredObject(use, "descriptions", pointer);
                if (descriptions != null) {
                    if (!descriptions.containsKey("en")) errors.required(pointer + "/en", "English description is required");
                    for (var description : descriptions.entrySet()) {
                        if (!(description.getValue() instanceof String text) || ApplicationPanelUse.blankDescription(text))
                            errors.invalidObject(pointer + "/" + PanelFormFields.pointer(description.getKey()), "Expected a nonblank description");
                    }
                }
            }
            validatePath(use, path + "/path", root, errors);
            var access = errors.requiredObject(use, "access", path + "/access");
            if (access != null && (access.size() != 1 || !(DOMAIN_MEMBER.equals(access.get("kind"))
                || access.get("permissionCode") instanceof String code && ApplicationCatalog.ownsPermissionCode(id, code))))
                errors.invalidOption(path + "/access", "Use domain-member or a declared permission of this application");
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
            var codes = declaration.getList("permissions", ApplicationCatalog.Permission.class).stream()
                .map(ApplicationCatalog.Permission::code).collect(Collectors.toSet());
            ApplicationCatalog.validateUsePermissions(canonical, codes);
            ApplicationCatalog.validateUseGroups(canonical, declaration.getList("groups", ApplicationCatalog.Group.class));
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
