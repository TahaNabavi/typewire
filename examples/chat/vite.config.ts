import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    port: 5273,
    // Pinned to IPv4 loopback on purpose. Vite's default host is "localhost",
    // which Node resolves through the OS — on Windows that can bind ::1 only,
    // while the browser tries 127.0.0.1 first and gets ECONNREFUSED from a dev
    // server that is demonstrably running.
    host: "127.0.0.1",
    strictPort: true,
  },
});
