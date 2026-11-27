package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import jakarta.servlet.http.HttpServletRequest;

/** Preview identity at the Java HTTP boundary; it is write admission, never read routing. */
public final class PreviewExecution {
  public static final String HEADER = "X-Ontomato-Execution-Context";
  public static final String WRITE_CODE = "PREVIEW_WRITE_FORBIDDEN";
  public static final String WRITE_MESSAGE = "预览里不执行写操作，动作的对错用动作试跑验";

  private PreviewExecution() {}

  public static boolean isPreview(HttpServletRequest request) {
    String header = request.getHeader(HEADER);
    if (header == null) return false;
    try {
      var declaration = JSON.parseObject(header);
      return declaration != null && "preview".equals(declaration.getString("kind"));
    } catch (RuntimeException invalid) {
      return false;
    }
  }
}
