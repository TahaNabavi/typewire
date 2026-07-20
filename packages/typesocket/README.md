# @tahanabavi/typesocket

![npm version](https://img.shields.io/badge/socket.io-informational?style=flat&logo=npm&logoColor=white)
![npm version](https://img.shields.io/badge/-Zod-3E67B1?style=flat&logo=zod&logoColor=white)

A **Type-safe Socket.IO wrapper** for JavaScript/TypeScript. It provides Zod-based event validation, middleware support, queued emits, environment-aware configuration, and React-friendly hooks — all designed to make real-time development safer and easier.

---

## Table of contents

- [Why use this](#why-use-this)
- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Configuration / `.env`](#configuration--env)
- [Full example](#full-example)
- [React hooks (quick preview)](#react-hooks-quick-preview)
- [API reference](#api-reference)
- [Testing / Development](#testing--development)
- [Contributing](#contributing)
- [Changelog](#changelog)
- [License](#license)
- [Maintainers & Support](#maintainers--support)

---

## Why use this

If you build apps that rely on real-time communication (chat, collaborative tools, live dashboards, games), you want strong typing and runtime validation for socket events so mistakes are caught early. This package combines **compile-time types** with **runtime validation (Zod)**, helping prevent mismatched events, accidental payload changes, and hard-to-debug runtime errors.

---

## Features

- ✅ Type-safe emits & listeners using Zod
- ✅ Runtime validation for all incoming/outgoing payloads
- ✅ `emit`, `emitAsync`, `emitQueued` (queue emits while disconnected)
- ✅ `on`, `once`, `off`, `waitFor` helpers
- ✅ Middleware hook for logging/auth/metrics
- ✅ Automatic reconnection with backoff
- ✅ Environment-aware configuration via `getSocketConfig()`
- ✅ Debug mode for verbose logs
- ✅ React hooks compatibility

---

## Install

```bash
npm install @tahanabavi/typesocket zod socket.io-client
# or
yarn add @tahanabavi/typesocket zod socket.io-client
```

> `zod` and `socket.io-client` are peer dependencies in many setups — ensure they are installed in your project.

---

## Quick start

```ts
import { z } from "zod";
import { SocketService } from "@tahanabavi/typesocket";

const onEvents = {
  message: { response: z.object({ text: z.string(), user: z.string() }) },
};

const emitEvents = {
  sendMessage: {
    request: z.object({ text: z.string() }),
    callback: z.object({ success: z.boolean() }),
  },
};

const socket = new SocketService(
  {
    // custom config
  },
  onEvents,
  emitEvents,
  {
    onConnect: () => console.log("connected"),
    onDisconnect: (r) => console.log("disconnect", r),
    onConnectError: (e) => console.error(e),
  }
).init();

socket.on("message", (msg) => console.log(msg.user, msg.text));
socket.emit("sendMessage", { text: "hello" });
```

---

## Configuration / `.env`

The package includes a helper `getSocketConfig()` to read environment variables. Example `.env` entries:

```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
NEXT_PUBLIC_SOCKET_AUTO_CONNECT=true
NEXT_PUBLIC_SOCKET_RECONNECTION=true
NEXT_PUBLIC_SOCKET_RECONNECTION_ATTEMPTS=5
NEXT_PUBLIC_SOCKET_RECONNECTION_DELAY=1000
NEXT_PUBLIC_SOCKET_AUTH_TOKEN=your-token-here
NEXT_PUBLIC_SOCKET_QUERY_PARAMS={"role":"user"}
```

See `utils/socket-config.ts` for exact behavior (it falls back to sensible defaults for development vs. production).

---

## Full example

A more complete example that demonstrates common flows:

```ts
import { SocketService } from "@tahanabavi/typesocket";
import { z } from "zod";

export const onEvents = {
  message: { response: z.object({ text: z.string(), user: z.string() }) },
  userJoined: { response: z.object({ username: z.string() }) },
};

export const emitEvents = {
  sendMessage: {
    request: z.object({ text: z.string() }),
    callback: z.object({ success: z.boolean() }),
  },
};

const socket = new SocketService({}, onEvents, emitEvents, {
  onConnect: () => console.log("connected"),
  onDisconnect: (r) => console.log("disconnect", r),
  onConnectError: (e) => console.error(e),
}).init();

socket.use((event, data) => {
  // global logging / telemetry
  console.debug("socket:event", event, data);
});

socket.on("message", (m) => console.log("msg", m));

(async () => {
  const ack = await socket.emitAsync("sendMessage", { text: "hi" });
  console.log("ack", ack);
})();
```

---

## API reference

| Method                             | Description                                                   |
| ---------------------------------- | ------------------------------------------------------------- |
| `init()`                           | Initializes the socket connection with automatic config.      |
| `emit(event, data, callback?)`     | Emits an event with data. Validates against schema.           |
| `emitAsync(event, data)`           | Emits an event and returns a Promise resolving with callback. |
| `emitQueued(event, data)`          | Queues events if socket is not connected.                     |
| `on(event, handler)`               | Registers a listener for an event with validation.            |
| `once(event, handler)`             | Registers a listener that fires only once.                    |
| `off(event, handler)`              | Removes a listener.                                           |
| `waitFor(event, timeout?)`         | Waits for an event with optional timeout.                     |
| `disconnect()`                     | Disconnects the socket.                                       |
| `reconnect()`                      | Reconnects immediately.                                       |
| `reconnectWithBackoff()`           | Reconnects with exponential backoff.                          |
| `isConnected()`                    | Returns `true` if socket is connected.                        |
| `getSocketId()`                    | Returns the socket ID.                                        |
| `use(middleware)`                  | Adds middleware that runs before listeners.                   |
| `enableDebug()` / `disableDebug()` | Enable or disable debug logs.                                 |

---

## Testing & development

- Run unit tests (Jest):

```bash
npm test
```

- Build TypeScript:

```bash
npm run build
```

- Local develop/test with another app using `npm link` or `yalc`.

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Run tests and linters locally
4. Open a PR with a clear description and changelog entry (if applicable)

Please include tests for new features and follow the established code style. Add a short description for the change in the PR and link any relevant issues.

---

## Maintainers & Support

Maintained by `@tahanabavi`.

For issues, please open a GitHub issue in this repository. For questions or suggestions, create an issue or reach out on GitHub Discussions.

---

_Thank you for using `@tahanabavi/typesocket` — contributions and feedback are highly appreciated!_
