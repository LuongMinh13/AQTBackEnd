import axios from "axios";

// URL de base du backend (overridable via .env)
// Par défaut : http://localhost:3001 (cf. backend/server.js)
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  // 5 min : le traitement des grosses factures PDF peut prendre du temps
  timeout: 5 * 60_000,
});
