import { Router } from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadClients, saveClients } from "../services/clientsRepo.js";
import {
  appendHistory,
  buildHistoryEntry,
  deleteEntry as deleteHistoryEntry,
  getEntryById as getHistoryEntry,
  listEntries as listHistoryEntries,
} from "../services/palettesHistory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(BACKEND_ROOT, "data");
const OUTPUT_DIR = path.join(DATA_DIR, "output");
const TEMPLATES_DIR = path.join(DATA_DIR, "templates");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const SCRIPTS_DIR = path.join(BACKEND_ROOT, "scripts");

const RATES_FILE = path.join(DATA_DIR, "dhl_palette_rates.json");
const TEMPLATE_PATH = path.join(TEMPLATES_DIR, "dhl_freight_palette_template.xlsx");
const FILL_SCRIPT = path.join(SCRIPTS_DIR, "fill_dhl_palette.py");

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const MAX_PALETTES = 5;

const router = Router();

// ============================================================
//  Validation
// ============================================================
function cleanString(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function sanitizeContact(c = {}) {
  return {
    nom: cleanString(c.nom),
    prenom: cleanString(c.prenom),
    email: cleanString(c.email),
    tel: cleanString(c.tel),
  };
}

function sanitizeClient(body = {}) {
  // contacts[] : carnet de contacts attaché au client
  const rawContacts = Array.isArray(body.contacts) ? body.contacts : [];
  const contacts = rawContacts
    .map(sanitizeContact)
    .filter((c) => c.nom || c.prenom || c.email || c.tel);

  return {
    societe: cleanString(body.societe),
    adresse1: cleanString(body.adresse1),
    adresse2: cleanString(body.adresse2),
    cp: cleanString(body.cp),
    ville: cleanString(body.ville),
    pays: cleanString(body.pays) || "France",
    // Contact "principal" du client (rétro-compat) — synchronisé avec contacts[0]
    nom: cleanString(body.nom),
    prenom: cleanString(body.prenom),
    email: cleanString(body.email),
    tel: cleanString(body.tel),
    contacts,
  };
}

function validateClient(c) {
  if (!c.societe) return "Le champ 'société' est obligatoire.";
  if (!c.adresse1) return "Le champ 'adresse 1' est obligatoire.";
  if (!c.cp) return "Le code postal est obligatoire.";
  if (!c.ville) return "La ville est obligatoire.";
  return null;
}

/**
 * Compose l'adresse multi-ligne attendue par le template DHL :
 *   Adresse 1
 *   Adresse 2 (si renseignée)
 *   CP Ville
 *   Pays
 */
function composeAdresse(party) {
  const lines = [
    party.adresse1,
    party.adresse2,
    [party.cp, party.ville].filter(Boolean).join(" "),
    party.pays,
  ].filter((l) => l && l.trim());
  return lines.join("\n");
}

// ============================================================
//  Grille tarifaire DHL Freight (77 / 94)
// ============================================================
let ratesCache = null;
async function loadRates() {
  if (ratesCache) return ratesCache;
  const raw = await readFile(RATES_FILE, "utf-8");
  ratesCache = JSON.parse(raw);
  return ratesCache;
}

// GET /api/palettes/rates
// Renvoie l'intégralité de la grille (départ 77 + 94 + fuel surcharge %)
// pour que le frontend puisse faire les calculs tarif en local.
router.get("/rates", async (_req, res) => {
  try {
    const rates = await loadRates();
    res.json(rates);
  } catch (err) {
    res
      .status(500)
      .json({ error: err.message || "Erreur lecture grille tarifaire" });
  }
});

// ============================================================
//  CRUD Clients
// ============================================================

// GET /api/palettes/clients
router.get("/clients", async (_req, res) => {
  try {
    const clients = await loadClients();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur lecture clients" });
  }
});

// POST /api/palettes/clients
router.post("/clients", async (req, res) => {
  try {
    const data = sanitizeClient(req.body);
    const err = validateClient(data);
    if (err) return res.status(400).json({ error: err });

    const clients = await loadClients();
    const client = {
      id: randomUUID(),
      ...data,
      createdAt: new Date().toISOString(),
    };
    clients.push(client);
    await saveClients(clients);
    res.status(201).json(client);
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur création client" });
  }
});

// PUT /api/palettes/clients/:id
router.put("/clients/:id", async (req, res) => {
  try {
    const data = sanitizeClient(req.body);
    const err = validateClient(data);
    if (err) return res.status(400).json({ error: err });

    const clients = await loadClients();
    const idx = clients.findIndex((c) => c.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Client introuvable" });

    clients[idx] = {
      ...clients[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await saveClients(clients);
    res.json(clients[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur mise à jour client" });
  }
});

// DELETE /api/palettes/clients/:clientId/destinations/:destId
// Supprime une destination du carnet d'un client.
router.delete(
  "/clients/:clientId/destinations/:destId",
  async (req, res) => {
    try {
      const clients = await loadClients();
      const idx = clients.findIndex((c) => c.id === req.params.clientId);
      if (idx < 0) {
        return res.status(404).json({ error: "Client introuvable" });
      }
      const client = clients[idx];
      const list = Array.isArray(client.destinations) ? client.destinations : [];
      const newList = list.filter((d) => d.id !== req.params.destId);
      if (newList.length === list.length) {
        return res.status(404).json({ error: "Destination introuvable" });
      }
      clients[idx] = {
        ...client,
        destinations: newList,
        updatedAt: new Date().toISOString(),
      };
      await saveClients(clients);
      res.json({ ok: true, destinations: newList });
    } catch (e) {
      res
        .status(500)
        .json({ error: e.message || "Erreur suppression destination" });
    }
  },
);

// POST /api/palettes/clients/:clientId/destinations
// Ajoute manuellement une destination au carnet d'un client.
router.post(
  "/clients/:clientId/destinations",
  async (req, res) => {
    try {
      const clean = sanitizeDestination(req.body || {});
      if (!clean.societe || !clean.adresse1 || !clean.cp || !clean.ville) {
        return res
          .status(400)
          .json({ error: "Société, adresse 1, CP et ville sont obligatoires" });
      }
      const updated = await addDestinationToClient(req.params.clientId, clean);
      if (!updated) {
        return res.status(404).json({ error: "Client introuvable" });
      }
      // Renvoie le client à jour + la nouvelle destination (premier élément si
      // c'était une création, sinon celle qu'on a bumpée).
      const newKey = destinationKey(clean);
      const destination = (updated.destinations || []).find(
        (d) => destinationKey(d) === newKey,
      );
      res.status(201).json({
        ok: true,
        destination,
        destinations: updated.destinations || [],
      });
    } catch (e) {
      res
        .status(500)
        .json({ error: e.message || "Erreur ajout destination" });
    }
  },
);

// PUT /api/palettes/clients/:clientId/destinations/:destId
// Met à jour une destination du carnet d'un client (édition manuelle).
router.put(
  "/clients/:clientId/destinations/:destId",
  async (req, res) => {
    try {
      const clients = await loadClients();
      const idx = clients.findIndex((c) => c.id === req.params.clientId);
      if (idx < 0) {
        return res.status(404).json({ error: "Client introuvable" });
      }
      const client = clients[idx];
      const list = Array.isArray(client.destinations)
        ? [...client.destinations]
        : [];
      const destIdx = list.findIndex((d) => d.id === req.params.destId);
      if (destIdx < 0) {
        return res.status(404).json({ error: "Destination introuvable" });
      }
      const clean = sanitizeDestination(req.body || {});
      // Champs minimums obligatoires
      if (!clean.societe || !clean.adresse1 || !clean.cp || !clean.ville) {
        return res
          .status(400)
          .json({ error: "Société, adresse 1, CP et ville sont obligatoires" });
      }
      const prev = list[destIdx];
      list[destIdx] = {
        ...prev,
        ...clean,
        id: prev.id,
        createdAt: prev.createdAt,
        // useCount/lastUsedAt sont conservés
        updatedAt: new Date().toISOString(),
      };
      clients[idx] = {
        ...client,
        destinations: list,
        updatedAt: new Date().toISOString(),
      };
      await saveClients(clients);
      res.json({ ok: true, destination: list[destIdx], destinations: list });
    } catch (e) {
      res
        .status(500)
        .json({ error: e.message || "Erreur mise à jour destination" });
    }
  },
);

// DELETE /api/palettes/clients/:id
router.delete("/clients/:id", async (req, res) => {
  try {
    const clients = await loadClients();
    const idx = clients.findIndex((c) => c.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Client introuvable" });
    const [removed] = clients.splice(idx, 1);
    await saveClients(clients);
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur suppression client" });
  }
});

// ============================================================
//  Génération de la demande (Excel rempli)
// ============================================================

function todayFr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function sanitizeParty(src = {}) {
  return {
    societe: cleanString(src.societe),
    adresse1: cleanString(src.adresse1),
    adresse2: cleanString(src.adresse2),
    cp: cleanString(src.cp),
    ville: cleanString(src.ville),
    pays: cleanString(src.pays) || "France",
    // contact = "Nom Prenom" (chaîne d'affichage construite côté front)
    contact: cleanString(src.contact),
    email: cleanString(src.email),
    tel: cleanString(src.tel),
  };
}

function sanitizeTarif(src = {}) {
  // Convertit en number ; ignore null / undefined / NaN
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    coutHT: num(src.coutHT),
    fuel: num(src.fuel),
    coutTotal: num(src.coutTotal),
  };
}

// ============================================================
//  Assurance Ad Valorem (optionnelle)
// ============================================================
// Schéma : { enabled, valeur, taux, montant }
//   - enabled : booléen (case cochée côté UI)
//   - valeur  : valeur déclarée de la marchandise (€)
//   - taux    : taux d'assurance (%) — défaut UI à 2,00
//   - montant : montant calculé (recalculé ici à partir de valeur × taux/100
//               pour ne pas faire confiance aveuglément au front)
function sanitizeAssurance(src = {}) {
  const numNonNeg = (v) => {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const enabled = Boolean(src?.enabled);
  const valeur = numNonNeg(src?.valeur);
  const taux = numNonNeg(src?.taux);
  // Recalcul autoritaire côté serveur, arrondi 2 décimales.
  const montant = enabled
    ? Math.round((valeur * taux) / 100 * 100) / 100
    : 0;
  return { enabled, valeur, taux, montant };
}

// ============================================================
//  Destinations sauvegardées (carnet par client)
// ============================================================
function sanitizeDestination(d = {}) {
  return {
    societe: cleanString(d.societe),
    adresse1: cleanString(d.adresse1),
    adresse2: cleanString(d.adresse2),
    cp: cleanString(d.cp),
    ville: cleanString(d.ville),
    pays: cleanString(d.pays) || "France",
    contact: cleanString(d.contact),
    tel: cleanString(d.tel),
    email: cleanString(d.email),
  };
}

// Clé de déduplication : société + adresse1 + cp + ville + pays normalisés
function destinationKey(d) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return [
    norm(d.societe),
    norm(d.adresse1),
    norm(d.cp),
    norm(d.ville),
    norm(d.pays),
  ].join("|");
}

/**
 * Ajoute (ou met à jour) une destination dans le carnet d'un client.
 * - Dédup sur société + adresse1 + cp + ville + pays.
 * - Si déjà présent : on bump useCount + lastUsedAt (et on met à jour les
 *   champs accessoires comme contact/email/tel qui peuvent évoluer).
 * - Sinon : on push en tête de liste avec un id généré.
 *
 * Retourne le client mis à jour, ou null si rien à faire.
 */
async function addDestinationToClient(clientId, rawDestination) {
  if (!clientId) return null;
  const clean = sanitizeDestination(rawDestination);
  // On exige les champs minimums — sinon ça pollue le carnet
  if (!clean.societe || !clean.adresse1 || !clean.cp || !clean.ville) {
    return null;
  }

  const clients = await loadClients();
  const idx = clients.findIndex((c) => c.id === clientId);
  if (idx < 0) return null;

  const client = clients[idx];
  const list = Array.isArray(client.destinations) ? [...client.destinations] : [];
  const newKey = destinationKey(clean);
  const now = new Date().toISOString();

  const existingIdx = list.findIndex((d) => destinationKey(d) === newKey);
  if (existingIdx >= 0) {
    const prev = list[existingIdx];
    list[existingIdx] = {
      ...prev,
      ...clean,
      id: prev.id || randomUUID(),
      createdAt: prev.createdAt || now,
      lastUsedAt: now,
      useCount: (Number(prev.useCount) || 0) + 1,
    };
  } else {
    list.unshift({
      id: randomUUID(),
      ...clean,
      createdAt: now,
      lastUsedAt: now,
      useCount: 1,
    });
  }

  clients[idx] = {
    ...client,
    destinations: list,
    updatedAt: now,
  };
  await saveClients(clients);
  return clients[idx];
}

function sanitizeDemande(body = {}) {
  const palettes = Array.isArray(body.palettes) ? body.palettes : [];
  const today = todayFr();
  const enlevement = sanitizeParty(body?.enlevement);
  const livraison = sanitizeParty(body?.livraison);
  return {
    dates: {
      emission: cleanString(body?.dates?.emission) || today,
      cotation: cleanString(body?.dates?.cotation) || today,
    },
    enlevement: {
      ...enlevement,
      // adresse multi-ligne conservée pour rétro-compat (le script Python
      // privilégie les champs structurés adresse1/adresse2/cp/ville/pays).
      adresse: composeAdresse(enlevement),
    },
    livraison: {
      ...livraison,
      adresse: composeAdresse(livraison),
    },
    // Les codes postaux pour la relation M47 viennent des blocs adresse
    cp_enlevement: enlevement.cp,
    cp_livraison: livraison.cp,
    palettes: palettes.slice(0, MAX_PALETTES).map((p) => ({
      poids: p?.poids !== undefined && p?.poids !== "" ? Number(p.poids) : null,
      dimensions: cleanString(p?.dimensions),
      gerbable: Boolean(p?.gerbable),
    })),
    tarif: sanitizeTarif(body?.tarif),
    assurance: sanitizeAssurance(body?.assurance),
  };
}

function validateDemande(d) {
  if (!d.dates.emission) return "Date d'émission manquante.";
  if (!d.enlevement.societe) return "Société d'enlèvement manquante.";
  if (!d.enlevement.adresse1) return "Adresse 1 d'enlèvement manquante.";
  if (!d.enlevement.cp) return "Code postal d'enlèvement manquant.";
  if (!d.enlevement.ville) return "Ville d'enlèvement manquante.";
  if (!d.livraison.societe) return "Société de livraison manquante.";
  if (!d.livraison.adresse1) return "Adresse 1 de livraison manquante.";
  if (!d.livraison.cp) return "Code postal de livraison manquant.";
  if (!d.livraison.ville) return "Ville de livraison manquante.";
  if (!d.palettes.length) return "Au moins une palette est requise.";
  if (d.palettes.length > MAX_PALETTES) {
    return `Maximum ${MAX_PALETTES} palettes.`;
  }
  for (let i = 0; i < d.palettes.length; i++) {
    const p = d.palettes[i];
    if (!Number.isFinite(p.poids) || p.poids <= 0) {
      return `Palette ${i + 1} : poids invalide.`;
    }
    if (!p.dimensions) {
      return `Palette ${i + 1} : dimensions manquantes.`;
    }
  }
  return null;
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, args, { cwd: BACKEND_ROOT });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `Python a quitté avec le code ${code}`));
    });
  });
}

