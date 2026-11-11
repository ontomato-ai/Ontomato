package io.ontomato.dataengine.service;

import io.ontomato.dataengine.bean.function.Function;

/** The Function contract owned by Actions, independent of Python protocol admission. */
public final class ActionFunctionAdmission {
  private ActionFunctionAdmission() {}

  public static void requireSupported(Function function, LangService messages, String lang) {
    if (!Function.OPERATION_WRITE.equals(function.getOperation()))
      throw new IllegalArgumentException("Function.operation=" + function.getOperation() + ": "
          + messages.get(lang, "Action.unsupportedFunction"));
    if (function.getQueryPackage() != null)
      throw new IllegalArgumentException("Function.queryPackage: " + messages.get(lang, "Action.unsupportedFunction"));
  }
}
