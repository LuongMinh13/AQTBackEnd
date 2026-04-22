import axios from "axios";

// URL de base du backend (overridable via .env / VITE_API_BASE_URL)
// - En dev  : http://localhost:3001 (cf. backend/server.js)
// - En prod : "" (same-origin, le backend sert aussi le frontend)
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:3001");

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  // 5 min : le traitement des grosses factures PDF peut prendre du temps
  timeout: 5 * 60_000,
});
