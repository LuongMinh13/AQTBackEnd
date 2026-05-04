import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deletePaletteHistoryEntry,
  getPaletteHistoryEntry,
  listPaletteHistory,
  regenerateFromHistory,
} from "../api/palettes";
import { ROUTES } from "../utils/constants";
import "../assets/Style/pages/PaletteHistorique.css";

// Formate une ISO 8601 en "DD/MM/YYYY HH:mm"
function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Construit la ligne "Société · 75011 Paris"
function partyLine(p) {
  if (!p) return "—";
  const right = [p.cp, p.ville].filter(Boolean).join(" ");
  if (p.societe && right) return `${p.societe} · ${right}`;
  return p.societe || right || "—";
}

// Normalisation pour la recherche (insensible à la casse / accents)
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function entryMatches(entry, query) {
  if (!query) return true;
  const q = normalize(query);
  const haystack = [
    entry?.enlevement?.societe,
    entry?.enlevement?.cp,
    entry?.enlevement?.ville,
    entry?.livraison?.societe,
    entry?.livraison?.cp,
    entry?.livraison?.ville,
    entry?.createdBy,
    entry?.downloadName,
  ]
    .map(normalize)
    .join(" ");
  return haystack.includes(q);
}

export default function PaletteHistorique() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState(null);
  // Set d'IDs en cours de re-téléchargement (UI : bouton désactivé)
  const [busyIds, setBusyIds] = useState(() => new Set());

  const {
    data: entries = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["palette-history"],
    queryFn: listPaletteHistory,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["palette-history"] });

  const deleteMut = useMutation({
    mutationFn: deletePaletteHistoryEntry,
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(err?.message || "Erreur lors de la suppression"),
  });

  const filtered = useMemo(
    () => entries.filter((e) => entryMatches(e, search)),
    [entries, search],
  );

  // ---------- Actions ----------
  const setBusy = (id, busy) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleRedownload = async (entry) => {
    if (!entry?.id) return;
    setActionError(null);
    setBusy(entry.id, true);
    try {
      await regenerateFromHistory(entry);
    } catch (err) {
      setActionError(err?.message || "Erreur lors du re-téléchargement");
    } finally {
      setBusy(entry.id, false);
    }
  };

  const handleDuplicate = async (entry) => {
    if (!entry?.id) return;
    setActionError(null);
    setBusy(entry.id, true);
    try {
      // Le payload complet n'est pas dans la liste (summary), on le récupère.
      const full = await getPaletteHistoryEntry(entry.id);
      const payload = full?.payload;
      if (!payload) {
        setActionError("Payload introuvable pour cette entrée.");
        return;
      }
      // Navigue vers la page Demande en transmettant le payload via state.
      // DemandePalette détectera location.state?.duplicateFrom et pré-remplira.
      navigate(ROUTES.palette("demande"), {
        state: { duplicateFrom: payload },
      });
    } catch (err) {
      setActionError(err?.message || "Erreur lors de la duplication");
    } finally {
      setBusy(entry.id, false);
    }
  };

  const handleDelete = (entry) => {
    if (!entry?.id) return;
    const label =
      [entry.enlevement?.societe, entry.livraison?.societe]
        .filter(Boolean)
        .join(" → ") || "cette entrée";
    if (
      !window.confirm(
        `Supprimer ${label} de l'historique ? Cette action est définitive.`,
      )
    ) {
      return;
    }
    deleteMut.mutate(entry.id);
  };

  // ---------- Rendu ----------
  return (
    <div className="hist">
      <header className="hist__header">
        <h1 className="hist__title">Historique des demandes</h1>
        <p className="hist__subtitle">
          Re-téléchargez ou dupliquez une demande de palettes générée
          précédemment.
        </p>
      </header>

      {/* ===== Barre de recherche ===== */}
      <div className="hist__toolbar">
        <div className="hist__search">
          <SearchIcon />
          <input
            type="text"
            className="hist__search-input"
            placeholder="Rechercher par société, ville, code postal…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
          {search && (
            <button
              type="button"
              className="hist__search-clear"
              onClick={() => setSearch("")}
              aria-label="Effacer la recherche"
              title="Effacer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ===== Tableau ===== */}
      <section className="hist__section">
        <h2 className="hist__section-title">
          Demandes générées ({filtered.length}
          {search ? ` / ${entries.length}` : ""})
        </h2>

        {isLoading && <p className="hist__empty">Chargement…</p>}

        {error && (
          <p className="hist__error" role="alert">
            Erreur : {error.message}
          </p>
        )}

        {actionError && (
          <p className="hist__error" role="alert">
            {actionError}
          </p>
        )}

        {!isLoading && entries.length === 0 && (
          <p className="hist__empty">
            Aucune demande générée pour l'instant. Les demandes créées via
            « Nouvelle demande » apparaîtront ici.
          </p>
        )}

        {!isLoading && entries.length > 0 && filtered.length === 0 && (
          <p className="hist__empty">
            Aucune entrée ne correspond à « {search} ».
          </p>
        )}

        {filtered.length > 0 && (
          <div className="hist__table-wrap">
            <table className="hist__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Expéditeur</th>
                  <th>Destinataire</th>
                  <th className="hist__th-num">Palettes</th>
                  <th className="hist__th-num">Poids total</th>
                  <th>Utilisateur</th>
                  <th className="hist__th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const busy = busyIds.has(e.id);
                  return (
                    <tr key={e.id}>
                      <td className="hist__td-date">
                        {formatDate(e.createdAt)}
                      </td>
                      <td>{partyLine(e.enlevement)}</td>
                      <td>{partyLine(e.livraison)}</td>
                      <td className="hist__td-num">
                        {e.paletteCount ?? "—"}
                      </td>
                      <td className="hist__td-num">
                        {Number.isFinite(Number(e.poidsTotal))
                          ? `${Number(e.poidsTotal).toLocaleString("fr-FR", {
                              maximumFractionDigits: 2,
                            })} kg`
                          : "—"}
                      </td>
                      <td className="hist__td-user">
                        {e.createdBy || (
                          <span className="hist__muted">—</span>
                        )}
                      </td>
                      <td className="hist__th-right">
                        <div className="hist__row-actions">
                          <button
                            type="button"
                            className="hist__icon-btn"
                            onClick={() => handleRedownload(e)}
                            disabled={busy}
                            title="Re-télécharger le fichier Excel"
                          >
                            <DownloadIcon />
                            <span>Télécharger</span>
                          </button>
                          <button
                            type="button"
                            className="hist__icon-btn"
                            onClick={() => handleDuplicate(e)}
                            disabled={busy}
                            title="Dupliquer dans une nouvelle demande"
                          >
                            <CopyIcon />
                            <span>Dupliquer</span>
                          </button>
                          <button
                            type="button"
                            className="hist__icon-btn hist__icon-btn--danger"
                            onClick={() => handleDelete(e)}
                            disabled={busy || deleteMut.isPending}
                            title="Supprimer de l'historique"
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// =====================================================
// Icônes
// =====================================================
function SearchIcon() {
  return (
    <svg
      className="hist__search-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
