import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import upsRouter from "./routes/ups.js";
import invoicesRouter from "./routes/invoices.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// API
app.use("/api/ups", upsRouter);
app.use("/api/invoices", invoicesRouter);

// En production : servir le build du frontend + fallback SPA
if (process.env.NODE_ENV === "production") {
  app.use(express.static(DIST_DIR));
  // Toute route non-/api retourne index.html (routing React côté client)
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
