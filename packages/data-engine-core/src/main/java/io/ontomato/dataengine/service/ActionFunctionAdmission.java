package io.ontomato.dataengine.service;

import io.ontomato.dataengine.bean.function.Function;

/** The Function contract owned by Actions, independent of Python protocol admission. */
public final class ActionFunctionAdmission {
  private ActionFunctionAdmission() {}

  public static void requireSupported(Function function, LangService messages, String lang) {
    if (!Function.OPERATION_WRITE.equals(function.getOperation()) || function.getQueryPackage() != null)
      throw new IllegalArgumentException(messages.get(lang, "Action.unsupportedFunction"));
  }
}
