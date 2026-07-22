import { useFrameLog, type Frame } from "./hooks.js";

/**
 * A miniature devtools panel, built entirely on `socket.instrument()`.
 *
 * Everything here comes from the instrumentation stream — no special hooks in
 * the chat code, no wrapper around emit. That's the point of the seam: a panel
 * can be bolted on without the app knowing it exists.
 */
export function Inspector() {
  const { frames, clear } = useFrameLog();

  return (
    <aside className="inspector">
      <header>
        <span className="dot" />
        <h2>inspector</h2>
        <span className="count">{frames.length} frames</span>
        <button onClick={clear} disabled={!frames.length}>
          clear
        </button>
      </header>

      <div className="frames">
        {frames.length === 0 && (
          <p className="empty">
            Every frame in and out of the socket shows up here, already parsed.
          </p>
        )}
        {frames.map((frame) => (
          <FrameRow key={frame.key} frame={frame} />
        ))}
      </div>
    </aside>
  );
}

function FrameRow({ frame }: { frame: Frame }) {
  const { label, tone } = describe(frame);
  const eventId = "eventId" in frame ? frame.eventId : "";
  const detail = payloadOf(frame);

  return (
    <div className={`frame ${tone}`}>
      <span className="tag">{label}</span>
      <span className="eid">
        {eventId ? (
          <>
            <span className="ns">{eventId.split(".")[0]}.</span>
            {eventId.split(".").slice(1).join(".")}
          </>
        ) : (
          <span className="ns">connection</span>
        )}
      </span>
      {"durationMs" in frame && <span className="ms">{frame.durationMs}ms</span>}
      {detail && <code className="payload">{detail}</code>}
    </div>
  );
}

function describe(frame: Frame): { label: string; tone: string } {
  switch (frame.type) {
    case "outbound":
      return { label: frame.queued ? "QUEUED" : "OUT →", tone: "out" };
    case "ack":
      return { label: frame.fromMock ? "← MOCK" : "← ACK", tone: "ack" };
    case "inbound":
      return { label: "IN ←", tone: "in" };
    case "dropped":
      return { label: `DROP·${frame.by}`, tone: "drop" };
    case "frame_error":
      return { label: "ERROR", tone: "err" };
    case "connect":
      return { label: `CONNECT #${frame.attempt}`, tone: "sys" };
    case "disconnect":
      return { label: "DISCONNECT", tone: "err" };
    case "connect_error":
      return { label: "CONN ERR", tone: "err" };
  }
}

function payloadOf(frame: Frame): string | null {
  const value =
    frame.type === "outbound" || frame.type === "inbound"
      ? frame.payload
      : frame.type === "ack"
        ? frame.data
        : frame.type === "frame_error" || frame.type === "connect_error"
          ? frame.error.message
          : frame.type === "disconnect"
            ? frame.reason
            : null;

  if (value == null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}
