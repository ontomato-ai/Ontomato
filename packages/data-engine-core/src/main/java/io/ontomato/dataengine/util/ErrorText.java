package io.ontomato.dataengine.util;

/** Driver errors retain their established cause-chain text without depending on a chat client. */
public final class ErrorText {
  private ErrorText() {}

  private static final int RAW_ERROR_MAX_CHARS = 4000,
      RAW_ERROR_HEAD_CHARS = 3000,
      RAW_ERROR_TAIL_CHARS = 1000;

  public static String rawErrorText(Throwable error) {
    StringBuilder text = new StringBuilder();
    for (Throwable current = error; current != null; current = current.getCause()) {
      String message = current.getMessage();
      if (message == null || message.isBlank()) {
        message = current.getClass().getSimpleName();
      }
      if (text.indexOf(message) < 0) {
        if (text.length() > 0) {
          text.append("\nCaused by: ");
        }
        text.append(message);
      }
    }
    if (text.length() <= RAW_ERROR_MAX_CHARS) {
      return text.toString();
    }
    return text.substring(0, RAW_ERROR_HEAD_CHARS)
        + "\n... (the raw error is "
        + text.length()
        + " characters in total, omitting "
        + (text.length() - RAW_ERROR_HEAD_CHARS - RAW_ERROR_TAIL_CHARS)
        + " characters here) ...\n"
        + text.substring(text.length() - RAW_ERROR_TAIL_CHARS);
  }
}
