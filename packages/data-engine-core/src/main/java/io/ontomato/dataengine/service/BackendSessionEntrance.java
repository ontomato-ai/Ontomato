package io.ontomato.dataengine.service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.logging.DiagnosticEventLogger;
import io.ontomato.dataengine.util.SseEmitterUtil;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

/**
 * Owns the lifecycle, first frame and heartbeat of Java session streams, and the shared
 * session cancellation and derived-id rules used by model calls and query execution.
 */
@Slf4j
@Service
public class BackendSessionEntrance {

	/**
	 * Business callback of the streaming entrance: it runs on the stream built by the entrance, and the entrance closes the stream when it finishes.
	 */
	@FunctionalInterface
	public interface StreamWork {
		void run(String sessionId);
	}

	/**
	 * Heartbeat period of a session stream (confirmed design 9: session streams periodically send heartbeat comment frames; this only sends and introduces no cancellation or closing behavior).
	 */
	private static final long HEARTBEAT_PERIOD_SECONDS = 10L;

	private static final ScheduledExecutorService HEARTBEAT_SCHEDULER = Executors.newSingleThreadScheduledExecutor(r -> {
		Thread thread = new Thread(r, "sse-heartbeat");
		thread.setDaemon(true);
		return thread;
	});

	private final Map<String, ScheduledFuture<?>> heartbeatTasks = new ConcurrentHashMap<>();

	@Autowired
	private SessionRegistryService sessionRegistryService;

	/**
	 * The only static facade through which non-Spring contexts (model HTTP worker threads, manually new-ed sub-query executors) can reach the cancellation check.
	 * Callers must ensure the instance has been published (at Spring startup; published manually in tests), otherwise it fails immediately.
	 */
	private static volatile BackendSessionEntrance instance;

	@PostConstruct
	public void publishInstance() {
		instance = this;
	}

	/**
	 * The only static entry point for the cancellation check: any session id (main or derived) → read the cancellation flag by main session id.
	 * Callers must ensure the instance has been published (at Spring startup; published manually in tests).
	 */
	public static boolean isCancelled(String sessionId) {
		return instance.sessionRegistryService.isSessionCancelled(sessionId);
	}

	/**
	 * New session: generate the session id, register the start in the routing table and log {@code request.received}.
	 *
	 * @param request original request body, recorded as-is in the diagnostic event payload
	 * @return the newly generated 36-character UUID session id
	 */
	public String beginNewSession(JSONObject request) {
		String sessionId = UUID.randomUUID().toString();
		sessionRegistryService.registerStart(sessionId);
		DiagnosticEventLogger.emit("request.received", sessionId, new JSONObject().fluentPut("request", request));
		return sessionId;
	}

	/**
	 * Session end: register the end in the routing table.
	 */
	public void endSession(String sessionId) {
		sessionRegistryService.registerEnd(sessionId);
	}

	/**
	 * The first frame of a new session stream, {@code {"sessionId": "...", "nodeId": "..."}},
	 * with the same shape as the frame the original harness emits itself. Callers send it before any business processing.
	 */
	public String firstFrame(String sessionId) {
		JSONObject frame = new JSONObject();
		frame.put("sessionId", sessionId);
		frame.put("nodeId", sessionRegistryService.getNodeId());
		return JSON.toJSONString(frame, Feature.WriteMapNullValue);
	}

	/**
	 * Stream of a new session: open the stream, send the first frame before any business processing and
	 * start the heartbeat; the business logic runs on a background thread, and when it finishes the heartbeat is stopped, the stream is closed and the end is registered.
	 *
	 * @param streamName stream name, used only for the diagnostic log when the background business logic fails
	 */
	public SseEmitter openNewSessionStream(JSONObject request, String streamName, StreamWork work) {
		String sessionId = beginNewSession(request);
		try {
			SseEmitter emitter = SseEmitterUtil.createSseEmitter(sessionId);
			SseEmitterUtil.sendSseEmitter(sessionId, firstFrame(sessionId));
			startHeartbeat(sessionId);
			executeStreamWork(sessionId, streamName, work);
			return emitter;
		} catch (RuntimeException e) {
			endSession(sessionId);
			throw e;
		}
	}

