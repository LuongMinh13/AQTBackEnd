/**
 * Service d'historique des demandes Palette.
 *
 * Deux backends interchangeables (var. d'env. STORAGE) :
 *
 *   STORAGE=json       (par défaut)  → backend/data/palettes-history.json
 *   STORAGE=firestore                → collection `palettes_history`
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
 * Rotation : on conserve au plus MAX_ENTRIES entrées.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { getFirestore, isFirestoreStorage } from "./firestore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(BACKEND_ROOT, "data");
const HISTORY_FILE = path.join(DATA_DIR, "palettes-history.json");

const COLLECTION = "palettes_history";
const MAX_ENTRIES = 500;

// ============================================================
//  Backend JSON
// ============================================================
async function ensureFile() {
  try {
    await access(HISTORY_FILE);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(HISTORY_FILE, "[]", "utf-8");
  }
}

async function loadAllJson() {
  await ensureFile();
  const raw = await readFile(HISTORY_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAllJson(entries) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

// ============================================================
//  Backend Firestore
// ============================================================
async function appendFirestore(entry) {
  const db = await getFirestore();
  // L'id sert de clé du document : on évite de le répéter dans le payload
  // pour rester cohérent avec ce que produit le script de migration.
  // eslint-disable-next-line no-unused-vars
  const { id, ...data } = entry;
  await db.collection(COLLECTION).doc(entry.id).set(data);

  // Rotation best-effort : supprime les entrées au-delà de MAX_ENTRIES.
  // Une erreur ici ne doit pas remonter (l'écriture principale est OK).
  try {
    const overflow = await db
      .collection(COLLECTION)
      .orderBy("createdAt", "desc")
      .offset(MAX_ENTRIES)
      .get();
    if (!overflow.empty) {
      const batch = db.batch();
      overflow.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn(
      "Rotation historique Firestore échouée (non bloquant) :",
      e?.message || e,
    );
  }
}

async function listFirestore({ summary }) {
  const db = await getFirestore();
  const snap = await db
    .collection(COLLECTION)
    .orderBy("createdAt", "desc")
    .get();
  if (summary) {
    return snap.docs.map((d) => {
      // eslint-disable-next-line no-unused-vars
      const { payload, ...rest } = d.data();
      return { id: d.id, ...rest };
    });
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getFirestoreById(id) {
  const db = await getFirestore();
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function deleteFirestore(id) {
  const db = await getFirestore();
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.delete();
  return true;
}

// ============================================================
//  Construction d'une entrée (logique pure, indépendante du backend)
// ============================================================
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

// ============================================================
//  API publique — dispatch sur le backend
// ============================================================

/**
 * Ajoute une entrée à l'historique. Best-effort : retourne null si
 * l'écriture échoue, sans propager l'erreur (la génération reste prioritaire).
 */
export async function appendHistory(entry) {
  try {
    if (isFirestoreStorage()) {
      await appendFirestore(entry);
      return entry;
    }
    const entries = await loadAllJson();
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    await saveAllJson(entries);
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
  if (isFirestoreStorage()) return listFirestore({ summary });
  const entries = await loadAllJson();
  if (!summary) return entries;
  // eslint-disable-next-line no-unused-vars
  return entries.map(({ payload, ...rest }) => rest);
}

export async function getEntryById(id) {
  if (isFirestoreStorage()) return getFirestoreById(id);
  const entries = await loadAllJson();
  return entries.find((e) => e.id === id) || null;
}

export async function deleteEntry(id) {
  if (isFirestoreStorage()) return deleteFirestore(id);
  const entries = await loadAllJson();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  await saveAllJson(entries);
  return true;
}
