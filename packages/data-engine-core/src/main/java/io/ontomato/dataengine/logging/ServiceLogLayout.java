package io.ontomato.dataengine.logging;

import java.nio.charset.StandardCharsets;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.config.plugins.Plugin;
import org.apache.logging.log4j.core.config.plugins.PluginFactory;
import org.apache.logging.log4j.core.layout.AbstractStringLayout;
import org.apache.logging.log4j.message.StringMapMessage;

@Plugin(name = "ServiceLogLayout", category = "Core", elementType = "layout", printObject = true)
public final class ServiceLogLayout extends AbstractStringLayout {
  private ServiceLogLayout() { super(StandardCharsets.UTF_8); }
  @PluginFactory public static ServiceLogLayout create() { return new ServiceLogLayout(); }
  @Override public String toSerializable(LogEvent event) {
    return ((StringMapMessage) event.getMessage()).get("line") + ServiceLogFormat.DEFINITION.getString("newline");
  }
}
