package io.ontomato.dataengine.logging;

import com.alibaba.fastjson2.JSONObject;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.config.plugins.Plugin;
import org.apache.logging.log4j.core.lookup.AbstractLookup;
import org.apache.logging.log4j.core.lookup.StrLookup;

/** Discovered through the module's generated Log4j plugin metadata. */
@Plugin(name = "serviceLog", category = StrLookup.CATEGORY)
public final class ServiceLogLookup extends AbstractLookup {
  @Override public String lookup(LogEvent event, String key) {
    if ("archiveFiles".equals(key)) return String.valueOf(ServiceLogFormat.DEFAULTS.getJSONObject("file").getIntValue("maxFilesIncludingActive") - 1);
    Object value = ServiceLogFormat.DEFINITION;
    for (String part : key.split("\\.")) value = value instanceof JSONObject object ? object.get(part) : null;
    return value == null ? null : String.valueOf(value);
  }
}
