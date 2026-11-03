package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import jakarta.annotation.PostConstruct;
import java.util.HashSet;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

/** Domain-scoped immutable revisions with optimistic editing and an explicit published pointer. */
@Service
public class ObjectViewStore {
    private final JdbcTemplate jdbc;
    public ObjectViewStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @PostConstruct
    public void initialize() {
        jdbc.execute("CREATE TABLE IF NOT EXISTS object_view (domain_id VARCHAR(64) NOT NULL, class_name VARCHAR(200) NOT NULL, form VARCHAR(16) NOT NULL, revision INTEGER NOT NULL DEFAULT 0, published_revision INTEGER, PRIMARY KEY(domain_id, class_name, form))");
        // Earlier installations stored one content document per type without a form factor.
        // Keep that content intact while upgrading the key used by versioned views.
        jdbc.execute("ALTER TABLE object_view ADD COLUMN IF NOT EXISTS form VARCHAR(16) NOT NULL DEFAULT 'full'");
        jdbc.execute("ALTER TABLE object_view ADD COLUMN IF NOT EXISTS published_revision INTEGER");
        jdbc.execute("ALTER TABLE object_view ALTER COLUMN revision SET DEFAULT 0");
        jdbc.execute("""
            DO $$
            DECLARE legacy_key TEXT;
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='object_view'::regclass AND attname='content' AND NOT attisdropped) THEN
                ALTER TABLE object_view ALTER COLUMN content SET DEFAULT '';
              END IF;
              SELECT c.conname INTO legacy_key FROM pg_constraint c
              WHERE c.conrelid='object_view'::regclass AND c.contype='p'
                AND NOT EXISTS (SELECT 1 FROM unnest(c.conkey) k
                  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k WHERE a.attname='form');
              IF legacy_key IS NOT NULL THEN
                EXECUTE format('ALTER TABLE object_view DROP CONSTRAINT %I', legacy_key);
                ALTER TABLE object_view ADD PRIMARY KEY (domain_id, class_name, form);
              END IF;
            END $$
            """);
        jdbc.execute("CREATE TABLE IF NOT EXISTS object_view_version (domain_id VARCHAR(64) NOT NULL, class_name VARCHAR(200) NOT NULL, form VARCHAR(16) NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL, author VARCHAR(200) NOT NULL, description TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(domain_id, class_name, form, revision))");
        jdbc.execute("ALTER TABLE object_view_version ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE");
        jdbc.execute("UPDATE object_view_version v SET published=TRUE FROM object_view h WHERE v.domain_id=h.domain_id AND v.class_name=h.class_name AND v.form=h.form AND v.revision=h.published_revision AND NOT v.published");
    }

