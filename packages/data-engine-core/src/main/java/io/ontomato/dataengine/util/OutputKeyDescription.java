package io.ontomato.dataengine.util;

import java.util.Map;

public final class OutputKeyDescription {
  public static String getOutputKeyDescriptionMDTable(Map<String, String[]> descriptionMap) {
    String markdown =
        "| Return field | Function | Class description | Field description | Metric description"
            + " |\n";
    markdown += "| ---- | ---- | ---- | ---- | ---- |\n";
    for (String as : descriptionMap.keySet()) {
      String[] class_attr_indicator_function = descriptionMap.get(as);
      String classDesc = class_attr_indicator_function[0];
      String attrDesc = class_attr_indicator_function[1];
      String indicatorDesc = class_attr_indicator_function[2];
      String function = class_attr_indicator_function[3];
      markdown +=
          "| "
              + as
              + " | "
              + (function == null || "".equals(function.trim()) ? "none" : function)
              + " | "
              + classDesc
              + " | "
              + attrDesc
              + " | "
              + (indicatorDesc == null || "".equals(indicatorDesc.trim()) ? "none" : indicatorDesc)
              + " |\n";
    }
    return markdown;
  }
}
