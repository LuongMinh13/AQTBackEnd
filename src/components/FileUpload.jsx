import { useRef, useState } from "react";
import "../assets/Style/components/FileUpload.css";

/**
 * Zone de drag & drop réutilisable pour l'upload de fichiers.
 *
 * Mode single (par défaut) :
 *  - file         : fichier actuellement sélectionné
 *  - onFileSelect : callback(file)
 *  - onClear      : callback()
 *
 * Mode multiple (multiple=true) :
 *  - files          : array de fichiers
 *  - onFilesChange  : callback(nextArray) — le parent remplace sa liste
 */
export default function FileUpload({
  accept = "application/pdf",
  multiple = false,
  file = null,
  files = [],
  onFileSelect,
  onFilesChange,
  onClear,
  label = "Glissez-déposez votre fichier ici",
  hint = "ou cliquez pour parcourir",
}) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const handleFiles = (picked) => {
    if (!picked || picked.length === 0) return;
    if (multiple) {
      const arr = Array.from(picked);
      // Dédup par nom+taille pour éviter les doublons
      const existing = new Set(files.map((f) => `${f.name}|${f.size}`));
      const next = [...files];
      for (const f of arr) {
        const key = `${f.name}|${f.size}`;
        if (!existing.has(key)) {
          next.push(f);
          existing.add(key);
        }
      }
      onFilesChange?.(next);
    } else {
      onFileSelect?.(picked[0]);
    }
  };

  const handleRemoveAt = (e, i) => {
    e.stopPropagation();
    if (!multiple) return;
    onFilesChange?.(files.filter((_, idx) => idx !== i));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleChange = (e) => {
    handleFiles(e.target.files);
    // reset pour permettre de re-sélectionner le même fichier
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClearSingle = (e) => {
    e.stopPropagation();
    if (inputRef.current) inputRef.current.value = "";
    onClear?.();
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
  };

  // ======= MODE MULTIPLE =======
  if (multiple) {
    const hasFiles = files.length > 0;
    return (
      <div className="file-upload-multi">
        <div
          className={
            "file-upload" +
            (isDragging ? " is-dragging" : "") +
            " file-upload--compact"
          }
          onClick={openPicker}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) =>
            (e.key === "Enter" || e.key === " ") && openPicker()
          }
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            onChange={handleChange}
            multiple
            hidden
          />
          <div className="file-upload__icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="file-upload__label">
            {hasFiles ? "Ajouter d'autres fichiers" : label}
          </p>
          <p className="file-upload__hint">{hint}</p>
        </div>

        {hasFiles && (
          <ul className="file-upload__list">
            {files.map((f, i) => (
              <li key={`${f.name}-${f.size}-${i}`} className="file-upload__list-item">
                <div className="file-upload__file-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="file-upload__file-info">
                  <span className="file-upload__file-name">{f.name}</span>
                  <span className="file-upload__file-size">
                    {formatSize(f.size)}
                  </span>
                </div>
                <button
                  type="button"
                  className="file-upload__clear"
                  onClick={(e) => handleRemoveAt(e, i)}
                  aria-label={`Retirer ${f.name}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ======= MODE SINGLE (par défaut) =======
  return (
    <div
      className={
        "file-upload" +
        (isDragging ? " is-dragging" : "") +
        (file ? " has-file" : "")
      }
      onClick={openPicker}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPicker()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        hidden
      />

      {!file ? (
        <>
          <div className="file-upload__icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="file-upload__label">{label}</p>
          <p className="file-upload__hint">{hint}</p>
        </>
      ) : (
        <div className="file-upload__preview">
          <div className="file-upload__file-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="file-upload__file-info">
            <span className="file-upload__file-name">{file.name}</span>
            <span className="file-upload__file-size">{formatSize(file.size)}</span>
          </div>
          <button
            type="button"
            className="file-upload__clear"
            onClick={handleClearSingle}
            aria-label="Retirer le fichier"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
