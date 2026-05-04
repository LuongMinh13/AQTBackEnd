/**
 * Repository des clients du carnet.
 *
 * Deux backends interchangeables, sélectionnés par la variable
 * d'environnement `STORAGE` :
 *
 *   STORAGE=json       (par défaut)  → backend/data/clients.json
 *   STORAGE=firestore                → collection `clients` dans Firestore
 *
 * On expose volontairement la même interface qu'auparavant :
 *   - loadClients()           → tableau de clients
 *   - saveClients(clients)    → réécrit l'ensemble du carnet
 *
 * Le routeur (routes/palettes.js) continue donc à manipuler le tableau
 * complet (push/findIndex/...) sans connaître le backend sous-jacent.
 *
 * En mode Firestore, `saveClients` synchronise la collection avec le
 * tableau fourni : suppression des documents retirés, set des autres.
 * Les commits Firestore sont limités à 500 ops par batch.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getFirestore, isFirestoreStorage } from "./firestore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(BACKEND_ROOT, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

const COLLECTION = "clients";
const BATCH_LIMIT = 450; // marge de sécurité sous la limite Firestore (500).

// ============================================================
//  Backend JSON (fichier sur disque)
// ============================================================
async function ensureClientsFile() {
  try {
    await access(CLIENTS_FILE);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CLIENTS_FILE, "[]", "utf-8");
  }
}

async function loadClientsFromFile() {
  await ensureClientsFile();
  const raw = await readFile(CLIENTS_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveClientsToFile(clients) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), "utf-8");
}

// ============================================================
//  Backend Firestore
// ============================================================
async function loadClientsFromFirestore() {
  const db = await getFirestore();
  const snap = await db.collection(COLLECTION).get();
  const clients = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Tri stable par createdAt décroissant pour mimer l'ordre d'insertion JSON
  // (les plus récents en tête).
  clients.sort((a, b) => {
    const ta = a.createdAt || "";
    const tb = b.createdAt || "";
    if (ta === tb) return 0;
    return ta < tb ? 1 : -1;
  });
  return clients;
}

async function saveClientsToFirestore(clients) {
  const db = await getFirestore();
  const col = db.collection(COLLECTION);

  // 1. Récupère les IDs existants pour calculer les suppressions.
  const snap = await col.select().get();
  const existingIds = new Set(snap.docs.map((d) => d.id));
  const newIds = new Set(
    clients
      .map((c) => c?.id)
      .filter((id) => typeof id === "string" && id.length > 0),
  );

  // 2. Construit la liste d'opérations : delete les retirés, set les autres.
  const ops = [];
  for (const id of existingIds) {
    if (!newIds.has(id)) {
      ops.push({ type: "delete", ref: col.doc(id) });
    }
  }
  for (const client of clients) {
    if (!client?.id) continue;
    // L'id est déjà la clé Firestore — on le retire du document écrit pour
    // éviter une duplication inutile dans le payload.
    // eslint-disable-next-line no-unused-vars
    const { id, ...data } = client;
    ops.push({ type: "set", ref: col.doc(client.id), data });
  }

  // 3. Exécute par paquets pour respecter la limite Firestore (500 ops/batch).
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.type === "delete") batch.delete(op.ref);
      else batch.set(op.ref, op.data);
    }
    await batch.commit();
  }
}

// ============================================================
//  API exportée — sélectionne le backend selon STORAGE
// ============================================================
export async function loadClients() {
  if (isFirestoreStorage()) return loadClientsFromFirestore();
  return loadClientsFromFile();
}

export async function saveClients(clients) {
  if (isFirestoreStorage()) return saveClientsToFirestore(clients);
  return saveClientsToFile(clients);
}