function safeFileStem(s) {
  return String(s || "demande")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "demande";
}

// Nettoie un champ : trim, retire les caractères interdits par les FS
// Windows/macOS, normalise les espaces.
function sanitizePart(s) {
  return String(s ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Construit "<société> <CP> <ville>" pour une partie (expéditeur ou destinataire).
function buildLocationStem(party) {
  const parts = [party?.societe, party?.cp, party?.ville]
    .map(sanitizePart)
    .filter(Boolean);
  return parts.join(" ");
}

// Nom de fichier vu par l'utilisateur lors du téléchargement.
// Format : "<expéditeur> / <destinataire>.xlsx"
// (chaque bloc = "<société> <CP> <ville>", casse d'origine conservée).
function buildDownloadName(enlevement, livraison) {
  const from = buildLocationStem(enlevement);
  const to = buildLocationStem(livraison);
  if (from && to) return `${from} / ${to}.xlsx`;
  return `${from || to || "demande-palette"}.xlsx`;
}

/**
 * Génère le xlsx rempli pour un payload sanitisé/validé.
 * Renvoie { tmpInput, outputPath } : c'est à l'appelant d'appeler
 * `streamGeneratedFile` pour les envoyer au client (et nettoyer ensuite).
 * En cas d'erreur, les fichiers temporaires sont supprimés.
 */
async function generateXlsxFile(data) {
  const tmpInput = path.join(TMP_DIR, `${randomUUID()}.json`);
  let outputPath = null;
  try {
    await mkdir(TMP_DIR, { recursive: true });
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(tmpInput, JSON.stringify(data), "utf-8");

    const stem = safeFileStem(
      `${data.enlevement.societe}-${data.livraison.societe}`,
    );
    const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    outputPath = path.join(
      OUTPUT_DIR,
      `demande-palette-${stem}-${dateTag}-${randomUUID().slice(0, 6)}.xlsx`,
    );

    await runPython([FILL_SCRIPT, TEMPLATE_PATH, tmpInput, outputPath]);
    return { tmpInput, outputPath };
  } catch (e) {
    try { await unlink(tmpInput); } catch { /* ignore */ }
    if (outputPath) {
      try { await unlink(outputPath); } catch { /* ignore */ }
    }
    throw e;
  }
}

/** Stream le xlsx au client puis nettoie tmpInput + outputPath. */
function streamGeneratedFile(res, tmpInput, outputPath, downloadName) {
  res.download(outputPath, downloadName, async (dlErr) => {
    try { await unlink(tmpInput); } catch { /* ignore */ }
    try { await unlink(outputPath); } catch { /* ignore */ }
    if (dlErr) console.error("Erreur download:", dlErr);
  });
}

// POST /api/palettes/demande/generate
router.post("/demande/generate", async (req, res) => {
  let tmpInput = null;
  let outputPath = null;

  try {
    const data = sanitizeDemande(req.body);
    const err = validateDemande(data);
    if (err) return res.status(400).json({ error: err });

    ({ tmpInput, outputPath } = await generateXlsxFile(data));

    // Sauvegarde best-effort de la destination dans le carnet du client.
    // Si quoi que ce soit échoue, on log et on continue : la génération
    // reste prioritaire et le téléchargement doit aboutir.
    const clientId = cleanString(req.body?.clientId);
    if (clientId) {
      try {
        await addDestinationToClient(clientId, data.livraison);
      } catch (saveErr) {
        console.warn(
          "Sauvegarde destination échouée (non bloquant) :",
          saveErr?.message || saveErr,
        );
      }
    }

    const downloadName = buildDownloadName(data.enlevement, data.livraison);

    // Ajoute l'entrée d'historique (best-effort, n'interrompt pas le download).
    // createdBy reste null tant que l'auth n'est pas en place.
    appendHistory(
      buildHistoryEntry({
        payload: data,
        downloadName,
        createdBy: null,
      }),
    ).catch(() => { /* déjà loggé en interne */ });

    streamGeneratedFile(res, tmpInput, outputPath, downloadName);
  } catch (e) {
    if (tmpInput) { try { await unlink(tmpInput); } catch { /* ignore */ } }
    if (outputPath) { try { await unlink(outputPath); } catch { /* ignore */ } }
    res.status(500).json({ error: e.message || "Erreur génération" });
  }
});

// ============================================================
//  Historique des demandes Palette
// ============================================================

// GET /api/palettes/history
//   Liste sans payload (pour l'affichage tabulaire).
router.get("/history", async (_req, res) => {
  try {
    const entries = await listHistoryEntries({ summary: true });
    res.json(entries);
  } catch (err) {
    res
      .status(500)
      .json({ error: err.message || "Erreur lecture historique" });
  }
});

// GET /api/palettes/history/:id
//   Renvoie une entrée complète, payload inclus, pour l'action "Dupliquer".
router.get("/history/:id", async (req, res) => {
  try {
    const entry = await getHistoryEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "Entrée introuvable" });
    res.json(entry);
  } catch (err) {
    res
      .status(500)
      .json({ error: err.message || "Erreur lecture historique" });
  }
});

