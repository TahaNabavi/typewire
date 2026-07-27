import { TypeDevtools } from "@tahanabavi/type-devtools";
import { useMutation, useQuery } from "@tahanabavi/typefetch-react";
import { useState } from "react";
import type { createStack } from "../../shared/stack.js";

type Stack = ReturnType<typeof createStack>;

export function App({ stack }: { stack: Stack }) {
  const [userId, setUserId] = useState("1");

  return (
    <main>
      <header>
        <h1>TypeWire query layer</h1>
        <p>
          One contract, one cache, two transports — and a timeline that shows
          both. Nothing below names a cache key.
        </p>
      </header>

      <nav className="tabs">
        {["1", "2"].map((id) => (
          <button
            key={id}
            className={id === userId ? "tab active" : "tab"}
            onClick={() => setUserId(id)}
          >
            user {id}
          </button>
        ))}
      </nav>

      {/* Switching the id changes the hook's input, which is a different cache
          entry. The second visit to a user is served from cache. */}
      <UserCard userId={userId} stack={stack} />
      <ChatCard stack={stack} />

      <TypeDevtools
        bridge={stack.bridge}
        queries={stack.queries}
        defaultOpen
        title="TypeWire devtools"
      />
    </main>
  );
}

function UserCard({ userId, stack }: { userId: string; stack: Stack }) {
  const [draft, setDraft] = useState("");

  // The daily call site: the endpoint and its input. No key, no query function.
  const user = useQuery(stack.getUser, { path: { id: userId } }, {
    staleTime: 30_000,
  });

  // No `onSuccess` refetch and no key here either. The client declares
  // `"user.updateUser" → ["user.getUser"]` once, at setup, and the watching
  // query above refetches itself.
  const rename = useMutation(stack.updateUser);

  return (
    <section className="card">
      <div className="card-head">
        <h2>useQuery</h2>
        <span className={user.isFetching ? "dot fetching" : "dot"}>
          {user.isFetching ? "fetching" : user.isStale ? "stale" : "fresh"}
        </span>
      </div>

      {user.isLoading && <p className="muted">loading…</p>}
      {user.isError && <p className="error">{user.error?.message}</p>}
      {user.data && (
        <dl className="kv">
          <dt>id</dt>
          <dd>{user.data.id}</dd>
          <dt>name</dt>
          <dd>{user.data.name}</dd>
          <dt>version</dt>
          <dd>{user.data.version}</dd>
        </dl>
      )}

      <div className="row">
        <input
          value={draft}
          placeholder="new name"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          disabled={!draft || rename.isPending}
          onClick={() => {
            rename.mutate({ path: { id: userId }, body: { name: draft } });
            setDraft("");
          }}
        >
          {rename.isPending ? "saving…" : "rename"}
        </button>
        <button className="ghost" onClick={() => void user.refetch()}>
          refetch
        </button>
      </div>
      <p className="hint">
        Rename, and watch <code>version</code> climb without this component
        naming a cache key.
      </p>
    </section>
  );
}

function ChatCard({ stack }: { stack: Stack }) {
  const [text, setText] = useState("");

  // The same hook over WebSocket. typesocket calls its id `eventId` where
  // typefetch calls it `endpointId`; the engine takes either, so an acked
  // client->server event is just another source.
  const send = useMutation(stack.sendMessage);

  return (
    <section className="card">
      <div className="card-head">
        <h2>useMutation over WebSocket</h2>
        <span className="badge ws">ws</span>
      </div>

      <div className="row">
        <input
          value={text}
          placeholder="message"
          onChange={(e) => setText(e.target.value)}
        />
        <button
          disabled={!text || send.isPending}
          onClick={() => {
            send.mutate({ text });
            setText("");
          }}
        >
          send
        </button>
      </div>

      {send.isSuccess && send.data && (
        <p className="muted">
          ack <code>{send.data.id}</code> — “{send.data.text}”
        </p>
      )}
      {send.isError && <p className="error">{send.error?.message}</p>}
      <p className="hint">
        Same hook, same cache, different transport — and it lands in the same
        timeline below.
      </p>
    </section>
  );
}
