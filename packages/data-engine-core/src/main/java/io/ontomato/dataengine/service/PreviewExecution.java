package io.ontomato.dataengine.service;

import jakarta.servlet.http.HttpServletRequest;
import java.util.function.Supplier;

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
   * Refuses an Action execution for a preview. A preview has no Action to run: whether an Action is right is answered by
   * an action trial, and nothing is parsed, staged or executed first.
   */
  public static void refuseActionExecution(HttpServletRequest request) {
    if (isPreview(request)) throw new Refused();
  }

  /**
   * Refuses a preview's business-data write that targets live data. A write bound to an action-trial or generation
   * sandbox is that run's own verification and is admitted: writing there and reading it back is how a trial or a
   * generation check answers its question.
   */
  public static void refuseLiveWrite(HttpServletRequest request, Supplier<ExecutionTarget> target) {
    if (isPreview(request) && target.get().mode() != ExecutionTarget.Mode.SANDBOX) throw new Refused();
  }

  /** A preview's write, refused; its HTTP answer is given by {@code PreviewExecutionErrors}. */
  public static final class Refused extends RuntimeException {
    public Refused() { super(WRITE_MESSAGE); }
  }
}