// POST /api/palettes/history/:id/regenerate
//   Relance la génération avec le payload sauvegardé et stream le xlsx.
router.post("/history/:id/regenerate", async (req, res) => {
  let tmpInput = null;
  let outputPath = null;
  try {
    const entry = await getHistoryEntry(req.params.id);
    if (!entry || !entry.payload) {
      return res.status(404).json({ error: "Entrée introuvable" });
    }

    // Re-sanitize/valide au cas où le schéma ait évolué depuis.
    const data = sanitizeDemande(entry.payload);
    const err = validateDemande(data);
    if (err) return res.status(400).json({ error: err });

    ({ tmpInput, outputPath } = await generateXlsxFile(data));

    const downloadName = buildDownloadName(data.enlevement, data.livraison);
    streamGeneratedFile(res, tmpInput, outputPath, downloadName);
  } catch (e) {
    if (tmpInput) { try { await unlink(tmpInput); } catch { /* ignore */ } }
    if (outputPath) { try { await unlink(outputPath); } catch { /* ignore */ } }
    res.status(500).json({ error: e.message || "Erreur regénération" });
  }
});

// DELETE /api/palettes/history/:id
router.delete("/history/:id", async (req, res) => {
  try {
    const ok = await deleteHistoryEntry(req.params.id);
    if (!ok) return res.status(404).json({ error: "Entrée introuvable" });
    res.json({ ok: true });
  } catch (err) {
    res
      .status(500)
      .json({ error: err.message || "Erreur suppression historique" });
  }
});

export default router;
