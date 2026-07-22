import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

import { chatContracts, type Message } from "../shared/contracts.js";
import { handle, push } from "./contract-bridge.js";

const PORT = Number(process.env.PORT ?? 3102);
const HISTORY_LIMIT = 50;

/** roomId → the last N messages. In-memory on purpose; this is a demo. */
const history = new Map<string, Message[]>();
/** roomId → the users currently in it. */
const members = new Map<string, Set<string>>();

function roomMembers(roomId: string): string[] {
  return [...(members.get(roomId) ?? [])].sort();
}

const http = createServer();
const io = new Server(http, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  /** Set on join. A socket belongs to at most one room in this demo. */
  let user: string | null = null;
  let room: string | null = null;

  const leaveCurrentRoom = () => {
    if (!room || !user) return;
    const set = members.get(room);
    set?.delete(user);
    if (set && set.size === 0) members.delete(room);

    void socket.leave(room);
    push(io.to(room), "room.presence", chatContracts.room.presence, {
      roomId: room,
      members: roomMembers(room),
    });
    console.log(`[server] ${user} left #${room}`);
    room = null;
  };

  handle(socket, "room.join", chatContracts.room.join, (input) => {
    leaveCurrentRoom();

    user = input.user;
    room = input.roomId;
    void socket.join(room);

    const set = members.get(room) ?? new Set<string>();
    set.add(user);
    members.set(room, set);

    push(io.to(room), "room.presence", chatContracts.room.presence, {
      roomId: room,
      members: roomMembers(room),
    });
    console.log(`[server] ${user} joined #${room}`);

    // The return value is validated against the `ack` schema before it is sent.
    return {
      roomId: room,
      history: history.get(room) ?? [],
      members: roomMembers(room),
    };
  });

  handle(socket, "room.leave", chatContracts.room.leave, () => {
    leaveCurrentRoom();
  });

  handle(socket, "chat.send", chatContracts.chat.send, (input) => {
    if (!user) throw new Error("send before join");

    const message: Message = {
      id: randomUUID(),
      roomId: input.roomId,
      user,
      text: input.text,
      sentAt: Date.now(),
    };

    const log = history.get(input.roomId) ?? [];
    log.push(message);
    history.set(input.roomId, log.slice(-HISTORY_LIMIT));

    // Broadcast to everyone including the sender, so one code path renders all
    // messages and the sender's own message is server-stamped like the rest.
    push(io.to(input.roomId), "chat.message", chatContracts.chat.message, message);

    return { id: message.id, sentAt: message.sentAt };
  });

  handle(socket, "chat.setTyping", chatContracts.chat.setTyping, (input) => {
    if (!user) return;
    // `socket.to` excludes the sender — you don't need to be told you're typing.
    push(socket.to(input.roomId), "chat.typing", chatContracts.chat.typing, {
      roomId: input.roomId,
      user,
      isTyping: input.isTyping,
    });
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom();
  });
});

// A port left occupied by an earlier run is the most likely way this fails.
// Say so, instead of dumping an unhandled 'error' event and a stack trace.
http.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `\n[server] Port ${PORT} is already in use — most likely an earlier run of this server.\n` +
        `         Stop it, or start on another port:  PORT=3103 pnpm dev:server\n` +
        `         Find the process:  npx kill-port ${PORT}\n`,
    );
    process.exit(1);
  }
  throw error;
});

http.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] contract events:`);
  for (const [module, events] of Object.entries(chatContracts)) {
    for (const [name, def] of Object.entries(events)) {
      const arrow = def.direction === "client->server" ? "→" : "←";
      console.log(`  ${arrow} ${module}.${name}`);
    }
  }
});

// tsx watch restarts on change; releasing the port on the way out keeps a
// rapid save from racing the next boot into EADDRINUSE.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    io.close();
    http.close(() => process.exit(0));
  });
}
