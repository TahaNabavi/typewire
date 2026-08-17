---
"@tahanabavi/typewire-cli": minor
---

`typefetch.transports` — adapters for the commands that never build a client.

`method` and `path` exist only on http endpoints, so anything that prints a
route has to ask the adapter through `describe()` — and `list` has no client to
ask. Every gRPC and GraphQL row printed as `?`.

```ts
typefetch: {
  contracts,
  transports: [graphqlTransport(), grpcTransport()],
}
```

`list` now resolves them without constructing a client, so it still runs against
an API that is not up. The listing also gained `Transport` and `Operation`
columns, and when a transport *cannot* be described it now says so and names it
— a silent `?` reads as a complete listing when it is not.

Passing the factory instead of its result (`[grpcTransport]` rather than
`[grpcTransport()]`) is caught at load time with a message saying to call it.
