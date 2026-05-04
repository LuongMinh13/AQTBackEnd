/**
 * Script de migration ponctuelle :
 * Lit les fichiers JSON locaux (clients.json + palettes-history.json) et
 * recopie leur contenu dans la base Firestore configurée.
 *
 * Authentification :
 *   Application Default Credentials (ADC). Avant de lancer le script :
 *     gcloud auth application-default login
 *
 * Variables d'environnement reconnues :
 *   GOOGLE_CLOUD_PROJECT    (par défaut : "aqtbackend")
 *   FIRESTORE_DATABASE_ID   (par défaut : "aqtconnect")
 *
 * Usage :
 *   cd backend
 *   node scripts/migrate-to-firestore.js
 *
 * Le script est idempotent : ré-exécuter écrase les documents existants
 * avec le contenu local (pas de duplication).
 */
import { Firestore } from "@google-cloud/firestore";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(BACKEND_ROOT, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const HISTORY_FILE = path.join(DATA_DIR, "palettes-history.json");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "aqtbackend";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "aqtconnect";

const BATCH_LIMIT = 450; // marge sous la limite Firestore (500 ops / batch).

async function loadJson(file) {
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e?.code === "ENOENT") {
      console.warn(`  (fichier introuvable, on skip : ${file})`);
      return [];
    }
    throw e;
  }
}

async function migrateCollection(db, collectionName, items, label) {
  if (!items.length) {
    console.log(`→ ${label} : rien à migrer`);
    return;
  }
  console.log(`→ ${label} : migration de ${items.length} documents…`);
  const col = db.collection(collectionName);
  let written = 0;

  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const slice = items.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const item of slice) {
      if (!item?.id) {
        console.warn("    document sans id, ignoré :", item);
        continue;
      }
      // L'id est la clé du document — on ne le réécrit pas dans le payload.
      // eslint-disable-next-line no-unused-vars
      const { id, ...data } = item;
      batch.set(col.doc(item.id), data);
    }
    await batch.commit();
    written += slice.length;
    console.log(`    ${written}/${items.length} écrits`);
  }
}

async function main() {
  console.log(`Migration vers Firestore`);
  console.log(`  projet  : ${PROJECT_ID}`);
  console.log(`  base    : ${DATABASE_ID}`);

  const db = new Firestore({
    projectId: PROJECT_ID,
    databaseId: DATABASE_ID,
  });

  const [clients, history] = await Promise.all([
    loadJson(CLIENTS_FILE),
    loadJson(HISTORY_FILE),
  ]);

  await migrateCollection(db, "clients", clients, "Clients");
  await migrateCollection(db, "palettes_history", history, "Historique");

  console.log("✅ Migration terminée");
}

main().catch((e) => {
  console.error("❌ Erreur migration :", e?.message || e);
  if (e?.code === 16 || /UNAUTHENTICATED/i.test(String(e?.message || ""))) {
    console.error(
      "\nAuthentification requise. Lance d'abord :\n  gcloud auth application-default login\n",
    );
  }
  process.exit(1);
});
