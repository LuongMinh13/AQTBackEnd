import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createClient,
  createClientDestination,
  deleteClient,
  deleteClientDestination,
  listClients,
  updateClient,
  updateClientDestination,
} from "../api/palettes";
import "../assets/Style/pages/CarnetClients.css";
// On réutilise les styles "underlined fields" de DemandePalette pour
// que le formulaire du modal ait le même look (dp__grid / dp__ufield…).
import "../assets/Style/pages/DemandePalette.css";

// État de formulaire (champ "contact" unique côté UI ; il sera scindé en
// prenom/nom au moment de l'envoi pour rester compatible avec le schéma
// backend existant).
const emptyForm = () => ({
  societe: "",
  adresse1: "",
  adresse2: "",
  cp: "",
  ville: "",
  pays: "France",
  contact: "",
  email: "",
  tel: "",
});

// Construit "Prénom Nom" à partir d'un client (filtre les vides)
function buildContact(client) {
  return [client?.prenom, client?.nom]
    .filter((s) => s && String(s).trim())
    .join(" ");
}

// Découpe un "Prénom Nom" en {prenom, nom} : premier mot → prenom, reste → nom
function splitContact(contact) {
  const trimmed = String(contact || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { prenom: "", nom: "" };
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { prenom: parts[0], nom: "" };
  return { prenom: parts[0], nom: parts.slice(1).join(" ") };
}

// Normalisation pour la recherche (insensible à la casse / accents)
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clientMatches(client, query) {
  if (!query) return true;
  const q = normalize(query);
  const haystack = [
    client.societe,
    client.adresse1,
    client.adresse2,
    client.cp,
    client.ville,
    client.pays,
    client.nom,
    client.prenom,
    client.email,
    client.tel,
  ]
    .map(normalize)
    .join(" ");
  return haystack.includes(q);
}

export default function CarnetClients() {
  const queryClient = useQueryClient();

  // ---------- Recherche ----------
  const [search, setSearch] = useState("");

  // ---------- Modal (création / édition) ----------
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState(null);

  // ---------- Modal carnet d'adresses (destinations sauvegardées) ----------
  const [destClientId, setDestClientId] = useState(null);
  const openDestinations = (clientId) => setDestClientId(clientId);
  const closeDestinations = () => setDestClientId(null);

  // ---------- Données ----------
  const {
    data: clients = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["palette-clients"],
    queryFn: listClients,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["palette-clients"] });

  // ---------- Helpers modal ----------
  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (client) => {
    setEditingId(client.id);
    setForm({
      societe: client.societe || "",
      adresse1: client.adresse1 || "",
      adresse2: client.adresse2 || "",
      cp: client.cp || "",
      ville: client.ville || "",
      pays: client.pays || "France",
      contact: buildContact(client),
      email: client.email || "",
      tel: client.tel || "",
    });
    setFormError(null);
    setModalOpen(true);
  };

  // Esc pour fermer le modal
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  // ---------- Mutations ----------
  const createMut = useMutation({
    mutationFn: createClient,
    onSuccess: () => {
      invalidate();
      closeModal();
    },
    onError: (err) => setFormError(err?.response?.data?.error || err.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateClient(id, data),
    onSuccess: () => {
      invalidate();
      closeModal();
    },
    onError: (err) => setFormError(err?.response?.data?.error || err.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteClient,
    onSuccess: () => invalidate(),
  });

  const isPending = createMut.isPending || updateMut.isPending;

  // ---------- Handlers form ----------
  const handleChange = (field) => (value) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleDelete = (client) => {
    if (
      !window.confirm(
        `Supprimer "${client.societe}" du carnet ? Cette action est définitive.`,
      )
    ) {
      return;
    }
    deleteMut.mutate(client.id);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(null);
    if (!form.societe.trim()) {
      setFormError("Le champ 'société' est obligatoire.");
      return;
    }
    if (!form.adresse1.trim()) {
      setFormError("Le champ 'adresse 1' est obligatoire.");
      return;
    }
    if (!form.cp.trim()) {
      setFormError("Le code postal est obligatoire.");
      return;
    }
    if (!form.ville.trim()) {
      setFormError("La ville est obligatoire.");
      return;
    }
    // Le backend attend prenom/nom séparément.
    const { prenom, nom } = splitContact(form.contact);
    const payload = {
      societe: form.societe,
      adresse1: form.adresse1,
      adresse2: form.adresse2,
      cp: form.cp,
      ville: form.ville,
      pays: form.pays,
      prenom,
      nom,
      email: form.email,
      tel: form.tel,
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  // ---------- Liste filtrée ----------
  const filtered = useMemo(
    () => clients.filter((c) => clientMatches(c, search)),
    [clients, search],
  );

  return (
    <div className="carnet">
      <header className="carnet__header">
        <h1 className="carnet__title">Carnet clients</h1>
        <p className="carnet__subtitle">
          Enregistrez vos expéditeurs récurrents pour pré-remplir
          automatiquement les demandes de tarifs.
        </p>
      </header>

      {/* ===== Barre d'actions : recherche + ajouter ===== */}
      <div className="carnet__toolbar">
        <div className="carnet__search">
          <SearchIcon />
          <input
            type="text"
            className="carnet__search-input"
            placeholder="Rechercher par société, ville, code postal, contact…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
          {search && (
            <button
              type="button"
              className="carnet__search-clear"
              onClick={() => setSearch("")}
              aria-label="Effacer la recherche"
              title="Effacer"
            >
              ×
            </button>
          )}
        </div>
        <button
          type="button"
          className="carnet__add-btn"
          onClick={openCreate}
        >
          <PlusIcon />
          <span>Ajouter un nouveau client</span>
        </button>
      </div>

      {/* ===== Liste ===== */}
      <section className="carnet__section">
        <h2 className="carnet__section-title">
          Clients enregistrés ({filtered.length}
          {search ? ` / ${clients.length}` : ""})
        </h2>

        {isLoading && <p className="carnet__empty">Chargement…</p>}

        {error && (
          <p className="carnet__error" role="alert">
            Erreur : {error.message}
          </p>
        )}

        {!isLoading && clients.length === 0 && (
          <p className="carnet__empty">
            Aucun client pour l'instant. Cliquez sur « Ajouter un nouveau
            client » pour en créer un.
          </p>
        )}

        {!isLoading && clients.length > 0 && filtered.length === 0 && (
          <p className="carnet__empty">
            Aucun client ne correspond à « {search} ».
          </p>
        )}

        {filtered.length > 0 && (
          <ul className="carnet__list">
            {filtered.map((c) => (
              <li key={c.id} className="carnet__item">
                <div className="carnet__item-main">
                  <p className="carnet__item-societe">{c.societe}</p>
                  <p className="carnet__item-adresse">
                    {[
                      c.adresse1,
                      c.adresse2,
                      [c.cp, c.ville].filter(Boolean).join(" "),
                      c.pays,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="carnet__item-meta">
                    {(() => {
                      const fullName = [c.prenom, c.nom]
                        .filter((s) => s && s.trim())
                        .join(" ");
                      const parts = [fullName, c.email, c.tel].filter(Boolean);
                      return parts.length > 0 ? parts.join(" · ") : null;
                    })()}
                  </p>
                </div>
                <div className="carnet__item-actions">
                  <button
                    type="button"
                    className="carnet__icon-btn"
                    onClick={() => openEdit(c)}
                    title="Modifier"
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="carnet__icon-btn"
                    onClick={() => openDestinations(c.id)}
                    title="Carnet d'adresses (destinations enregistrées)"
                  >
                    <BookIcon />
                    <span>Carnet adresses</span>
                    {Array.isArray(c.destinations) && c.destinations.length > 0 && (
                      <span className="carnet__badge">
                        {c.destinations.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="carnet__icon-btn carnet__icon-btn--danger"
                    onClick={() => handleDelete(c)}
                    disabled={deleteMut.isPending}
                    title="Supprimer"
                  >
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== Modal création / édition ===== */}
      {modalOpen && (
        <ClientFormModal
          editingId={editingId}
          form={form}
          formError={formError}
          isPending={isPending}
          onChange={handleChange}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}

      {/* ===== Modal carnet d'adresses ===== */}
      {destClientId && (
        <DestinationsModal
          client={clients.find((c) => c.id === destClientId) || null}
          onClose={closeDestinations}
        />
      )}
    </div>
  );
}

// =====================================================
// Modal formulaire client (création + édition)
// Utilise les classes dp__grid / dp__ufield pour aligner le format
// avec les sections Expéditeur / Destinataire de DemandePalette.
// =====================================================
function ClientFormModal({
  editingId,
  form,
  formError,
  isPending,
  onChange,
  onSubmit,
  onClose,
}) {
  return (
    <div className="carnet__modal-overlay" onClick={onClose}>
      <div
        className="carnet__modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="carnet__modal-head">
          <h2 className="carnet__modal-title">
            {editingId ? "Modifier le client" : "Ajouter un nouveau client"}
          </h2>
          <button
            type="button"
            className="carnet__modal-close"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer"
          >
            ×
          </button>
        </header>

        <form className="carnet__form" onSubmit={onSubmit}>
          <div className="dp__grid">
            {/* Ligne 1 : Société (pleine largeur) */}
            <UField
              label="Société"
              required
              value={form.societe}
              onChange={onChange("societe")}
              size="full"
              autoFocus
            />

            {/* Ligne 2 : Adresse 1 + Adresse 2 */}
            <UField
              label="Adresse 1"
              required
              value={form.adresse1}
              onChange={onChange("adresse1")}
              placeholder="N° et rue"
            />
            <UField
              label="Adresse 2"
              value={form.adresse2}
              onChange={onChange("adresse2")}
              placeholder="Bâtiment, étage, complément…"
            />

            {/* Ligne 3 : Code postal + Ville + Pays */}
            <UField
              label="Code postal"
              required
              value={form.cp}
              onChange={onChange("cp")}
              size="small"
            />
            <UField
              label="Ville"
              required
              value={form.ville}
              onChange={onChange("ville")}
              size="m4"
            />
            <UField
              label="Pays"
              value={form.pays}
              onChange={onChange("pays")}
              size="m5"
            />

            {/* Ligne 4 : Contact + Téléphone + Email */}
            <UField
              label="Contact"
              value={form.contact}
              onChange={onChange("contact")}
              placeholder="Prénom Nom"
              size="m4"
            />
            <UField
              label="Téléphone"
              value={form.tel}
              onChange={onChange("tel")}
              size="m4"
            />
            <UField
              label="Email"
              type="email"
              value={form.email}
              onChange={onChange("email")}
              placeholder="contact@societe.com"
              size="m4"
            />
          </div>

          {formError && (
            <div className="carnet__error" role="alert">
              {formError}
            </div>
          )}

          <div className="carnet__form-actions">
            <button
              type="button"
              className="carnet__cancel-btn"
              onClick={onClose}
              disabled={isPending}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="carnet__submit-btn"
              disabled={isPending}
            >
              {isPending
                ? "Enregistrement…"
                : editingId
                  ? "Mettre à jour"
                  : "Ajouter au carnet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =====================================================
// UField : champ "underlined" (style DemandePalette)
// size : "full" | "small" | "m4" | "m5" | "m9" | undefined (par défaut span 6)
// =====================================================
function UField({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  placeholder,
  size,
  autoFocus = false,
}) {
  const empty = !value || (typeof value === "string" && !value.trim());
  const showRequired = required && empty;

  const sizeClass = size ? `dp__ufield--${size}` : "";
  const cls = [
    "dp__ufield",
    sizeClass,
    showRequired && "dp__ufield--required",
    !empty && "dp__ufield--filled",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <label className="dp__ulabel">
        {label}
        {required ? <span className="dp__req">*</span> : null}
      </label>
      <input
        type={type}
        className="dp__uinput"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {showRequired && (
        <span className="dp__inline-err">Ce champ est obligatoire !</span>
      )}
    </div>
  );
}

// =====================================================
// Petites icônes (loupe + plus)
// =====================================================
function SearchIcon() {
  return (
    <svg
      className="carnet__search-icon"
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

function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function BookIcon() {
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
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

// =====================================================
// DestinationsModal : popup carnet des destinations sauvegardées
// pour un client donné (consultation + édition + suppression)
// =====================================================
function DestinationsModal({ client, onClose }) {
  const queryClient = useQueryClient();
  const [pendingDeletes, setPendingDeletes] = useState(() => new Set());
  const [deleteError, setDeleteError] = useState(null);
  // Sous-modal d'édition / création :
  //   null    → fermé
  //   "new"   → mode création
  //   {dest…} → mode édition
  const [formState, setFormState] = useState(null);

  const destinations = useMemo(
    () => (Array.isArray(client?.destinations) ? client.destinations : []),
    [client],
  );

  const items = useMemo(
    () => destinations.filter((d) => !pendingDeletes.has(d.id)),
    [destinations, pendingDeletes],
  );

  // Esc pour fermer (uniquement quand le sous-modal n'est pas ouvert)
  useEffect(() => {
    if (formState) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, formState]);

  const handleDelete = async (e, dest) => {
    e.stopPropagation();
    if (!client?.id || !dest?.id) return;
    const ok = window.confirm(
      `Supprimer "${dest.societe || "(sans nom)"}" du carnet de destinations ?`,
    );
    if (!ok) return;
    try {
      await deleteClientDestination(client.id, dest.id);
      setPendingDeletes((prev) => {
        const next = new Set(prev);
        next.add(dest.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["palette-clients"] });
    } catch (err) {
      setDeleteError(err?.message || "Erreur lors de la suppression");
    }
  };

  const handleEdit = (e, dest) => {
    e.stopPropagation();
    setFormState(dest);
  };

  const handleCreate = () => {
    setFormState("new");
  };

  return (
    <div className="carnet__modal-overlay" onClick={onClose}>
      <div
        className="carnet__modal carnet__modal--wide"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="carnet__modal-head">
          <h2 className="carnet__modal-title">
            Carnet d'adresses
            {client?.societe ? ` — ${client.societe}` : ""}
          </h2>
          <div className="carnet__modal-head-actions">
            <button
              type="button"
              className="carnet__add-btn carnet__add-btn--sm"
              onClick={handleCreate}
              title="Ajouter une destination au carnet"
            >
              <PlusIcon />
              <span>Ajouter une destination</span>
            </button>
            <button
              type="button"
              className="carnet__modal-close"
              onClick={onClose}
              aria-label="Fermer"
              title="Fermer"
            >
              ×
            </button>
          </div>
        </header>

        <div className="carnet__modal-body">
          <p className="carnet__modal-disclaimer">
            Destinations enregistrées automatiquement à partir des demandes
            de tarifs précédentes — vous pouvez aussi en ajouter manuellement,
            les modifier ou les supprimer ici.
          </p>
          <div className="carnet__modal-meta">
            ({items.length} destination{items.length > 1 ? "s" : ""})
          </div>

          {items.length === 0 ? (
            <p className="carnet__empty">
              Aucune destination enregistrée pour ce client. Les destinations
              seront ajoutées automatiquement à chaque génération de demande
              Excel.
            </p>
          ) : (
            <div className="carnet__modal-table-wrap">
              <table className="carnet__modal-table">
                <thead>
                  <tr>
                    <th>Société</th>
                    <th>Adresse</th>
                    <th>Ville</th>
                    <th>Contact</th>
                    <th className="carnet__th-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => {
                    const adresse = [d.adresse1, d.adresse2]
                      .filter(Boolean)
                      .join(" - ");
                    const cpVille = [d.cp, d.ville].filter(Boolean).join(" ");
                    const villeStr =
                      d.pays && d.pays !== "France"
                        ? `${cpVille} (${d.pays})`
                        : cpVille;
                    const contactStr = [d.contact, d.tel, d.email]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={d.id}>
                        <td>{d.societe || "—"}</td>
                        <td>{adresse || "—"}</td>
                        <td>{villeStr || "—"}</td>
                        <td>{contactStr || "—"}</td>
                        <td className="carnet__th-right">
                          <div className="carnet__row-actions">
                            <button
                              type="button"
                              className="carnet__icon-btn"
                              onClick={(e) => handleEdit(e, d)}
                              title="Modifier cette destination"
                              aria-label="Modifier"
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="carnet__icon-btn carnet__icon-btn--danger"
                              onClick={(e) => handleDelete(e, d)}
                              title="Supprimer cette destination"
                              aria-label="Supprimer"
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

          {deleteError && (
            <div className="carnet__error" role="alert">
              {deleteError}
            </div>
          )}
        </div>
      </div>

      {/* Sous-modal d'édition / création d'une destination */}
      {formState && (
        <DestinationFormModal
          clientId={client?.id}
          destination={formState === "new" ? null : formState}
          onClose={() => setFormState(null)}
          onSaved={() => {
            setFormState(null);
            queryClient.invalidateQueries({ queryKey: ["palette-clients"] });
          }}
        />
      )}
    </div>
  );
}

// =====================================================
// DestinationFormModal : formulaire création / édition d'une destination
// (même format/order que le modal client : Société → Adresse → CP/Ville/Pays
// → Contact/Tel/Email)
// destination = null  → mode création
// destination = {…}   → mode édition
// =====================================================
function DestinationFormModal({ clientId, destination, onClose, onSaved }) {
  const isEditing = Boolean(destination);
  const [form, setForm] = useState(() => ({
    societe: destination?.societe || "",
    adresse1: destination?.adresse1 || "",
    adresse2: destination?.adresse2 || "",
    cp: destination?.cp || "",
    ville: destination?.ville || "",
    pays: destination?.pays || "France",
    contact: destination?.contact || "",
    tel: destination?.tel || "",
    email: destination?.email || "",
  }));
  const [error, setError] = useState(null);

  // Esc pour fermer
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveMut = useMutation({
    mutationFn: ({ data }) =>
      isEditing
        ? updateClientDestination(clientId, destination.id, data)
        : createClientDestination(clientId, data),
    onSuccess: () => onSaved(),
    onError: (err) => setError(err?.response?.data?.error || err.message),
  });

  const setField = (field) => (value) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(null);
    if (!form.societe.trim()) return setError("Le champ 'société' est obligatoire.");
    if (!form.adresse1.trim()) return setError("Le champ 'adresse 1' est obligatoire.");
    if (!form.cp.trim()) return setError("Le code postal est obligatoire.");
    if (!form.ville.trim()) return setError("La ville est obligatoire.");
    saveMut.mutate({ data: form });
  };

  return (
    <div className="carnet__modal-overlay" onClick={onClose}>
      <div
        className="carnet__modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="carnet__modal-head">
          <h2 className="carnet__modal-title">
            {isEditing
              ? "Modifier la destination"
              : "Ajouter une destination"}
          </h2>
          <button
            type="button"
            className="carnet__modal-close"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer"
          >
            ×
          </button>
        </header>

        <form className="carnet__form" onSubmit={handleSubmit}>
          <div className="dp__grid">
            <UField
              label="Société"
              required
              value={form.societe}
              onChange={setField("societe")}
              size="full"
              autoFocus
            />
            <UField
              label="Adresse 1"
              required
              value={form.adresse1}
              onChange={setField("adresse1")}
              placeholder="N° et rue"
            />
            <UField
              label="Adresse 2"
              value={form.adresse2}
              onChange={setField("adresse2")}
              placeholder="Bâtiment, étage, complément…"
            />
            <UField
              label="Code postal"
              required
              value={form.cp}
              onChange={setField("cp")}
              size="small"
            />
            <UField
              label="Ville"
              required
              value={form.ville}
              onChange={setField("ville")}
              size="m4"
            />
            <UField
              label="Pays"
              value={form.pays}
              onChange={setField("pays")}
              size="m5"
            />
            <UField
              label="Contact"
              value={form.contact}
              onChange={setField("contact")}
              placeholder="Prénom Nom"
              size="m4"
            />
            <UField
              label="Téléphone"
              value={form.tel}
              onChange={setField("tel")}
              size="m4"
            />
            <UField
              label="Email"
              type="email"
              value={form.email}
              onChange={setField("email")}
              placeholder="contact@societe.com"
              size="m4"
            />
          </div>

          {error && (
            <div className="carnet__error" role="alert">
              {error}
            </div>
          )}

          <div className="carnet__form-actions">
            <button
              type="button"
              className="carnet__cancel-btn"
              onClick={onClose}
              disabled={saveMut.isPending}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="carnet__submit-btn"
              disabled={saveMut.isPending}
            >
              {saveMut.isPending
                ? "Enregistrement…"
                : isEditing
                  ? "Mettre à jour"
                  : "Ajouter au carnet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
