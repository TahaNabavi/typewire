import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { handleMedia } from "./shared/media-server.js";

/**
 * Serves `/media` from the dev server itself.
 *
 * The rest of the example answers through `resolveOverride` and needs no server
 * at all. Upload progress cannot work that way — an override resolves before the
 * transport runs, and there are no bytes to measure — so these two endpoints are
 * real. Mounting them here keeps that to four lines instead of a second process.
 */
function mediaPlugin(): Plugin {
  return {
    name: "typewire-example-media",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleMedia(req, res).then((handled) => {
          if (!handled) next();
        });
      });
    },
  };
}

export default defineConfig({
  root: "client",
  plugins: [react(), mediaPlugin()],
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
