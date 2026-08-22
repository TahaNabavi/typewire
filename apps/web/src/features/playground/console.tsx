"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient, type RequestEvent } from "@tahanabavi/typefetch";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { JsonView } from "@/components/ui/json-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { contracts } from "@/features/playground/contracts";
import { cn } from "@/utils";

/**
 * A real TypeWire client, running in your browser.
 *
 * Nothing here is a mock. `ApiClient` is @tahanabavi/typefetch at the version
 * this site depends on, it is constructed from the same contract object the
 * server routes are implemented from, and every row in the timeline comes from
 * the client's own `instrument()` hook — the same extension point the devtools
 * package subscribes to.
 *
 * The two failure switches are what make this a demonstration rather than a
 * demo:
 *
 *   drift    the server answers with `fullName` where the contract says `name`.
 *            Response validation fails at the boundary and names the field.
 *   invalid  the *request* carries input the contract forbids. It never leaves
 *            the browser — request validation rejects it first.
 *
 * Both failures are the product working. A visitor who only ever sees green
 * rows has not been shown anything.
 */

type Client = ApiClient<typeof contracts>;

interface Row {
  id: string;
  endpoint: string;
  method: string;
  status: "pending" | "ok" | "error";
  durationMs?: number;
  detail?: string;
  payload?: unknown;
  /** Which boundary rejected it — the interesting part of a failure. */
  kind?: "request-validation" | "response-validation" | "http" | "network";
}

const CALLS: Array<{
  key: string;
  label: string;
  signature: string;
  run: (client: Client) => Promise<unknown>;
}> = [
  {
    key: "getUser",
    label: "getUser",
    signature: 'client.modules.user.getUser({ path: { id: "1" } })',
    run: (c) => c.modules.user.getUser({ path: { id: "1" } }),
  },
  {
    key: "getUserMissing",
    label: "getUser · 404",
    signature: 'client.modules.user.getUser({ path: { id: "999" } })',
    run: (c) => c.modules.user.getUser({ path: { id: "999" } }),
  },
  {
    key: "listUsers",
    label: "listUsers",
    signature: "client.modules.user.listUsers({ query: { limit: 3 } })",
    run: (c) => c.modules.user.listUsers({ query: { limit: 3 } }),
  },
  {
    key: "listAdmins",
    label: "listUsers · admins",
    signature: 'client.modules.user.listUsers({ query: { role: "admin", limit: 10 } })',
    run: (c) => c.modules.user.listUsers({ query: { role: "admin", limit: 10 } }),
  },
  {
    key: "createUser",
    label: "createUser",
    signature: "client.modules.user.createUser({ body: { name, email } })",
    run: (c) =>
      c.modules.user.createUser({
        body: {
          name: "New Person",
          email: `person-${Math.floor(Math.random() * 100_000)}@example.com`,
          role: "member",
        },
      }),
  },
];

/** The one call that is supposed to fail before it reaches the network. */
const INVALID = {
  label: "createUser · invalid input",
  signature: 'createUser({ body: { name: "x", email: "not-an-email" } })',
  run: (c: Client) =>
    c.modules.user.createUser({
      // Deliberately wrong: `name` is under the two-character minimum and
      // `email` is not an email. TypeScript would normally stop this — the cast
      // is what a real bug looks like once types have been bypassed, and the
      // runtime schema still catches it.
      body: { name: "x", email: "not-an-email", role: "member" } as never,
    }),
};

