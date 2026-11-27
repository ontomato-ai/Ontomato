package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import jakarta.servlet.http.HttpServletRequest;
import java.util.function.Supplier;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Preview identity at the Java HTTP boundary. It admits or refuses a write of business object data and nothing else: it
 * never picks a read's route, target, grant filter or cache key, and the definitions, models, triggers, workflows and
 * platform objects a preview builds are judged by their owner against the caller's permission like any other caller's.
 */
public final class PreviewExecution {
  public static final String HEADER = "X-Ontomato-Execution-Context";
  public static final String WRITE_CODE = "PREVIEW_WRITE_FORBIDDEN";
  public static final String WRITE_MESSAGE = "预览里不执行写操作，动作的对错用动作试跑验";

  private PreviewExecution() {}

  public static boolean isPreview(HttpServletRequest request) {
    return "preview".equals(request.getHeader(HEADER));
  }

  /**
   * The refusal an Action execution entry gives a preview, or null for every other caller. A preview has no Action to
   * run: whether an Action is right is answered by an action trial, and nothing is parsed, staged or executed first.
   */
  public static JSONObject refuseActionExecution(HttpServletRequest request) {
    return isPreview(request) ? refuse() : null;
  }

  /**
   * The refusal a business-data write entry gives a preview whose write targets live data, or null when the write may
   * proceed. A write bound to an action-trial or generation sandbox is that run's own verification and is admitted:
   * writing there and reading it back is how a trial or a generation check answers its question.
   */
  public static JSONObject refuseLiveWrite(HttpServletRequest request, Supplier<ExecutionTarget> target) {
    return isPreview(request) && target.get().mode() != ExecutionTarget.Mode.SANDBOX ? refuse() : null;
  }

  private static JSONObject refuse() {
    ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getResponse().setStatus(422);
    return JSONObject.of("success", false, "code", WRITE_CODE, "message", WRITE_MESSAGE);
  }
}
