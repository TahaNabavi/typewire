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
      <TransferCard stack={stack} />

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

function TransferCard({ stack }: { stack: Stack }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  // `trackProgress` mirrors each tick into the mutation's own state, so the bar
  // below re-renders through the same subscription as `data` and `error`. No
  // `useState` for progress, and no second hook.
  const upload = useMutation(stack.upload, {
    trackProgress: "upload",
    onSuccess: (data) => setUploadedId(data.id),
  });

  // The download is a plain mutation because it is an action, not cached state.
  // `responseType: "file"` on the contract is what makes `data` a
  // `{ blob, filename, contentType, size }` instead of parsed JSON.
  const download = useMutation(stack.download, { trackProgress: "download" });

  const uploadPercent = upload.progress?.upload?.percent;
  const downloadPercent = download.progress?.download?.percent;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Progress &amp; response types</h2>
        <span className="badge http">real network</span>
      </div>

      <div className="row">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          disabled={!file || upload.isPending}
          onClick={() => file && upload.mutate({ body: { file } })}
        >
          {upload.isPending ? "uploading…" : "upload"}
        </button>
      </div>

      {/* `percent` is undefined when the length is unknown — an indeterminate
          bar, not a zero. */}
      {upload.progress && (
        <Bar label="upload" percent={uploadPercent} />
      )}

      {upload.isSuccess && upload.data && (
        <p className="muted">
          stored <code>{upload.data.id}</code> — {upload.data.bytes} bytes
        </p>
      )}
      {upload.isError && <p className="error">{upload.error?.message}</p>}

      <div className="row">
        <button
          className="ghost"
          disabled={!uploadedId || download.isPending}
          onClick={() =>
            uploadedId && download.mutate({ path: { id: uploadedId } })
          }
        >
          {download.isPending ? "downloading…" : "download it back"}
        </button>
        {download.isSuccess && download.data && (
          <button
            onClick={() => {
              // The whole point of `responseType: "file"`: the filename is
              // already parsed out of Content-Disposition.
              const url = URL.createObjectURL(download.data!.blob);
              Object.assign(document.createElement("a"), {
                href: url,
                download: download.data!.filename ?? "download.bin",
              }).click();
              URL.revokeObjectURL(url);
            }}
          >
            save “{download.data.filename ?? "download.bin"}”
          </button>
        )}
      </div>

      {download.progress && (
        <Bar label="download" percent={downloadPercent} />
      )}

      {download.isSuccess && download.data && (
        <dl className="kv">
          <dt>filename</dt>
          <dd>{download.data.filename ?? <em>not exposed</em>}</dd>
          <dt>type</dt>
          <dd>{download.data.contentType ?? "—"}</dd>
          <dt>size</dt>
          <dd>{download.data.size} bytes</dd>
        </dl>
      )}
      {download.isError && <p className="error">{download.error?.message}</p>}

      <p className="hint">
        These two endpoints are the only ones here that touch the network —
        progress needs bytes actually moving, and an override answers before the
        transport runs. Passing <code>onUploadProgress</code> is what moves the
        request from <code>fetch</code> to <code>XMLHttpRequest</code>, since{" "}
        <code>fetch</code> has no upload-progress API.
      </p>
    </section>
  );
}

/** A determinate bar when the length is known, an indeterminate one when not. */
function Bar({ label, percent }: { label: string; percent?: number }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className={percent === undefined ? "bar indeterminate" : "bar"}>
        <div
          className="bar-fill"
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
      <span className="bar-value">
        {percent === undefined ? "…" : `${percent.toFixed(0)}%`}
      </span>
    </div>
  );
}
