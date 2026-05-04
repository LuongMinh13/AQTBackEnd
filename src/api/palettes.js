import { apiClient } from "./client";

/**
 * API Palettes : carnet de clients + génération de la demande DHL remplie.
 */

// ------------------------------------------------------------------
//  Clients (expéditeurs récurrents)
// ------------------------------------------------------------------

export async function listClients() {
  const { data } = await apiClient.get("/api/palettes/clients");
  return Array.isArray(data) ? data : [];
}

// ------------------------------------------------------------------
//  Grille tarifaire DHL Freight (départ 77 / 94)
// ------------------------------------------------------------------

export async function fetchPaletteRates() {
  const { data } = await apiClient.get("/api/palettes/rates");
  return data;
}

export async function createClient(payload) {
  const { data } = await apiClient.post("/api/palettes/clients", payload);
  return data;
}

export async function updateClient(id, payload) {
  const { data } = await apiClient.put(`/api/palettes/clients/${id}`, payload);
  return data;
}

export async function deleteClient(id) {
  const { data } = await apiClient.delete(`/api/palettes/clients/${id}`);
  return data;
}

// ------------------------------------------------------------------
//  Carnet des destinations sauvegardées par client
// ------------------------------------------------------------------

export async function deleteClientDestination(clientId, destinationId) {
  const { data } = await apiClient.delete(
    `/api/palettes/clients/${clientId}/destinations/${destinationId}`,
  );
  return data;
}

export async function updateClientDestination(clientId, destinationId, payload) {
  const { data } = await apiClient.put(
    `/api/palettes/clients/${clientId}/destinations/${destinationId}`,
    payload,
  );
  return data;
}

export async function createClientDestination(clientId, payload) {
  const { data } = await apiClient.post(
    `/api/palettes/clients/${clientId}/destinations`,
    payload,
  );
  return data;
}

// ------------------------------------------------------------------
//  Génération du fichier Excel DHL rempli
// ------------------------------------------------------------------

/**
 * Envoie la demande au backend qui remplit le template DHL et retourne le xlsx.
 * Déclenche directement le téléchargement côté navigateur.
 *
 * @param {Object} payload
 *   {
 *     dates: { emission, cotation },
 *     enlevement: { societe, adresse, contact, tel },
 *     livraison:  { societe, adresse, contact, tel },
 *     cp_enlevement, cp_livraison,
 *     palettes: [ { poids, dimensions, gerbable } ]
 *   }
 */
// Nettoie chaque champ individuellement : trim, retire les caractères
// interdits par les FS Windows/macOS, normalise les espaces.
function sanitizePart(s) {
  return String(s ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Construit le segment "<société> <CP> <ville>" pour une partie (expéditeur
// ou destinataire), avec casse d'origine conservée.
function buildLocationStem(party) {
  const parts = [party?.societe, party?.cp, party?.ville]
    .map(sanitizePart)
    .filter(Boolean);
  return parts.join(" ");
}

// Nom de fichier proposé au téléchargement :
// "<expéditeur> / <destinataire>.xlsx".
// Le " / " littéral sépare les deux blocs (les slashes à l'intérieur de
// chaque partie sont retirés en amont par sanitizePart).
function buildDownloadName(enlevement, livraison) {
  const from = buildLocationStem(enlevement);
  const to = buildLocationStem(livraison);
  if (from && to) return `${from} / ${to}.xlsx`;
  return `${from || to || "demande-palette"}.xlsx`;
}

// Essaie de relire un blob d'erreur et d'en extraire le message backend.
async function extractBlobErrorMessage(blob, fallback) {
  try {
    const text = await blob.text();
    try {
      const obj = JSON.parse(text);
      if (obj?.error) return obj.error;
    } catch {
      if (text) return text.slice(0, 200);
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function generateDemandePalette(payload) {
  let response;
  try {
    response = await apiClient.post(
      "/api/palettes/demande/generate",
      payload,
      { responseType: "blob" },
    );
  } catch (err) {
    // Axios lève sur 4xx/5xx. En responseType=blob, err.response.data
    // est un Blob contenant le JSON d'erreur — il faut le relire en texte.
    const data = err?.response?.data;
    if (data instanceof Blob) {
      const msg = await extractBlobErrorMessage(
        data,
        err.message || "Erreur génération",
      );
      throw new Error(msg);
    }
    throw err;
  }

  // Certains backends renvoient 200 avec un JSON d'erreur (par prudence).
  const ct = response.headers?.["content-type"] || "";
  if (ct.includes("application/json")) {
    const msg = await extractBlobErrorMessage(response.data, "Erreur génération");
    throw new Error(msg);
  }

  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;

  // Le header Content-Disposition n'étant pas toujours exposé en CORS,
  // on calcule le nom directement depuis le payload.
  a.download = buildDownloadName(payload?.enlevement, payload?.livraison);

  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

// ------------------------------------------------------------------
//  Historique des demandes Palette
// ------------------------------------------------------------------

export async function listPaletteHistory() {
  const { data } = await apiClient.get("/api/palettes/history");
  return Array.isArray(data) ? data : [];
}

export async function getPaletteHistoryEntry(id) {
  const { data } = await apiClient.get(`/api/palettes/history/${id}`);
  return data;
}

export async function deletePaletteHistoryEntry(id) {
  const { data } = await apiClient.delete(`/api/palettes/history/${id}`);
  return data;
}

/**
 * Relance la génération d'une entrée d'historique côté serveur et
 * déclenche le téléchargement dans le navigateur.
 *
 * @param {Object} entry  Entrée d'historique (au moins { id, enlevement, livraison })
 *                        — utilisée pour recalculer le downloadName.
 */
export async function regenerateFromHistory(entry) {
  if (!entry?.id) throw new Error("Entrée d'historique invalide");

  let response;
  try {
    response = await apiClient.post(
      `/api/palettes/history/${entry.id}/regenerate`,
      null,
      { responseType: "blob" },
    );
  } catch (err) {
    const data = err?.response?.data;
    if (data instanceof Blob) {
      const msg = await extractBlobErrorMessage(
        data,
        err.message || "Erreur regénération",
      );
      throw new Error(msg);
    }
    throw err;
  }

  const ct = response.headers?.["content-type"] || "";
  if (ct.includes("application/json")) {
    const msg = await extractBlobErrorMessage(response.data, "Erreur regénération");
    throw new Error(msg);
  }

  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = buildDownloadName(entry?.enlevement, entry?.livraison);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
