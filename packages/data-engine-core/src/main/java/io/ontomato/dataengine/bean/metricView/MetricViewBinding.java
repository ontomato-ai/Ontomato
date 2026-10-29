package io.ontomato.dataengine.bean.metricView;

import com.alibaba.fastjson2.JSONObject;
import java.util.Set;
import lombok.Data;

/** An owned parameter set. Publication, domain and lifetime belong to its MetricView. */
@Data
public class MetricViewBinding {
  private String id;
  private String name;
  private String description;
  private JSONObject parameters;
  private Set<String> matchQuestions;
}
