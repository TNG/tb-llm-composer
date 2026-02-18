const KEEP_ALIVE_ALARM_NAME = "llm-keep-alive";
const KEEP_ALIVE_INTERVAL_MINUTES = 0.4; // ~24 seconds, well under the ~90s idle threshold

let activeRequests = 0;

/**
 * Starts a periodic alarm to keep the background page alive during long-running LLM requests.
 * Thunderbird MV3 event pages can be suspended after ~90s of inactivity.
 * While an active fetch() should prevent suspension, this alarm acts as a safety net
 * for very long local LLM inference times (minutes to hours).
 */
export async function startKeepAlive(): Promise<void> {
  activeRequests++;
  if (activeRequests === 1) {
    console.log("KEEP-ALIVE: Starting keep-alive alarm for long-running LLM request");
    browser.alarms.create(KEEP_ALIVE_ALARM_NAME, {
      periodInMinutes: KEEP_ALIVE_INTERVAL_MINUTES,
    });
  }
}

/**
 * Stops the keep-alive alarm when no more LLM requests are active.
 */
export async function stopKeepAlive(): Promise<void> {
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0) {
    console.log("KEEP-ALIVE: Stopping keep-alive alarm, no active LLM requests");
    await browser.alarms.clear(KEEP_ALIVE_ALARM_NAME);
  }
}

/**
 * Handler for the keep-alive alarm. Simply logs to keep the background page active.
 */
export function handleKeepAliveAlarm(alarm: browser.alarms.Alarm): void {
  if (alarm.name === KEEP_ALIVE_ALARM_NAME) {
    console.log("KEEP-ALIVE: Heartbeat - background page still active");
  }
}
