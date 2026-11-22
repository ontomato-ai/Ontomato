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
    private static final JSONObject BOOLEAN = PanelFormFields.schema("boolean");
    private static final JSONObject INTEGER = PanelFormFields.schema("integer");
    private static final JSONObject STRING_MAP = JSONObject.of("type", "object", "additionalProperties", STRING);
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
    private static final JSONObject PERMISSIONS_SCHEMA = PanelFormFields.arraySchema(objectSchema(
        JSONObject.of("code", STRING, "names", STRING_MAP, "groupKey", STRING, "sort", INTEGER),
        List.of("code", "names", "groupKey", "sort")));
    private static final JSONObject DECLARATION_SCHEMA = objectSchema(JSONObject.of(
        "names", STRING_MAP, "descriptions", STRING_MAP, "icon", STRING, "groups", GROUPS_SCHEMA, "permissions", PERMISSIONS_SCHEMA),
        List.of("names", "descriptions", "icon", "groups", "permissions"));
    private static final JSONObject ENTRY_SCHEMA = objectSchema(JSONObject.of(
        "path", STRING, "renderer", JSONObject.of("const", "panels")), List.of("path", "renderer"));
    private static final JSONObject COUNT = objectSchema(JSONObject.of("member", STRING, "data", STRING), List.of("member", "data"));
    private static final JSONObject USE_SCHEMA = objectSchema(JSONObject.of(
        "id", STRING, "pageKey", STRING, "panelId", STRING, "path", STRING, "access", ACCESS,
        "names", STRING_MAP, "descriptions", STRING_MAP, "groupKey", STRING, "inputs", INPUTS, "defaultAgent", DEFAULT_AGENT, "count", COUNT),
        List.of("id", "pageKey", "panelId", "path", "access"));

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
        return describe(entryFields(id, entryAccessOptions(id, app.get("permissions"))), values, errors,
            APPLICATIONS + id + "/panel-uses", "saveEntries", registrationSchema(false));
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
                values = JSONObject.from(existingUse);
                var savedErrors = new PanelFormErrors();
                validatePageKey(existingUse.pageKey(), "/pageKey", conflicts, savedErrors);
                errors = savedErrors.list();
            } else {
                values = JSONObject.of("id", "", "pageKey", "", "panelId", "", "path", root + "/",
                    "access", JSONObject.of("kind", DOMAIN_MEMBER));
                errors = List.of();
            }
        } else {
            values = draft;
            errors = singleEntryErrors(id, draft, app, conflicts);
        }
        var itemFields = singleEntryFields(entryAccessOptions(id, app.get("permissions")), !isNew);
        return describe(itemFields, values, errors, APPLICATIONS + id + "/panel-uses", "saveEntry", USE_SCHEMA);
    }

    JSONObject create(String id, JSONObject draft, Function<String, String> conflicts) {
        var values = draft == null ? JSONObject.of(
            "declaration", JSONObject.of("names", new JSONObject(), "descriptions", new JSONObject(),
                "icon", "pages", "groups", List.of(), "permissions", List.of()),
            "shared", false,
            "entry", JSONObject.of("path", ApplicationCatalog.assignedPanelRoot(id), "renderer", "panels"),
            "entryAccess", List.of(DOMAIN_MEMBER), "panelUses", List.of()) : draft;
        var permissions = values.get("declaration") instanceof Map<?, ?> declaration ? declaration.get("permissions") : null;
        var fields = entryFields(id, entryAccessOptions(id, permissions));
        var metadata = identityFields();
        metadata.add(groupsField());
        metadata.add(permissionsField(id));
        fields.addFirst(field("/declaration", "identity", PanelFormFields.object(metadata, null), DECLARATION_SCHEMA, true));
        fields.add(field("/entryAccess", "applicationAccess", PanelFormFields.stringArray(), STRING_ARRAY, true));
        fields.add(field("/shared", "initialGrant", PanelFormFields.select(JSONArray.of(
            PanelFormFields.option(false, copy.getString("initialGrant.private")),
            PanelFormFields.option(true, copy.getString("initialGrant.domain")))),
            BOOLEAN, false, "initialGrant.help"));
        return describe(fields, values, draft == null ? List.of() : entryErrors(id, draft, null, conflicts),
            APPLICATIONS + id + "/panel-uses?create=true", "create", registrationSchema(true));
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

    private JSONObject permissionsField(String id) {
        var code = field("/code", "permissionCode", PanelFormFields.text(false), STRING, true);
        var names = field("/names", "name", localizedText(List.of(), false), STRING_MAP, true);
        // Edited permissions supply the entry access choices in the same draft.
        code.put("refreshOnChange", true);
        names.put("refreshOnChange", true);
        var fields = JSONArray.of(code, names,
            field("/groupKey", "groupKey", PanelFormFields.text(false), STRING, true),
            field("/sort", "groupSort", JSONObject.of("kind", "number"), INTEGER, true));
        var empty = JSONObject.of("code", ApplicationCatalog.permissionPrefix(id), "names", new JSONObject(),
            "groupKey", "", "sort", 0);
        var permissions = field("/permissions", "permissions", PanelFormFields.objectArray(fields, empty, null), PERMISSIONS_SCHEMA, true);
        permissions.put("refreshOnChange", true);
        return permissions;
    }

    private JSONObject localizedText(List<String> requiredLocales, boolean multiline) {
        var languages = LOCALES.stream()
            .map(language -> JSONObject.of("code", language.toLanguageTag(), "label", language.getDisplayName(locale)))
            .toList();
        return JSONObject.of("kind", "localized-text", "primaryLocale", locale.toLanguageTag(), "locales", languages,
            "requiredLocales", requiredLocales, "multiline", multiline);
    }

    private JSONArray entryAccessOptions(String id, Object declaredPermissions) {
        var options = JSONArray.of(PanelFormFields.option(JSONObject.of("kind", DOMAIN_MEMBER), copy.getString("domainMember")));
        if (!(declaredPermissions instanceof List<?> permissions)) return options;
        var rows = new JSONArray(permissions);
        for (int i = 0; i < rows.size(); i++) {
            if (!(rows.get(i) instanceof Map<?, ?> || rows.get(i) instanceof ApplicationCatalog.Permission)) continue;
            var permission = rows.getJSONObject(i);
            if (!(permission.get("code") instanceof String code) || !ApplicationCatalog.ownsPermissionCode(id, code)) continue;
            var label = code;
            if (permission.get("names") instanceof Map<?, ?> names) {
                var localized = ApplicationCatalog.localizedText(names, locale);
                if (localized != null) label = localized;
            }
            options.add(PanelFormFields.option(JSONObject.of("permissionCode", code), label));
        }
        return options;
    }

    private JSONArray singleEntryFields(JSONArray accessOptions, boolean idReadOnly) {
        var inputs = field("/inputs", "inputs", PanelFormFields.code("json"), INPUTS, false);
        inputs.put("advanced", true);
        var entryIdField = PanelFormFields.field("/id", copy.getString("entryId"), PanelFormFields.text(false), STRING,
            true, idReadOnly, null, null, false);
        return JSONArray.of(
            entryIdField,
            field("/pageKey", "pageKey", PanelFormFields.text(false), STRING, true),
            field("/path", "address", PanelFormFields.text(false), STRING, true),
            field("/panelId", "panelId", PanelFormFields.text(false), STRING, true),
            field("/names", "menuNames", localizedText(List.of(), false), STRING_MAP, false),
            field("/descriptions", "entryDescriptions", localizedText(List.of(), true), STRING_MAP, false),
            field("/groupKey", "menuGroup", PanelFormFields.text(false), STRING, false),
            field("/access", "entryAccess", PanelFormFields.select(accessOptions), ACCESS, true),
            field("/defaultAgent", "defaultAgent", PanelFormFields.select(new JSONArray()), DEFAULT_AGENT, false),
            inputs);
    }

    private JSONArray entryFields(String id, JSONArray accessOptions) {
        var inputs = field("/inputs", "inputs", PanelFormFields.code("json"), INPUTS, false);
        inputs.put("advanced", true);
        var item = JSONArray.of(
            field("/id", "entryId", PanelFormFields.text(false), STRING, true),
            field("/pageKey", "pageKey", PanelFormFields.text(false), STRING, true),
            field("/path", "address", PanelFormFields.text(false), STRING, true),
            field("/panelId", "panelId", PanelFormFields.text(false), STRING, true),
            inputs,
            field("/names", "menuNames", localizedText(List.of(), false), STRING_MAP, false),
            field("/descriptions", "entryDescriptions", localizedText(List.of(), true), STRING_MAP, false),
            field("/groupKey", "menuGroup", PanelFormFields.text(false), STRING, false),
            field("/access", "entryAccess", PanelFormFields.select(accessOptions), ACCESS, true),
            field("/defaultAgent", "defaultAgent", PanelFormFields.select(new JSONArray()), DEFAULT_AGENT, false));
        var root = ApplicationCatalog.assignedPanelRoot(id);
        return JSONArray.of(
            field("/entry/path", "applicationAddress", PanelFormFields.text(false), STRING, true),
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
        var props = JSONObject.of("entry", ENTRY_SCHEMA, "panelUses", PanelFormFields.arraySchema(USE_SCHEMA),
            "entryAccess", STRING_ARRAY, "declaration", DECLARATION_SCHEMA,
            "framePanelId", STRING, "theme", OBJECT, "delivery", OBJECT);
        if (create) props.put("shared", BOOLEAN);
        return objectSchema(props,
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
                validatePermissionRows(id, declaration, errors);
            }
            var access = values.get("entryAccess");
            if (!(access instanceof List<?> list) || list.size() != 1 || !(list.getFirst() instanceof String code)
                    || !(DOMAIN_MEMBER.equals(code) || ApplicationCatalog.ownsPermissionCode(id, code)))
                errors.invalidOption("/entryAccess", "Use domain-member or one permission of this application");
        }
        validateUses(id, values, root, declaration, existing == null, conflicts, errors);
        return errors.list();
    }

    private static void validatePermissionRows(String id, JSONObject declaration, PanelFormErrors errors) {
        var path = "/declaration/permissions";
        if (!(declaration.get("permissions") instanceof List<?> permissions)) {
            errors.invalidArray(path, "Expected an array of objects");
            return;
        }
        for (int i = 0; i < permissions.size(); i++) {
            var row = path + "/" + i;
            if (!(permissions.get(i) instanceof Map<?, ?>)) {
                errors.invalidObject(row, "Expected a permission object");
                continue;
            }
            var permission = declaration.getJSONArray("permissions").getJSONObject(i);
            var code = errors.requiredString(permission, "code", row + "/code");
            if (code != null && !ApplicationCatalog.ownsPermissionCode(id, code))
                errors.invalidOption(row + "/code", "A permission code must have a suffix after " + ApplicationCatalog.permissionPrefix(id));
            validateNames(permission, row + "/names", errors);
            errors.requiredString(permission, "groupKey", row + "/groupKey");
            if (!(permission.get("sort") instanceof Integer))
                errors.invalidObject(row + "/sort", "Expected an integer sort order");
        }
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
        validatePath(use, "/path", root, errors);
        var access = errors.requiredObject(use, "access", "/access");
        if (access != null && (access.size() != 1 || !(DOMAIN_MEMBER.equals(access.get("kind"))
            || access.get("permissionCode") instanceof String code && ApplicationCatalog.ownsPermissionCode(id, code))))
            errors.invalidOption("/access", "Use domain-member or a declared permission of this application");
        if (!errors.isEmpty()) return errors.list();
        try {
            var canonical = ApplicationPanelUse.canonical(List.of(use.toJavaObject(ApplicationPanelUse.class)));
            var codes = app.getList("permissions", ApplicationCatalog.Permission.class).stream()
                .map(ApplicationCatalog.Permission::code).collect(Collectors.toSet());
            ApplicationCatalog.validateUsePermissions(canonical, codes);
            ApplicationCatalog.validateUseGroups(canonical, app.getList("groups", ApplicationCatalog.Group.class));
        } catch (ResponseStatusException | JSONException error) {
            errors.invalidObject("/id", error);
        }
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
