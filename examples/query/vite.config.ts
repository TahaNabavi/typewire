import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    // One port above the chat example's 5273, so both can run at once.
    port: 5274,
    // Pinned to IPv4 loopback on purpose. Vite's default host is "localhost",
    // which Node resolves through the OS — on Windows that can bind ::1 only,
    // while the browser tries 127.0.0.1 first and gets ECONNREFUSED from a dev
    // server that is demonstrably running.
    host: "127.0.0.1",
    // The README names this port; without this Vite silently moves to the next
    // free one and the documented URL refuses the connection.
    strictPort: true,
  },
});
