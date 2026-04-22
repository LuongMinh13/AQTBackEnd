import { useState } from "react";
import FileUpload from "../components/FileUpload";
import "../assets/Style/pages/Palettes.css";

export default function Palettes() {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcess = async () => {
    if (!file) return;
    setIsProcessing(true);
    try {
      // TODO : brancher le traitement du devis DHL
      await new Promise((r) => setTimeout(r, 800));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="palettes-page">
      <header className="palettes-page__header">
        <h1 className="palettes-page__title">Demande Palette</h1>
        <p className="palettes-page__subtitle">
          Importez un devis DHL et pré-remplissez automatiquement les adresses
          pour vos expéditions de palettes.
        </p>
      </header>

      <section className="palettes-page__info">
        <div className="palettes-page__info-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
        <div>
          <p className="palettes-page__info-title">Comment ça marche ?</p>
          <p className="palettes-page__info-desc">
            Déposez votre fichier Excel de devis DHL. Le système extraira les
            adresses d'enlèvement et de livraison pour vous faire gagner du
            temps sur la saisie.
          </p>
        </div>
      </section>

      <section className="palettes-page__section">
        <div className="palettes-page__section-head">
          <h2 className="palettes-page__section-title">Importer un devis DHL</h2>
          <p className="palettes-page__section-desc">
            Formats acceptés : .xlsx, .xls
          </p>
        </div>

        <FileUpload
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          file={file}
          onFileSelect={setFile}
          onClear={() => setFile(null)}
          label="Glissez-déposez votre fichier Excel ici"
          hint="ou cliquez pour parcourir"
        />

        <button
          type="button"
          className="palettes-page__process-btn"
          disabled={!file || isProcessing}
          onClick={handleProcess}
        >
          {isProcessing ? "Traitement en cours…" : "Traiter le devis"}
        </button>
      </section>
    </div>
  );
}
