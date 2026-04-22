import { apiClient } from "./client";

/**
 * Envoie un ou plusieurs PDF UPS au backend et récupère les 4 tableaux extraits
 * fusionnés dans un seul résultat.
 *
 * @param {File|File[]} pdfFiles - fichier unique ou tableau de fichiers
 * @returns {Promise<{
 *   audit: Array<Object>,
 *   liv_particulier: Array<Object>,
 *   residence: Array<Object>,
 *   suppenlevement: Array<Object>,
 * }>}
 */
export async function processUpsInvoice(pdfFiles) {
  const form = new FormData();
  const list = Array.isArray(pdfFiles) ? pdfFiles : [pdfFiles];
  for (const f of list) {
    if (f) form.append("pdf", f);
  }

  const { data } = await apiClient.post("/api/invoices/ups/process", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/**
 * Demande au backend de générer un .xlsx (4 onglets) et déclenche le téléchargement.
 * @param {Object} results - { audit, liv_particulier, residence, suppenlevement }
 * @param {string} [filename] - nom du fichier téléchargé
 */
export async function exportUpsInvoice(results, filename) {
  await downloadXlsx("/api/invoices/ups/export", results, filename, "facture_ups.xlsx");
}

/**
 * Envoie 1 PDF TNT + 1 Excel HUB au backend et récupère les 3 tableaux extraits.
 *
 * @param {File} pdfFile
 * @param {File} hubFile
 * @returns {Promise<{
 *   bt_non_identifiables: Array<Object>,
 *   services_options: Array<Object>,
 *   poids_differents: Array<Object>,
 * }>}
 */
export async function processTntInvoice(pdfFile, hubFile) {
  const form = new FormData();
  form.append("pdf", pdfFile);
  form.append("hub", hubFile);

  const { data } = await apiClient.post("/api/invoices/tnt/process", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/**
 * Demande au backend de générer un .xlsx TNT (3 onglets) et déclenche le téléchargement.
 * @param {Object} results - { bt_non_identifiables, services_options, poids_differents }
 * @param {string} [filename]
 */
export async function exportTntInvoice(results, filename) {
  await downloadXlsx("/api/invoices/tnt/export", results, filename, "facture_tnt.xlsx");
}

// --------- helpers internes ---------

async function downloadXlsx(url, body, filename, fallbackName) {
  const response = await apiClient.post(url, body, { responseType: "blob" });

  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;

  const cd = response.headers?.["content-disposition"] || "";
  const match = /filename="?([^";]+)"?/i.exec(cd);
  a.download = filename || match?.[1] || fallbackName;

  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
