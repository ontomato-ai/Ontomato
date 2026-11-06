package io.ontomato.dataengine.util;

import io.ontomato.dataengine.dataAdapter.DslContractViolationException;
import io.ontomato.dataengine.service.ProgramExecutionException;
import io.ontomato.dataengine.service.ProgramExecutionException.Reason;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import java.sql.SQLException;
import java.util.Set;
import java.util.regex.Pattern;

/** Error disclosure is decided by exception type and origin, never by message contents. */
public final class ErrorText {
  private ErrorText() {}

  private static final Pattern HINT = Pattern.compile("(?im)^\\h*Hint:.*(?:\\R(?!\\h*[A-Za-z][A-Za-z ]*:).*)*");
  private static final Pattern PYTHON_FRAME = Pattern.compile(
      "(?m)^\\h*File \"(?:[^\"\\r\\n]*[/\\\\])?program\\.py\", line ([0-9]+)(?:, in [^\\r\\n]*)?\\h*\\r?$");
  private static final Pattern PYTHON_EXCEPTION = Pattern.compile("(?m)^([^\\s:]+)(?::[^\\r\\n]*)?\\r?$");
  private static final Set<String> PYTHON_BUILTINS = Set.of(
      "BaseException", "Exception", "BaseExceptionGroup", "ExceptionGroup", "GeneratorExit",
      "KeyboardInterrupt", "SystemExit", "ArithmeticError", "AssertionError", "AttributeError",
      "BufferError", "EOFError", "ImportError", "ModuleNotFoundError", "LookupError", "IndexError",
      "KeyError", "MemoryError", "NameError", "UnboundLocalError", "OSError", "EnvironmentError",
      "IOError", "WindowsError", "BlockingIOError", "ChildProcessError", "ConnectionError",
      "BrokenPipeError", "ConnectionAbortedError", "ConnectionRefusedError", "ConnectionResetError",
      "FileExistsError", "FileNotFoundError", "InterruptedError", "IsADirectoryError",
      "NotADirectoryError", "PermissionError", "ProcessLookupError", "TimeoutError", "ReferenceError",
      "RuntimeError", "NotImplementedError", "RecursionError", "PythonFinalizationError",
      "StopIteration", "StopAsyncIteration", "SyntaxError", "IndentationError", "TabError",
      "SystemError", "TypeError", "ValueError", "UnicodeError", "UnicodeDecodeError",
      "UnicodeEncodeError", "UnicodeTranslateError", "FloatingPointError", "OverflowError",
      "ZeroDivisionError", "Warning", "UserWarning", "DeprecationWarning", "PendingDeprecationWarning",
      "SyntaxWarning", "RuntimeWarning", "FutureWarning", "ImportWarning", "UnicodeWarning",
      "BytesWarning", "ResourceWarning", "EncodingWarning");

  /** The single query error boundary, including internal Python queries and adapter write queries. */
  public static String queryError(Throwable error) {
    for (Throwable current = error; current != null; current = current.getCause()) {
      if (current instanceof DslContractViolationException) return current.getMessage();
      if (current instanceof SQLException sql && sql.getSQLState() != null) {
        if (sql.getSQLState().startsWith("42") && sql.getMessage() != null)
          return HINT.matcher(sql.getMessage()).replaceAll("").strip();
        if (sql.getSQLState().startsWith("22")) return "Data type conversion failed; the value is hidden";
        return "Query execution failed";
      }
    }
    return "Query execution failed";
  }

  /**
   * Preserve only host-owned execution reasons; raw exception messages may contain credentials or
   * stacks.
   */
  public static Reason programFailure(Throwable error) {
    var seen =
        java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<Throwable, Boolean>());
    Reason fallback = Reason.FAILED;
    for (Throwable current = error;
        current != null && seen.add(current);
        current = current.getCause()) {
      if (current instanceof ProgramExecutionException failure) return failure.reason();
      if (current instanceof SessionCancelledException || current instanceof InterruptedException)
        return Reason.CANCELLED;
      if (current instanceof java.net.http.HttpTimeoutException
          || current instanceof java.net.SocketTimeoutException) fallback = Reason.TIMED_OUT;
      else if (current instanceof java.io.IOException && fallback == Reason.FAILED)
        fallback = Reason.RUNTIME_UNAVAILABLE;
      else if (current instanceof AgentHttpException runtime)
        fallback =
            runtime.status() == 401 || runtime.status() == 403
                ? Reason.RUNTIME_AUTHORIZATION_DENIED
                : Reason.RUNTIME_REJECTED;
    }
    return fallback;
  }

  public static String programError(Throwable error, String locale) {
    return programFailure(error).message(locale);
  }

  /** Only a built-in type and an integer frame number may come from untrusted stderr. */
  public static String pythonError(String stderr, String queryError) {
    String type = "Exception";
    Integer line = null;
    if (stderr != null) {
      var frames = PYTHON_FRAME.matcher(stderr);
      while (frames.find()) {
        try { line = Integer.valueOf(frames.group(1)); }
        catch (NumberFormatException invalid) { line = null; }
      }
      var exceptions = PYTHON_EXCEPTION.matcher(stderr);
      while (exceptions.find()) type = PYTHON_BUILTINS.contains(exceptions.group(1)) ? exceptions.group(1) : "Exception";
    }
    String message = type + (line == null ? "" : " at program.py line " + line);
    return queryError == null || queryError.isBlank() ? message : message + "\nQuery failed: " + queryError;
  }
}