	/**
	 * Background execution of streaming business logic: when the business logic fails, send a {@code {"error": ...}} frame (the B3 error chain convention),
	 * then stop the heartbeat, close the stream and register the end. The dynamic hot data callback already catches by itself and sends
	 * {@code {"success": false, ...}} result frames, so the error frame here only covers the path where the callback itself throws.
	 */
	private void executeStreamWork(String sessionId, String streamName, StreamWork work) {
		Executors.newSingleThreadExecutor().execute(() -> {
			try {
				work.run(sessionId);
			} catch (SessionCancelledException e) {
				// Cancellation is not an ordinary failure: send no error frame and log no error; the background thread ends with the stream closed in finally.
				log.info("[" + sessionId + "] " + streamName + " cancelled, stream ends");
			} catch (Exception e) {
				log.error("[" + sessionId + "] " + streamName + " failed", e);
				JSONObject errorMessage = new JSONObject();
				errorMessage.put("error", e.toString());
				SseEmitterUtil.sendSseEmitter(sessionId, JSON.toJSONString(errorMessage));
			} finally {
				closeSessionStream(sessionId);
			}
		});
	}

	private void closeSessionStream(String sessionId) {
		stopHeartbeat(sessionId);
		try {
			SseEmitterUtil.closeSseEmitter(sessionId);
		} finally {
			endSession(sessionId);
		}
	}

	/**
	 * Start the heartbeat of a session stream: a comment frame roughly every 10 seconds, until {@link #stopHeartbeat(String)}.
	 * Only called on session streams; other streams such as the QA stream do not get one.
	 * A failed heartbeat send (the stream disconnected before its normal end) means that session was cancelled: stop this session's heartbeat and write the cancellation flag.
	 */
	public void startHeartbeat(String sessionId) {
		stopHeartbeat(sessionId);
		ScheduledFuture<?> future = HEARTBEAT_SCHEDULER.scheduleAtFixedRate(() -> {
			if (!SseEmitterUtil.sendHeartbeat(sessionId)) {
				heartbeatTick(sessionId);
			}
		}, HEARTBEAT_PERIOD_SECONDS, HEARTBEAT_PERIOD_SECONDS, TimeUnit.SECONDS);
		heartbeatTasks.put(sessionId, future);
	}

	/**
	 * Handling after one failed heartbeat send (the only place cancellation is triggered). Decided by the ownership in the heartbeat task map:
	 * removable = the stream is still running (not removed by closing the stream) → stop the heartbeat and write the cancellation flag;
	 * removal empty = already removed first by closeSessionStream (normal end) → do not write.
	 * A write failure is logged as error (the heartbeat task is the only caller; exceptions inside the scheduled thread are silently swallowed).
	 * Package-visible so tests can drive it directly.
	 */
	void heartbeatTick(String sessionId) {
		ScheduledFuture<?> future = heartbeatTasks.remove(sessionId);
		if (future == null) {
			return;
		}
		future.cancel(false);
		try {
			sessionRegistryService.markSessionCancelled(sessionId, System.currentTimeMillis());
		} catch (Exception e) {
			log.error("[" + sessionId + "] mark session cancelled failed", e);
		}
	}

	/**
	 * Stop the heartbeat of a session stream. Idempotent; called when the stream ends normally, after which nothing is sent.
	 */
	public void stopHeartbeat(String sessionId) {
		ScheduledFuture<?> future = heartbeatTasks.remove(sessionId);
		if (future != null) {
			future.cancel(false);
		}
	}

	/**
	 * Derived id rule (confirmed design 5): all work under a session uses {@code {sessionId}-{suffix}}.
	 * Diagnostics can reach it by prefix, and it stops when the session is cancelled; main session ids are always 36-character UUIDs, so
	 * taking the first 36 characters yields the main session id. Callers must ensure that concurrent work within one request uses different suffixes
	 * (for example with a sub-query index), so that they do not share the same id.
	 */
	public static String derive(String sessionId, String suffix) {
		return sessionId + "-" + suffix;
	}

	/**
	 * Recover the main session id from a derived id (confirmed design 5/9: main session ids are always 36-character UUIDs, take the first 36 characters).
	 * The rule is written only here; both the cancellation check and diagnostics go through it.
	 */
	public static String mainSessionId(String sessionId) {
		if (sessionId == null) {
			return null;
		}
		return sessionId.length() > 36 ? sessionId.substring(0, 36) : sessionId;
	}
}
