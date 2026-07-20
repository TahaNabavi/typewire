import { SocketConfig } from "@/types";

export const getSocketConfig = (): SocketConfig => {
  const isDevelopment = process.env.NODE_ENV === "development";

  return {
    url:
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (isDevelopment ? "http://localhost:3001" : "/"),
    autoConnect: process.env.NEXT_PUBLIC_SOCKET_AUTO_CONNECT !== "false",
    reconnection: process.env.NEXT_PUBLIC_SOCKET_RECONNECTION !== "false",
    reconnectionAttempts: parseInt(
      process.env.NEXT_PUBLIC_SOCKET_RECONNECTION_ATTEMPTS || "5",
      10
    ),
    reconnectionDelay: parseInt(
      process.env.NEXT_PUBLIC_SOCKET_RECONNECTION_DELAY || "1000",
      10
    ),
    auth: process.env.NEXT_PUBLIC_SOCKET_AUTH_TOKEN
      ? {
          token: process.env.NEXT_PUBLIC_SOCKET_AUTH_TOKEN,
        }
      : undefined,
    query: process.env.NEXT_PUBLIC_SOCKET_QUERY_PARAMS
      ? JSON.parse(process.env.NEXT_PUBLIC_SOCKET_QUERY_PARAMS)
      : undefined,
  };
};
