package io.ontomato.dataengine.service;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.util.FileUtil;

/**
 * The business knowledge tag candidates of this edition. The values are data, not interface copy: they come from the
 * edition's non-language configuration file, which the enterprise build puts over the public one, so the same stored
 * value is used whichever language the caller asks for. Language packs only name the candidates.
 */
@Service
public class KnowledgeTagConfig {

    private final JSONObject values;

    public KnowledgeTagConfig() {
        this(JSON.parseObject(FileUtil.getResourceFileLoadAll("business-knowledge.json", "utf-8")));
    }

    public KnowledgeTagConfig(JSONObject values) {
        this.values = values;
    }

    /** The stored value of one candidate, keyed general/business/tech. */
    public String value(String key) {
        return values.getString(key);
    }
}
