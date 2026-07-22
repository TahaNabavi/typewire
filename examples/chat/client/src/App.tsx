import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SocketError } from "@tahanabavi/typesocket";

import type { Message } from "../../shared/contracts.js";
import { Inspector } from "./Inspector.js";
import { useConnection, useSocketEvent } from "./hooks.js";
import { socket } from "./socket.js";

const TYPING_IDLE_MS = 1_500;

export function App() {
  const connection = useConnection();
  const [identity, setIdentity] = useState<{ user: string; roomId: string } | null>(
    null,
  );

  return (
    <div className="app">
      <main>
        <Header connection={connection} identity={identity} />
        {identity ? (
          <Room
            identity={identity}
            onLeave={() => {
              socket.modules.room.leave({ roomId: identity.roomId });
              setIdentity(null);
            }}
          />
        ) : (
          <JoinForm disabled={!connection.connected} onJoin={setIdentity} />
        )}
      </main>
      <Inspector />
    </div>
  );
}

function Header({
  connection,
  identity,
}: {
  connection: ReturnType<typeof useConnection>;
  identity: { user: string; roomId: string } | null;
}) {
  return (
    <header className="top">
      <div>
        <h1>typesocket chat</h1>
        <p>
          {identity ? (
            <>
              <b>{identity.user}</b> in <b>#{identity.roomId}</b>
            </>
          ) : (
            "One contract. Validated both directions."
          )}
        </p>
      </div>
      <span className={`status ${connection.connected ? "on" : "off"}`}>
        <span className="dot" />
        {connection.connected
          ? `connected${connection.attempt > 1 ? ` · reconnect #${connection.attempt}` : ""}`
          : (connection.error ?? "connecting…")}
      </span>
    </header>
  );
}

function JoinForm({
  disabled,
  onJoin,
}: {
  disabled: boolean;
  onJoin: (identity: { user: string; roomId: string }) => void;
}) {
  const [user, setUser] = useState("");
  const [roomId, setRoomId] = useState("general");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // `join` declares an `ack`, so this returns a Promise — and the reply is
      // validated against the contract before it resolves.
      await socket.modules.room.join({ user, roomId });
      onJoin({ user, roomId });
    } catch (err) {
      // Typed failures: validation, ack timeout, not connected.
      setError(err instanceof SocketError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="join" onSubmit={submit}>
      <label>
        Your name
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="taha"
          maxLength={24}
          required
        />
      </label>
      <label>
        Room
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="general"
          required
        />
      </label>
      <button disabled={disabled || busy}>{busy ? "joining…" : "Join"}</button>
      {error && <p className="error">{error}</p>}
      <p className="hint">
        Open this page in two tabs with different names to see frames flow both
        ways in the inspector.
      </p>
    </form>
  );
}

function Room({
  identity,
  onLeave,
}: {
  identity: { user: string; roomId: string };
  onLeave: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [typists, setTypists] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Re-join on mount (and after a reconnect) to hydrate history and presence.
  useEffect(() => {
    let cancelled = false;
    const join = async () => {
      try {
        const state = await socket.modules.room.join(identity);
        if (cancelled) return;
        setMessages(state.history);
        setMembers(state.members);
      } catch (err) {
        if (!cancelled) setError(err instanceof SocketError ? err.message : String(err));
      }
    };
    void join();
    const off = socket.onConnect(() => void join());
    return () => {
      cancelled = true;
      off();
    };
  }, [identity]);

  useSocketEvent(
    socket.modules.chat.message,
    useCallback((m) => setMessages((prev) => [...prev, m]), []),
  );

  useSocketEvent(
    socket.modules.room.presence,
    useCallback((p) => setMembers(p.members), []),
  );

  useSocketEvent(
    socket.modules.chat.typing,
    useCallback(
      (t) =>
        setTypists((prev) =>
          t.isTyping
            ? prev.includes(t.user)
              ? prev
              : [...prev, t.user]
            : prev.filter((u) => u !== t.user),
        ),
      [],
    ),
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Typing is high-frequency and has no ack, so it's fire-and-forget. The idle
  // timer sends the trailing `false` that the keystroke handler can't know about.
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const signalTyping = (isTyping: boolean) => {
    socket.modules.chat.setTyping({ roomId: identity.roomId, isTyping });
  };
  const onDraftChange = (value: string) => {
    setDraft(value);
    signalTyping(value.length > 0);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => signalTyping(false), TYPING_IDLE_MS);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setDraft("");
    clearTimeout(idle.current);
    signalTyping(false);
    setError(null);

    try {
      // The ack is validated before this resolves. The message itself arrives
      // via the `chat.message` broadcast, so there's one render path for all.
      await socket.modules.chat.send({ roomId: identity.roomId, text });
    } catch (err) {
      setError(err instanceof SocketError ? err.message : String(err));
      setDraft(text); // don't lose what they typed
    }
  };

  const others = useMemo(
    () => typists.filter((u) => u !== identity.user),
    [typists, identity.user],
  );

  return (
    <section className="room">
      <div className="members">
        {members.map((m) => (
          <span key={m} className={`member ${m === identity.user ? "me" : ""}`}>
            {m}
          </span>
        ))}
        <button className="leave" onClick={onLeave}>
          leave
        </button>
      </div>

      <div className="messages">
        {messages.length === 0 && <p className="empty">No messages yet. Say something.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.user === identity.user ? "mine" : ""}`}>
            <span className="who">{m.user}</span>
            <span className="text">{m.text}</span>
            <span className="when">
              {new Date(m.sentAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="typing">
        {others.length > 0 &&
          `${others.join(", ")} ${others.length === 1 ? "is" : "are"} typing…`}
      </div>

      {error && <p className="error">{error}</p>}

      <form className="composer" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Message…"
          maxLength={500}
        />
        <button disabled={!draft.trim()}>Send</button>
      </form>
    </section>
  );
}
