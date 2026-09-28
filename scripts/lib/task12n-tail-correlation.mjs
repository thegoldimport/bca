// Correlate only this run's harmless public GET markers. Never persist unrelated
// tail URLs, headers, logs, or response bodies.
export function createTailCorrelation({ markerPrefix }) {
  const pending = new Map();
  const events = [];
  const metrics = { parsedEvents: 0, ownMarkerEvents: 0, matchedEvents: 0 };

  function ingest(event) {
    metrics.parsedEvents++;
    const requestUrl = event?.event?.request?.url;
    if (typeof requestUrl !== "string") return;
    let marker;
    try { marker = new URL(requestUrl).searchParams.get("task12n_observation"); }
    catch { return; }
    if (!marker?.startsWith(markerPrefix)) return;
    metrics.ownMarkerEvents++;
    // Match by URL, not script name. A wrong script must be retained as
    // evidence and explicitly FAIL the version gate, not appear to time out.
    const matched = pending.has(requestUrl);
    events.push({
      marker, scriptName: event.scriptName ?? null,
      versionId: event.scriptVersion?.id ?? null,
      eventTimestamp: event.eventTimestamp ?? null,
      urlMatched: matched,
    });
    if (matched) {
      metrics.matchedEvents++;
      pending.get(requestUrl)(event);
    }
  }

  function watch(requestUrl, timeoutMs = 12000) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pending.delete(requestUrl);
        resolve(null);
      }, timeoutMs);
      pending.set(requestUrl, event => {
        clearTimeout(timer);
        pending.delete(requestUrl);
        resolve(event);
      });
    });
  }

  function snapshot(marker) {
    return {
      metrics: { ...metrics },
      // The marker contains only our numeric run ID and a fixed request label.
      ownMarkerEvents: events.filter(event => event.marker === marker),
      otherRunEvents: events.filter(event => event.marker !== marker).length,
    };
  }
  return { ingest, watch, snapshot };
}

export function evaluateCapability(row, worker, expectedVersion, expectedRegistration) {
  const http = row?.response?.status === 200
    && row.response.parsed?.registrationEnabled === expectedRegistration
    && row.response.parsed?.email === true ? "PASS" : "FAIL";
  const version = !row?.tail?.versionId ? "UNKNOWN"
    : row.tail.scriptName === worker && row.tail.versionId === expectedVersion ? "PASS" : "FAIL";
  return { http, version };
}