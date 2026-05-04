/**
 * Service d'historique des demandes Palette.
 *
 * Stockage : un unique fichier JSON `backend/data/palettes-history.json`
 * contenant un tableau d'entrées triées par date (les plus récentes en tête).
 *
 * Schéma d'une entrée :
 *   {
 *     id: string (uuid),
 *     createdAt: ISO 8601 string,
 *     createdBy: string | null,        // accueillera l'utilisateur quand l'auth sera en place
 *     enlevement: { societe, cp, ville },
 *     livraison:  { societe, cp, ville },
 *     paletteCount: number,
 *     poidsTotal: number,
 *     downloadName: string,
 *     payload: { ... payload complet envoyé au script Python ... }
 *   }
 *
 * On garde au plus MAX_ENTRIES entrées (rotation des plus anciennes).
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(BACKEND_ROOT, "data");
const HISTORY_FILE = path.join(DATA_DIR, "palettes-history.json");

const MAX_ENTRIES = 500;

async function ensureFile() {
  try {
    await access(HISTORY_FILE);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(HISTORY_FILE, "[]", "utf-8");
  }
}

async function loadAll() {
  await ensureFile();
  const raw = await readFile(HISTORY_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAll(entries) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

/**
 * Construit une entrée d'historique à partir des données de génération.
 * Le payload est conservé tel-quel (pour permettre la regénération à l'identique).
 */
export function buildHistoryEntry({
  payload,
  downloadName,
  createdBy = null,
}) {
  const enlevement = payload?.enlevement || {};
  const livraison = payload?.livraison || {};
  const palettes = Array.isArray(payload?.palettes) ? payload.palettes : [];
  const poidsTotal = palettes.reduce((acc, p) => {
    const n = Number(p?.poids);
    return Number.isFinite(n) ? acc + n : acc;
  }, 0);

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null,
    enlevement: {
      societe: enlevement.societe || "",
      cp: enlevement.cp || "",
      ville: enlevement.ville || "",
    },
    livraison: {
      societe: livraison.societe || "",
      cp: livraison.cp || "",
      ville: livraison.ville || "",
    },
    paletteCount: palettes.length,
    poidsTotal,
    downloadName: downloadName || "",
    payload,
  };
}

/**
 * Ajoute une entrée à l'historique. Best-effort : retourne null si
 * l'écriture échoue, sans propager l'erreur (la génération reste prioritaire).
 * En cas de succès, retourne l'entrée enregistrée (avec son id).
 */
export async function appendHistory(entry) {
  try {
    const entries = await loadAll();
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    await saveAll(entries);
    return entry;
  } catch (e) {
    console.warn("appendHistory échoué (non bloquant):", e?.message || e);
    return null;
  }
}

/**
 * Liste toutes les entrées. La version "summary" omet le payload pour réduire
 * la taille de la réponse (utile pour la liste affichée dans l'UI).
 */
export async function listEntries({ summary = true } = {}) {
  const entries = await loadAll();
  if (!summary) return entries;
  return entries.map(({ payload, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

export async function getEntryById(id) {
  const entries = await loadAll();
  return entries.find((e) => e.id === id) || null;
}

export async function deleteEntry(id) {
  const entries = await loadAll();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  await saveAll(entries);
  return true;
}
