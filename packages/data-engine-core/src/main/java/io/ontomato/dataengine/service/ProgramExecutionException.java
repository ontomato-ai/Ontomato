package io.ontomato.dataengine.service;

/**
 * Host-owned execution failures with fixed, public messages; raw transport diagnostics are not
 * public.
 */
public final class ProgramExecutionException extends IllegalArgumentException {
  public enum Reason {
    RETIRED_PROTOCOL(
        "code: This saved program uses the retired Python protocol. Convert or regenerate it before"
            + " execution (ontomato-python:2 required).",
        "code：程序是旧版协议，需要先转换或重新生成；程序必须包含 # ontomato-python:2 协议头"),
    DOMAIN_REQUIRED("Python execution requires the owning domain", "程序执行缺少所属域"),
    AUTHORITY_EXPIRED("Parent query grant expired", "程序执行授权已过期"),
    INPUT_CONFLICT("Input shadows an execution-owned file", "程序输入与执行器保留文件冲突"),
    TIMED_OUT("Python execution timed out", "程序执行超时"),
    CANCELLED("Program execution was cancelled", "程序执行已取消"),
    RUNTIME_UNAVAILABLE("The program runtime could not be reached", "暂时无法连接程序运行服务"),
    RUNTIME_AUTHORIZATION_DENIED(
        "The runtime rejected the execution authorization", "运行服务拒绝了程序执行授权"),
    RUNTIME_REJECTED("The program runtime rejected the execution request", "程序运行服务拒绝了执行请求"),
    FAILED("Program execution failed; inspect the service logs for details", "程序执行失败，请查看服务日志定位原因");

    private final String english;
    private final String chinese;

    Reason(String english, String chinese) {
      this.english = english;
      this.chinese = chinese;
    }

    public String message(String locale) {
      return locale != null && locale.startsWith("zh") ? chinese : english;
    }
  }

  private final Reason reason;

  public ProgramExecutionException(Reason reason, String locale) {
    this(reason, locale, null);
  }

  public ProgramExecutionException(Reason reason, String locale, Throwable cause) {
    super(reason.message(locale), cause);
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }
}