function pretty(value: unknown, max = 4000): string {
  let text: string;
  if (value instanceof Error) {
    text = JSON.stringify(
      { name: value.name, message: value.message, ...(value as unknown as object) },
      null,
      2,
    );
  } else {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const TONE = {
  ok: "var(--green)",
  error: "var(--red)",
  pending: "var(--amber)",
} as const;

const KIND_LABEL: Record<NonNullable<Row["kind"]>, string> = {
  "request-validation": "rejected before the network",
  "response-validation": "the server's answer did not match the contract",
  http: "the server answered with an error status",
  network: "the request never completed",
};

/**
 * Which boundary rejected a request.
 *
 * typefetch tags a schema failure with `code: "VALIDATION_ERROR"` but does not
 * carry the Zod issue path through, so the message alone reads as "expected
 * string, received undefined" with no field named. Splitting request from
 * response failures is what makes that message legible: on a response failure
 * the reader knows to compare the schema against what the route returned.
 */
function classify(error: unknown, phase: "request" | "response"): Row["kind"] {
  const code = (error as { code?: string })?.code;
  const status = (error as { status?: number })?.status;
  if (code === "VALIDATION_ERROR") {
    return phase === "request" ? "request-validation" : "response-validation";
  }
  if (typeof status === "number") return "http";
  return "network";
}

export function PlaygroundConsole() {
  const [rows, setRows] = useState<Row[]>([]);
  const [drift, setDrift] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * One client, rebuilt when the drift switch moves.
   *
   * Drift is a different `baseUrl` — a path prefix, because typefetch appends
   * the endpoint path to the base verbatim and a query string on the base would
   * land in the middle of the URL. The *contract* never changes, which is the
   * whole point being made. A client is cheap; rebuilding it is far clearer
   * than mutating config underneath requests already in flight.
   */
  const client = useMemo(() => {
    /*
     * The base has to be absolute. typefetch resolves the endpoint path with
     * `new URL(baseUrl + path)`, and that constructor rejects a relative string
     * outright — a relative base fails every call with "Invalid URL" before a
     * request is ever made.
     *
     * The origin is only read in the browser; the placeholder covers the
     * server render, where no call is ever issued.
     */
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const api = new ApiClient(
      { baseUrl: `${origin}${drift ? "/api/playground/_drift" : "/api/playground"}` },
      contracts,
    );
    api.init();
    return api;
  }, [drift]);

  // The devtools bridge, in about twenty lines. This is the real hook.
  useEffect(() => {
    return client.instrument({
      on(event: RequestEvent) {
        setRows((current) => {
          switch (event.type) {
            case "start":
              return [
                {
                  id: event.requestId,
                  endpoint: event.endpointId || "(direct)",
                  method: event.method,
                  status: "pending" as const,
                  payload: event.input,
                },
                ...current,
              ].slice(0, 25);

            case "success":
              return current.map((row) =>
                row.id === event.requestId
                  ? { ...row, status: "ok", durationMs: event.durationMs, payload: event.data }
                  : row,
              );

            case "error":
              return current.map((row) =>
                row.id === event.requestId
                  ? {
                      ...row,
                      status: "error",
                      durationMs: event.durationMs,
                      detail: event.error.message,
                      payload: event.error,
                      // A request that reached the network and came back wrong
                      // failed on the way in, not on the way out.
                      kind: classify(event.error, "response"),
                    }
                  : row,
              );

            default:
              return current;
          }
        });
      },
    });
  }, [client]);

  const call = useCallback(
    async (label: string, run: (client: Client) => Promise<unknown>) => {
      setBusy(true);
      try {
        await run(client);
      } catch (error) {
        /*
         * A request the contract rejected never became a request, so no
         * lifecycle event was emitted for it. Without this branch the single
         * most interesting failure on the page would leave no trace.
         *
         * Network and response-validation failures *do* emit an error event and
         * are already in `rows`; the id guard keeps them from appearing twice.
         */
        const message = error instanceof Error ? error.message : String(error);
        setRows((current) => {
          if (current.some((row) => row.status === "error" && row.detail === message)) {
            return current;
          }
          return [
            {
              id: `rejected-${Date.now()}`,
              endpoint: label,
              method: "—",
              status: "error" as const,
              durationMs: 0,
              detail: message,
              payload: error,
              kind: classify(error, "request"),
            },
            ...current,
          ].slice(0, 25);
        });
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const failures = rows.filter((row) => row.status === "error").length;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.15fr]">
      <Panel className="min-w-0">
        <h2 className="text-lg font-bold text-fg">Call it</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Every button below runs a real request through a real client. Hover one to see the exact
          expression it evaluates.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {CALLS.map((entry) => (
            <Button
              key={entry.key}
              variant="outline"
              size="sm"
              disabled={busy}
              title={entry.signature}
              onClick={() => void call(entry.label, entry.run)}
              className="font-mono text-xs"
            >
              {entry.label}
            </Button>
          ))}
        </div>

        <div className="mt-6 border-t border-hair pt-5">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
            Make it fail
          </h3>

          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={drift}
              onChange={(event) => setDrift(event.target.checked)}
              className="mt-1 size-4 accent-amber"
            />
            <span>
              <span className="text-sm font-semibold text-fg">Drift the server</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                The route starts answering with <code className="text-amber">fullName</code> where
                the contract says <code className="text-cyan">name</code>. Run any call above and
                watch response validation catch it — the client code does not change.
              </span>
            </span>
          </label>

          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void call(INVALID.label, INVALID.run)}
            title={INVALID.signature}
            className="mt-4 w-full font-mono text-xs"
          >
            Send input the contract forbids
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            A one-character name and a malformed email. This never reaches the network — request
            validation rejects it here in the browser.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-hair pt-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRows([]);
              setSelectedId(null);
            }}
            className="font-mono text-xs"
          >
            clear timeline
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetch("/api/playground/users", { method: "DELETE" })}
            className="font-mono text-xs"
          >
            reset fixture
          </Button>
        </div>
      </Panel>

      <Panel className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-fg">Timeline</h2>
          <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-dim">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-wire-http"
              style={{ animation: "wire-pulse var(--motion-wire) ease-in-out infinite" }}
            />
            {rows.length} REQUESTS
            {failures > 0 && <span className="text-red">· {failures} FAILED</span>}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Fed by <code className="text-cyan">client.instrument()</code> — the same hook the devtools
          package subscribes to.
        </p>

        <Tabs defaultValue="timeline" className="mt-5">
          <TabsList>
            <TabsTrigger value="timeline">Requests</TabsTrigger>
            <TabsTrigger value="inspect">Inspector</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="m-0 mt-3">
            <div className="code-surface overflow-hidden rounded-xl border border-hair-strong">
              {rows.length === 0 ? (
                <p className="px-4 py-10 text-center font-mono text-xs text-dim">
                  nothing yet — press a call
                </p>
              ) : (
                rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={cn(
                      "grid w-full grid-cols-[52px_1fr_62px_74px] items-center gap-3 border-b border-hair/60 px-3.5 py-2.5 text-left transition-colors duration-(--motion-tap) last:border-0 hover:bg-panel/60",
                      selectedId === row.id && "bg-panel/70",
                    )}
                  >
                    <span className="font-mono text-[10px] font-bold text-dim">{row.method}</span>
                    <span className="truncate font-mono text-[11.5px] text-fg">{row.endpoint}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {row.durationMs != null ? `${Math.round(row.durationMs)}ms` : "—"}
                    </span>
                    <span
                      className="justify-self-start rounded border px-1.5 py-0.5 font-mono text-[10px]"
                      style={{
                        color: TONE[row.status],
                        borderColor: `color-mix(in oklab, ${TONE[row.status]} 40%, transparent)`,
                      }}
                    >
                      {row.status}
                    </span>
                  </button>
                ))
              )}
            </div>

            {failures > 0 && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <span aria-hidden className="mt-1 size-1.5 flex-none rounded-full bg-red" />
                A red row here is the product working. Open it in the inspector to read exactly what
                the schema rejected.
              </p>
            )}
          </TabsContent>

          <TabsContent value="inspect" className="m-0 mt-3">
            {selected ? (
              <div className="code-surface overflow-hidden rounded-xl border border-hair-strong">
                <div className="flex flex-wrap items-center gap-2 border-b border-hair px-3.5 py-2.5">
                  <Chip tone={TONE[selected.status]}>{selected.status}</Chip>
                  <span className="font-mono text-[11px] text-fg">{selected.endpoint}</span>
                  {selected.durationMs != null && (
                    <span className="ml-auto font-mono text-[10px] text-dim">
                      {Math.round(selected.durationMs)}ms
                    </span>
                  )}
                </div>
                {selected.kind && (
                  <p className="border-b border-hair px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-amber">
                    {KIND_LABEL[selected.kind]}
                  </p>
                )}
                {selected.detail && (
                  <p className="border-b border-hair px-3.5 py-3 font-mono text-[11.5px] leading-relaxed text-red">
                    {selected.detail}
                  </p>
                )}
                {selected.kind === "response-validation" && (
                  <p className="border-b border-hair px-3.5 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
                    The route returned <code className="text-amber">fullName</code>; the contract
                    declares <code className="text-cyan">name</code>. typefetch reports the
                    mismatch but does not carry the field path through on a response failure, so
                    the message names the type rather than the key.
                  </p>
                )}
                <pre className="max-h-80 overflow-auto p-3.5 font-mono text-[11.5px] leading-relaxed">
                  <JsonView text={pretty(selected.payload)} />
                </pre>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-hair-strong px-4 py-10 text-center font-mono text-xs text-dim">
                select a row in the timeline
              </p>
            )}
          </TabsContent>
        </Tabs>
      </Panel>
    </div>
  );
}
