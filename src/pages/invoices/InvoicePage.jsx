import { useState } from "react";
import FileUpload from "../../components/FileUpload";
import { getCarrierByslug, INVOICE_CARRIERS } from "../../utils/constants";
import {
  processUpsInvoice,
  exportUpsInvoice,
  processTntInvoice,
  exportTntInvoice,
} from "../../api/invoices";
import "../../assets/Style/pages/InvoicePage.css";

// Catégories affichées dans le résumé UPS (dans l'ordre d'affichage)
const UPS_CATEGORIES = [
  { key: "audit", label: "Audit" },
  { key: "liv_particulier", label: "Liv. Particulier" },
  { key: "residence", label: "Résidence" },
  { key: "suppenlevement", label: "Supp. Enlèvement" },
];

// Catégories affichées dans le résumé TNT
const TNT_CATEGORIES = [
  { key: "bt_non_identifiables", label: "BT non identifiables" },
  { key: "services_options", label: "Services & Options" },
  { key: "poids_differents", label: "Poids différents" },
];

export default function InvoicePage({ carrierSlug }) {
  const carrier = getCarrierByslug(INVOICE_CARRIERS, carrierSlug);

  // Pour un upload "multiple", files[key] est un tableau de File.
  // Pour un upload "single", files[key] est un File unique.
  const [files, setFiles] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  if (!carrier) {
    return (
      <div className="invoice-page">
        <h1>Transporteur inconnu</h1>
        <p>Le transporteur demandé n'existe pas.</p>
      </div>
    );
  }

  const isFilled = (upload) => {
    const v = files[upload.key];
    if (upload.multiple) return Array.isArray(v) && v.length > 0;
    return !!v;
  };

  const allRequiredFilled = carrier.uploads
    .filter((u) => u.required)
    .every(isFilled);

  const canProcess = allRequiredFilled && !isProcessing;

  const handleFileSelect = (key, file) => {
    setFiles((prev) => ({ ...prev, [key]: file }));
  };

  const handleFilesChange = (key, nextFiles) => {
    setFiles((prev) => ({ ...prev, [key]: nextFiles }));
    if (key === "pdf") {
      // Remise à zéro des résultats dès qu'on change la sélection
      setResults(null);
      setError(null);
    }
  };

  const handleFileClear = (key) => {
    setFiles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (key === "pdf") {
      setResults(null);
      setError(null);
    }
  };

  const handleProcess = async () => {
    if (!canProcess) return;
    setIsProcessing(true);
    setError(null);
    setResults(null);

    try {
      if (carrier.slug === "ups") {
        const pdfs = Array.isArray(files.pdf) ? files.pdf : [files.pdf];
        const data = await processUpsInvoice(pdfs);
        setResults({ type: "ups", count: pdfs.length, ...data });
      } else if (carrier.slug === "tnt") {
        const data = await processTntInvoice(files.pdf, files.excel);
        setResults({ type: "tnt", ...data });
      } else {
        // Autre transporteur non branché pour l'instant
        await new Promise((r) => setTimeout(r, 300));
        setResults({ type: carrier.slug, rows: [] });
      }
    } catch (err) {
      console.error("[handleProcess]", err);
      setError(
        err?.response?.data?.error ||
          err?.message ||
          "Erreur lors du traitement."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportXlsx = async () => {
    if (!results || isExporting) return;
    if (results.type !== "ups" && results.type !== "tnt") return;

    setIsExporting(true);
    setError(null);
    try {
      if (results.type === "ups") {
        await exportUpsInvoice({
          audit: results.audit || [],
          liv_particulier: results.liv_particulier || [],
          residence: results.residence || [],
          suppenlevement: results.suppenlevement || [],
        });
      } else {
        await exportTntInvoice({
          bt_non_identifiables: results.bt_non_identifiables || [],
          services_options: results.services_options || [],
          poids_differents: results.poids_differents || [],
        });
      }
    } catch (err) {
      console.error("[handleExportXlsx]", err);
      setError(
        err?.response?.data?.error ||
          err?.message ||
          "Erreur lors de l'export."
      );
    } finally {
      setIsExporting(false);
    }
  };

  const upsTotal =
    results?.type === "ups"
      ? UPS_CATEGORIES.reduce(
          (sum, c) => sum + (results[c.key]?.length || 0),
          0
        )
      : 0;

  const tntTotal =
    results?.type === "tnt"
      ? TNT_CATEGORIES.reduce(
          (sum, c) => sum + (results[c.key]?.length || 0),
          0
        )
      : 0;

  return (
    <div className="invoice-page">
      <header className="invoice-page__header">
        <h1 className="invoice-page__title">
          Traitement des factures {carrier.name}
        </h1>
        <p className="invoice-page__subtitle">
          Importez les factures {carrier.name} pour extraire les données
          de facturation.
        </p>
      </header>

      {/* Bloc uploads */}
      <section className="invoice-page__section">
        <div className="invoice-page__section-head">
          <div>
            <h2 className="invoice-page__section-title">
              Importer les documents
            </h2>
            <p className="invoice-page__section-desc">
              {carrier.uploads.length > 1
                ? `Sélectionnez les ${carrier.uploads.length} fichiers nécessaires.`
                : carrier.uploads[0]?.multiple
                  ? "Sélectionnez un ou plusieurs PDF pour commencer."
                  : "Sélectionnez une facture PDF pour commencer."}
            </p>
          </div>
        </div>

        <div
          className={
            "invoice-page__uploads" +
            (carrier.uploads.length > 1 ? " invoice-page__uploads--grid" : "")
          }
        >
          {carrier.uploads.map((upload) => (
            <div key={upload.key} className="invoice-page__upload-slot">
              <div className="invoice-page__upload-head">
                <h3 className="invoice-page__upload-title">
                  {upload.title}
                  {upload.required && (
                    <span className="invoice-page__upload-required"> *</span>
                  )}
                </h3>
                {upload.description && (
                  <p className="invoice-page__upload-desc">
                    {upload.description}
                  </p>
                )}
              </div>

              {upload.multiple ? (
                <FileUpload
                  multiple
                  accept={upload.accept}
                  files={Array.isArray(files[upload.key]) ? files[upload.key] : []}
                  onFilesChange={(fs) => handleFilesChange(upload.key, fs)}
                  label={upload.label}
                  hint={upload.hint}
                />
              ) : (
                <FileUpload
                  accept={upload.accept}
                  file={files[upload.key] || null}
                  onFileSelect={(f) => handleFileSelect(upload.key, f)}
                  onClear={() => handleFileClear(upload.key)}
                  label={upload.label}
                  hint={upload.hint}
                />
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          className="invoice-page__process-btn"
          disabled={!canProcess}
          onClick={handleProcess}
        >
          {isProcessing ? "Traitement en cours…" : "Traiter la facture"}
        </button>

        {error && <p className="invoice-page__error">{error}</p>}
      </section>

      {/* Bloc résultats : résumé + bouton téléchargement */}
      <section className="invoice-page__section">
        <div className="invoice-page__section-head">
          <div>
            <h2 className="invoice-page__section-title">Résultat du traitement</h2>
            <p className="invoice-page__section-desc">
              {results?.type === "ups"
                ? `${upsTotal} ligne${upsTotal > 1 ? "s" : ""} extraite${upsTotal > 1 ? "s" : ""}` +
                  (results.count > 1
                    ? ` depuis ${results.count} fichiers`
                    : "") +
                  " — prêt à être téléchargé."
                : results?.type === "tnt"
                  ? `${tntTotal} ligne${tntTotal > 1 ? "s" : ""} extraite${tntTotal > 1 ? "s" : ""} — prêt à être téléchargé.`
                  : "Le fichier Excel apparaîtra ici après traitement."}
            </p>
          </div>
        </div>

        {results?.type === "ups" ? (
          <div className="invoice-page__summary">
            <div className="invoice-page__summary-grid">
              {UPS_CATEGORIES.map((c) => (
                <div key={c.key} className="invoice-page__summary-card">
                  <span className="invoice-page__summary-label">{c.label}</span>
                  <span className="invoice-page__summary-value">
                    {(results[c.key]?.length || 0).toLocaleString("fr-FR")}
                  </span>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="invoice-page__download-btn"
              onClick={handleExportXlsx}
              disabled={isExporting || upsTotal === 0}
            >
              {isExporting
                ? "Préparation du fichier…"
                : "Télécharger le fichier Excel"}
            </button>
          </div>
        ) : results?.type === "tnt" ? (
          <div className="invoice-page__summary">
            <div className="invoice-page__summary-grid">
              {TNT_CATEGORIES.map((c) => (
                <div key={c.key} className="invoice-page__summary-card">
                  <span className="invoice-page__summary-label">{c.label}</span>
                  <span className="invoice-page__summary-value">
                    {(results[c.key]?.length || 0).toLocaleString("fr-FR")}
                  </span>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="invoice-page__download-btn"
              onClick={handleExportXlsx}
              disabled={isExporting || tntTotal === 0}
            >
              {isExporting
                ? "Préparation du fichier…"
                : "Télécharger le fichier Excel"}
            </button>
          </div>
        ) : (
          <div className="invoice-page__placeholder">
            {isProcessing
              ? "Traitement en cours…"
              : "Aucun fichier pour l'instant. Importez un PDF et cliquez sur « Traiter la facture »."}
          </div>
        )}
      </section>
    </div>
  );
}
