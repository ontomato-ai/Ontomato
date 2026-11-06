package io.ontomato.dataengine.service;

/**
 * The Python executor owns protocol admission; scheduling only projects this same rule into its
 * form.
 */
public final class PythonProgramProtocol {
  private PythonProgramProtocol() {}

  public static boolean supported(String code) {
    return code != null && code.contains("# ontomato-python:2");
  }

  public static String unavailableReason(String code, String locale) {
    return supported(code)
        ? null
        : ProgramExecutionException.Reason.RETIRED_PROTOCOL.message(locale);
  }

  public static void requireSupported(String code, String locale) {
    if (!supported(code))
      throw new ProgramExecutionException(
          ProgramExecutionException.Reason.RETIRED_PROTOCOL, locale);
  }
}
