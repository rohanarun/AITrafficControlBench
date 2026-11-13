import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/airspace/",
  server: { proxy: { "/airspace/api": "http://127.0.0.1:8791" } },
});