    private void checkKey(String className, String form) {
        if (className == null || className.isBlank() || className.length() > 200 || !("full".equals(form) || "panel".equals(form)))
            throw new IllegalArgumentException("Invalid object view key");
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public JSONObject read(String domain, String className, String form, boolean editing) {
        checkKey(className, form);
        var heads = jdbc.queryForList("SELECT revision, published_revision FROM object_view WHERE domain_id=? AND class_name=? AND form=?", domain, className, form);
        if (heads.isEmpty()) return JSONObject.of("revision", 0, "publishedRevision", null, "versions", new JSONArray());
        var head = heads.get(0);
        var versions = jdbc.query("SELECT revision, document, author, description, created_at FROM object_view_version WHERE domain_id=? AND class_name=? AND form=? "
                + (editing ? "" : "AND revision=? ") + "ORDER BY revision DESC", (rs, index) -> JSONObject.of(
                    "revision", rs.getInt("revision"), "document", JSON.parseObject(rs.getString("document")),
                    "author", rs.getString("author"), "description", rs.getString("description"), "createdAt", rs.getLong("created_at")),
                editing ? new Object[]{domain, className, form} : new Object[]{domain, className, form, head.get("published_revision")});
        return JSONObject.of("revision", head.get("revision"), "publishedRevision", head.get("published_revision"), "versions", versions);
    }

    @Transactional
    public JSONObject save(String domain, String author, String className, String form, int expectedRevision, JSONObject document, String description) {
        checkKey(className, form);
        validateDocument(className, document);
        if (expectedRevision < 0) throw new IllegalArgumentException("Invalid expected revision");
        if (description == null || description.length() > 2000) throw new IllegalArgumentException("Invalid version description");
        jdbc.update("INSERT INTO object_view(domain_id,class_name,form) VALUES (?,?,?) ON CONFLICT DO NOTHING", domain, className, form);
        int changed = jdbc.update("UPDATE object_view SET revision=revision+1 WHERE domain_id=? AND class_name=? AND form=? AND revision=?", domain, className, form, expectedRevision);
        if (changed != 1) throw new ViewConflictException();
        jdbc.update("INSERT INTO object_view_version(domain_id,class_name,form,revision,document,author,description,created_at) VALUES (?,?,?,?,?,?,?,?)",
                domain, className, form, expectedRevision + 1, document.toJSONString(), author == null ? "" : author, description, System.currentTimeMillis());
        return read(domain, className, form, true);
    }

    @Transactional
    public JSONObject publish(String domain, String className, String form, int revision, int expectedRevision) {
        checkKey(className, form);
        if (revision < 1 || expectedRevision < revision) throw new IllegalArgumentException("Invalid revision");
        Integer exists = jdbc.queryForObject("SELECT COUNT(*) FROM object_view_version WHERE domain_id=? AND class_name=? AND form=? AND revision=?", Integer.class, domain, className, form, revision);
        if (exists == null || exists != 1) throw new IllegalArgumentException("Object view revision does not exist");
        int changed = jdbc.update("UPDATE object_view SET published_revision=? WHERE domain_id=? AND class_name=? AND form=? AND revision=?", revision, domain, className, form, expectedRevision);
        if (changed != 1) throw new ViewConflictException();
        jdbc.update("UPDATE object_view_version SET published=TRUE WHERE domain_id=? AND class_name=? AND form=? AND revision=?", domain, className, form, revision);
        return read(domain, className, form, true);
    }

    @Transactional(readOnly = true)
    public JSONObject list(String domain, String className) {
        JSONArray views = new JSONArray();
        jdbc.query("SELECT v.class_name,v.form,v.revision,v.document FROM object_view h JOIN object_view_version v ON v.domain_id=h.domain_id AND v.class_name=h.class_name AND v.form=h.form AND v.revision=h.published_revision WHERE h.domain_id=? AND (CAST(? AS VARCHAR) IS NULL OR h.class_name=?) ORDER BY v.class_name,v.form",
            (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                JSONObject document = JSON.parseObject(rs.getString("document"));
                views.add(JSONObject.of("className", rs.getString("class_name"), "form", rs.getString("form"), "revision", rs.getInt("revision"), "title", document.getString("title"), "inputs", document.getJSONObject("inputs"), "dependencies", dependencies(document)));
            }, domain, className, className);
        return JSONObject.of("views", views);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public JSONObject resolve(String domain, String className, String form, Integer revision) {
        checkKey(className, form);
        JSONObject state = read(domain, className, form, false);
        if (revision == null) {
            if (state.getJSONArray("versions").isEmpty()) throw new IllegalArgumentException("No published object view");
            revision = state.getInteger("publishedRevision");
        }
        if (revision < 1) throw new IllegalArgumentException("Invalid object view revision");
        var versions = jdbc.query("SELECT document FROM object_view_version WHERE domain_id=? AND class_name=? AND form=? AND revision=? AND published=TRUE",
            (rs, index) -> JSON.parseObject(rs.getString("document")), domain, className, form, revision);
        if (versions.isEmpty()) throw new IllegalArgumentException("Published object view revision not found");
        JSONObject document = versions.get(0);
        return JSONObject.of("className", className, "form", form, "revision", revision, "document", document, "dependencies", dependencies(document));
    }

    public static JSONObject dependencies(JSONObject document) {
        Set<String> metrics = new java.util.TreeSet<>(), actions = new java.util.TreeSet<>(), skills = new java.util.TreeSet<>(), classes = new java.util.TreeSet<>();
        classes.add(document.getString("className"));
        for (Object t : document.getJSONArray("tabs")) for (Object s : ((JSONObject)t).getJSONArray("sections")) for (Object w : ((JSONObject)s).getJSONArray("widgets")) {
            JSONObject widget = (JSONObject)w;
            String kind = widget.getString("kind"), resource = widget.getString("resourceId"), target = widget.getString("targetClass");
            if (resource != null && !resource.isBlank()) {
                if (Set.of("metric", "table", "chart").contains(kind)) metrics.add(resource);
                if ("action".equals(kind)) actions.add(resource);
            }
            if ("chart".equals(kind)) skills.add(widget.getString("skillId") == null ? "echarts" : widget.getString("skillId"));
            if (target != null && !target.isBlank()) classes.add(target);
        }
        return JSONObject.of("metricViews", metrics, "actions", actions, "skills", skills, "classes", classes);
    }

    public static void validateDocument(String className, JSONObject document) {
        if (document == null || document.toJSONString().length() > 1_000_000 || document.getIntValue("schemaVersion") != 1 || !className.equals(document.getString("className")))
            throw new IllegalArgumentException("Invalid object view document");
        JSONArray tabs = document.getJSONArray("tabs");
        if (tabs == null || tabs.isEmpty() || tabs.size() > 20) throw new IllegalArgumentException("A view requires between 1 and 20 tabs");
        Set<String> ids = new HashSet<>();
        Set<String> keys = new HashSet<>();
        requireText(document, "title", 200);
        checkText(document, "titleField", 200);
        JSONObject inputs = document.getJSONObject("inputs");
        if (inputs != null) for (String name : inputs.keySet()) {
            checkVariable(name);
            JSONObject definition = inputs.getJSONObject(name);
            if (definition == null || !Set.of("string", "number", "boolean").contains(definition.getString("type"))) throw new IllegalArgumentException("Invalid input type");
            checkText(definition, "description", 1000);
            if (definition.containsKey("required") && !(definition.get("required") instanceof Boolean)) throw new IllegalArgumentException("Invalid required flag");
            JSONArray choices = definition.getJSONArray("enum");
            if (choices != null && (choices.isEmpty() || choices.size() > 100)) throw new IllegalArgumentException("Invalid input choices");
            if (choices != null) for (Object choice : choices) checkInputValue(definition.getString("type"), choice);
            Object value = definition.get("default");
            checkInputValue(definition.getString("type"), value);
            if (definition.containsKey("default") && choices != null && !choices.contains(value)) throw new IllegalArgumentException("Invalid input default");
        }
        JSONObject variables = document.getJSONObject("variables");
        if (variables != null) for (String key : variables.keySet()) {
            checkVariable(key);
            Object value = variables.get(key);
            if (value != null && !(value instanceof String || value instanceof Number || value instanceof Boolean)) throw new IllegalArgumentException("Invalid variable default");
        }
        for (int t = 0; t < tabs.size(); t++) {
            JSONObject tab = tabs.getJSONObject(t);
            checkId(tab, ids);
            JSONArray sections = tab.getJSONArray("sections");
            if (sections == null || sections.isEmpty() || sections.size() > 30) throw new IllegalArgumentException("Invalid sections");
            for (int s = 0; s < sections.size(); s++) {
                JSONObject section = sections.getJSONObject(s);
                checkId(section, ids);
                JSONArray widgets = section.getJSONArray("widgets");
                if (widgets == null || widgets.size() > 100) throw new IllegalArgumentException("Invalid widgets");
                for (int w = 0; w < widgets.size(); w++) {
                    JSONObject widget = widgets.getJSONObject(w);
                    checkId(widget, ids);
                    String capabilityKey = widget.getString("key");
                    if (capabilityKey != null && !capabilityKey.matches("[A-Za-z][A-Za-z0-9_-]{0,99}")) throw new IllegalArgumentException("Invalid capability key");
                    if (!keys.add(capabilityKey == null ? widget.getString("id") : capabilityKey)) throw new IllegalArgumentException("Duplicate capability key");
                    if (widget.getString("kind") == null || !Set.of("text", "properties", "metric", "table", "chart", "links", "input", "action", "button").contains(widget.getString("kind"))
                            || widget.getIntValue("span") < 1 || widget.getIntValue("span") > 12)
                        throw new IllegalArgumentException("Invalid widget");
                    for (String key : Set.of("title", "resourceId", "skillId", "resultPath", "valueField", "labelField", "relation", "targetClass", "dateField", "descriptionField", "latitudeField", "longitudeField")) checkText(widget, key, 200);
                    checkText(widget, "text", 10000);
                    if (widget.containsKey("height") && (widget.getIntValue("height") < 80 || widget.getIntValue("height") > 1200)) throw new IllegalArgumentException("Invalid widget height");
                    checkEnum(widget, "direction", Set.of("incoming", "outgoing"));
                    checkEnum(widget, "chartType", Set.of("bar", "line", "donut", "timeline", "graph", "leaflet-map"));
                    checkEnum(widget, "onClick", Set.of("refresh", "setVariable", "openObject"));
                    String variable = widget.getString("variable");
                    if (variable != null && !variable.isEmpty()) checkVariable(variable);
                    JSONArray fields = widget.getJSONArray("fields");
                    if (fields != null && (fields.size() > 100 || fields.stream().anyMatch(field -> !(field instanceof String) || ((String)field).length() > 200))) throw new IllegalArgumentException("Invalid widget fields");
                    for (String key : Set.of("readOnlyParameters", "contextFields")) {
                        JSONArray names = widget.getJSONArray(key);
                        if (names != null && (names.size() > 100 || names.stream().anyMatch(name -> !(name instanceof String) || ((String)name).length() > 200))) throw new IllegalArgumentException("Invalid action context");
                    }
                    checkBinding(widget.getJSONObject("binding"));
                    checkInputBinding(widget.getJSONObject("binding"), inputs);
                    JSONObject fieldOptions = widget.getJSONObject("fieldOptions");
                    if (fieldOptions != null) for (String field : fieldOptions.keySet()) {
                        if (field.length() > 200 || Set.of("__proto__", "constructor", "prototype").contains(field)) throw new IllegalArgumentException("Invalid option field");
                        JSONArray options = fieldOptions.getJSONArray(field);
                        if (options == null || options.isEmpty() || options.size() > 100) throw new IllegalArgumentException("Invalid field options");
                        for (int o = 0; o < options.size(); o++) {
                            requireText(options.getJSONObject(o), "value", 200);
                            requireText(options.getJSONObject(o), "label", 200);
                        }
                    }
                    JSONObject fieldLabels = widget.getJSONObject("fieldLabels");
                    if (fieldLabels != null) for (String field : fieldLabels.keySet()) {
                        if (field.length() > 200) throw new IllegalArgumentException("Invalid label field");
                        checkText(fieldLabels, field, 200);
                    }
                    JSONObject parameters = widget.getJSONObject("parameters");
                    if (parameters != null) for (String name : parameters.keySet()) {
                        if (name.length() > 200 || Set.of("__proto__", "constructor", "prototype").contains(name)) throw new IllegalArgumentException("Invalid parameter name");
                        checkBinding(parameters.getJSONObject(name));
                        checkInputBinding(parameters.getJSONObject(name), inputs);
                    }
                    JSONObject condition = widget.getJSONObject("visibleWhen");
                    if (condition != null) {
                        checkBinding(condition.getJSONObject("binding"));
                        checkInputBinding(condition.getJSONObject("binding"), inputs);
                        checkEnum(condition, "operator", Set.of("eq", "ne", "present", "empty"));
                        checkText(condition, "value", 1000);
                    }
                }
            }
        }
    }

    private static void checkId(JSONObject item, Set<String> ids) {
        String id = item.getString("id");
        if (id == null || id.isBlank() || id.length() > 100 || !ids.add(id)) throw new IllegalArgumentException("Missing or duplicate layout id");
        requireText(item, "title", 200);
    }

    private static void checkInputValue(String type, Object value) {
        if (value != null && !("string".equals(type) && value instanceof String || "number".equals(type) && value instanceof Number || "boolean".equals(type) && value instanceof Boolean)) throw new IllegalArgumentException("Input value does not match its type");
    }

    private static void checkInputBinding(JSONObject binding, JSONObject inputs) {
        if (binding != null && "input".equals(binding.getString("source")) && (inputs == null || !inputs.containsKey(binding.getString("path").split("\\.")[0]))) throw new IllegalArgumentException("Unknown input binding");
    }

    private static void requireText(JSONObject item, String key, int max) {
        if (!(item.get(key) instanceof String)) throw new IllegalArgumentException("Missing " + key);
        checkText(item, key, max);
    }

    private static void checkVariable(String value) {
        if (!value.matches("[A-Za-z_][A-Za-z0-9_]{0,99}") || Set.of("__proto__", "constructor", "prototype").contains(value)) throw new IllegalArgumentException("Invalid variable name");
    }
    private static void checkText(JSONObject item, String key, int max) {
        Object value = item.get(key);
        if (value != null && (!(value instanceof String) || ((String)value).length() > max)) throw new IllegalArgumentException("Invalid " + key);
    }
    private static void checkEnum(JSONObject item, String key, Set<String> values) {
        if (item.containsKey(key) && !values.contains(item.getString(key))) throw new IllegalArgumentException("Invalid " + key);
    }
    private static void checkBinding(JSONObject binding) {
        if (binding == null) return;
        String source = binding.getString("source");
        if (source == null || !Set.of("literal", "object", "variable", "input").contains(source)) throw new IllegalArgumentException("Invalid binding source");
        if (!"literal".equals(source)) {
            String path = binding.getString("path");
            if (path == null || path.length() > 200 || java.util.Arrays.stream(path.split("\\.")).anyMatch(part -> Set.of("__proto__", "constructor", "prototype").contains(part))) throw new IllegalArgumentException("Invalid binding path");
        }
    }

    public static class ViewConflictException extends RuntimeException {
        public ViewConflictException() { super("The view changed. Reload before saving or publishing."); }
    }
}
