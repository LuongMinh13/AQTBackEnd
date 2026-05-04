import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteClientDestination,
  fetchPaletteRates,
  generateDemandePalette,
  listClients,
} from "../api/palettes";
import { COUNTRIES } from "../utils/countries";
import { lookupCitiesByCP } from "../utils/cityLookup";
import "../assets/Style/pages/DemandePalette.css";

// Options "nombre de palettes" pour le calcul tarifaire (correspondent aux lignes de la grille DHL)
const NB_PALETTES_OPTIONS = [
  { key: "0.5", label: "½" },
  { key: "1", label: "1" },
  { key: "2", label: "2" },
  { key: "3", label: "3" },
  { key: "4", label: "4" },
  { key: "5", label: "5" },
];

// Formatage nombre brut (2 décimales) — pour défaut éditable
const fmt2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");
const fmt1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "0.0");

const TVA = 1.2; // 20 %

// Extrait les 2 premiers chiffres d'un CP FR, padding 0 (ex: "7500" -> "75", "94200" -> "94")
function deptFromCP(cp) {
  if (!cp) return null;
  const digits = String(cp).replace(/\D/g, "");
  if (digits.length < 2) return null;
  return digits.slice(0, 2).padStart(2, "0");
}

// ----- Ligne palette par défaut -----
const emptyPalette = () => ({
  poids: "",
  dimensions: "",
});

// Nombre de lignes palette à afficher selon le sélecteur nb palettes
//   "0.5" (½) → 1 ligne, "1" → 1, "2" → 2, …, "5" → 5
function palletsCountFromKey(nbKey) {
  const n = Number(nbKey);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.ceil(n));
}

const emptyParty = () => ({
  societe: "",
  adresse1: "",
  adresse2: "",
  cp: "",
  ville: "",
  pays: "France",
  contact: "",
  tel: "",
  email: "",
});

// ----- Utilitaires contact -----
const fullNameFromContact = (c) =>
  [c?.prenom, c?.nom].filter((s) => s && String(s).trim()).join(" ");

// ----- Adresse de l'agent MBE par défaut -----
const AGENT_PARTY = {
  societe: "Centre MBE 3076",
  adresse1: "56 Bd Courcerin",
  adresse2: "Bat 13/14",
  cp: "77183",
  ville: "Croissy-Beaubourg",
  pays: "France",
  contact: "Alexis Weber",
  tel: "01 88 60 36 42",
  email: "mbe3076@mbefrance.fr",
};

// Renvoie la liste des contacts d'un client (utilise client.contacts si défini,
// sinon fabrique un seul contact à partir des champs racine).
function getClientContacts(client) {
  if (!client) return [];
  if (Array.isArray(client.contacts) && client.contacts.length > 0) {
    return client.contacts;
  }
  const fallback = {
    nom: client.nom || "",
    prenom: client.prenom || "",
    email: client.email || "",
    tel: client.tel || "",
  };
  if (fallback.nom || fallback.prenom || fallback.email || fallback.tel) {
    return [fallback];
  }
  return [];
}

// Petite flèche pour collapse
function Chevron({ open }) {
  return (
    <svg
      className={`dp__chev ${open ? "dp__chev--open" : ""}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// Résumé compact d'un tiers (ligne sous le titre du module)
function partySummary(p) {
  if (!p?.societe) return "";
  const right = [p.adresse1, [p.cp, p.ville].filter(Boolean).join(" "), p.pays]
    .filter(Boolean)
    .join(" - ");
  return right ? `${p.societe} - ${right}` : p.societe;
}

export default function DemandePalette() {
  // ---------- Navigation : duplication depuis l'historique ----------
  // Quand on arrive ici depuis la page Historique avec
  // location.state = { duplicateFrom: payload }, on pré-remplit le formulaire.
  const location = useLocation();
  const navigate = useNavigate();
  const duplicateFrom = location.state?.duplicateFrom || null;

  // ---------- Recherche client ----------
  const [clientQuery, setClientQuery] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestRef = useRef(null);

  // ---------- Données ----------
  // Initialisation conditionnelle si on arrive en mode "Dupliquer" : on pré-remplit
  // immédiatement enlevement / livraison / palettes à partir du payload sauvegardé.
  const [client, setClient] = useState(null); // tiers verrouillé
  const [enlevement, setEnlevement] = useState(() =>
    duplicateFrom?.enlevement
      ? { ...emptyParty(), ...duplicateFrom.enlevement }
      : emptyParty(),
  );
  const [livraison, setLivraison] = useState(() =>
    duplicateFrom?.livraison
      ? { ...emptyParty(), ...duplicateFrom.livraison }
      : emptyParty(),
  );
  const [palettes, setPalettes] = useState(() => {
    const dupPals = duplicateFrom?.palettes;
    if (Array.isArray(dupPals) && dupPals.length > 0) {
      return dupPals.map((p) => ({
        poids: p?.poids != null ? String(p.poids) : "",
        dimensions: p?.dimensions || "",
      }));
    }
    return [emptyPalette()];
  });

  // ---------- UI : sections ouvertes / fermées ----------
  const [open, setOpen] = useState({
    client: true,
    expediteur: true,
    destinataire: true,
    palettes: true,
  });
  const toggle = (k) => setOpen((s) => ({ ...s, [k]: !s[k] }));

  // ---------- UI : validation ----------
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState(null);

  // ---------- Carnet clients ----------
  const queryClient = useQueryClient();
  const { data: clients = [] } = useQuery({
    queryKey: ["palette-clients"],
    queryFn: listClients,
  });

  // Garde state.client en synchro avec la liste lorsqu'elle est rafraîchie
  // (notamment pour récupérer la liste destinations[] mise à jour après une
  // génération de demande).
  useEffect(() => {
    if (!client?.id) return;
    const fresh = clients.find((c) => c.id === client.id);
    if (!fresh) return;
    setClient((prev) =>
      prev && prev.id === fresh.id
        ? {
            ...prev,
            destinations: fresh.destinations || [],
            contacts: fresh.contacts || prev.contacts,
          }
        : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  // ---------- Hydratation depuis l'Historique (Dupliquer) ----------
  // Quand on arrive depuis la page Historique avec un payload, on (re)verrouille
  // le client correspondant dès que la liste est disponible. On ne le fait
  // qu'une seule fois (ref) puis on efface le state de navigation pour éviter
  // que les modifications ultérieures soient écrasées si l'utilisateur recharge.
  const duplicateAppliedRef = useRef(false);
  useEffect(() => {
    if (!duplicateFrom) return;
    if (duplicateAppliedRef.current) return;
    if (!Array.isArray(clients) || clients.length === 0) return;

    const targetId = duplicateFrom.clientId;
    const fromSociete = duplicateFrom.enlevement?.societe;
    const found =
      (targetId && clients.find((c) => c.id === targetId)) ||
      (fromSociete &&
        clients.find(
          (c) =>
            (c.societe || "").toLowerCase() === fromSociete.toLowerCase(),
        )) ||
      null;

    if (found) {
      const fullName = [found.nom, found.prenom]
        .filter((s) => s && s.trim())
        .join(" ");
      const partyFields = {
        societe: found.societe || "",
        adresse1: found.adresse1 || "",
        adresse2: found.adresse2 || "",
        cp: found.cp || "",
        ville: found.ville || "",
        pays: found.pays || "France",
        contact: fullName,
        tel: found.tel || "",
        email: found.email || "",
      };
      setClient({ ...found, ...partyFields });
      // Conserve l'expéditeur exact tel qu'envoyé à l'époque (peut différer
      // de la fiche client si l'utilisateur l'avait modifié).
      // Le state initial a déjà été pré-rempli depuis duplicateFrom.enlevement.
      setClientQuery(partyFields.societe);
      setOpen((s) => ({ ...s, client: false }));
    }

    duplicateAppliedRef.current = true;
    // Nettoie le state de navigation pour éviter de ré-appliquer sur reload
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, duplicateFrom]);

  // ---------- Grille tarifaire (77 / 94) ----------
  const { data: rates } = useQuery({
    queryKey: ["palette-rates"],
    queryFn: fetchPaletteRates,
    staleTime: 10 * 60 * 1000, // 10 min
  });

  // ---------- Calcul tarif (sidebar) ----------
  // Si on arrive en mode "Dupliquer", on aligne nbPalettes sur la longueur du
  // tableau dupliqué (clamp 1..5). Sinon, valeur par défaut "1".
  const [nbPalettes, setNbPalettes] = useState(() => {
    const dup = duplicateFrom?.palettes;
    if (Array.isArray(dup) && dup.length > 0) {
      const n = Math.min(5, Math.max(1, dup.length));
      return String(n);
    }
    return "1";
  });
  const [margeTotalPct, setMargeTotalPct] = useState(15); // marge totale (master, source unique)
  // Si toutes les palettes dupliquées sont gerbables, on coche le toggle global.
  const [globalGerbable, setGlobalGerbable] = useState(() => {
    const dup = duplicateFrom?.palettes;
    if (Array.isArray(dup) && dup.length > 0) {
      return dup.every((p) => Boolean(p?.gerbable));
    }
    return false;
  });

  // ---------- Palettes : saisie simplifiée ----------
  // Détection : si toutes les palettes dupliquées partagent les mêmes
  // poids/dimensions, on garde le mode "identiques" (sinon on bascule).
  const [palettesIdentiques, setPalettesIdentiques] = useState(() => {
    const dup = duplicateFrom?.palettes;
    if (!Array.isArray(dup) || dup.length <= 1) return true;
    const first = dup[0];
    return dup.every(
      (p) =>
        String(p?.poids ?? "") === String(first?.poids ?? "") &&
        String(p?.dimensions ?? "") === String(first?.dimensions ?? ""),
    );
  });

  // Wrapper qui synchronise la longueur de `palettes` avec le nb choisi
  const handleNbPalettesChange = (key) => {
    setNbPalettes(key);
    const target = palletsCountFromKey(key);
    setPalettes((prev) => {
      if (prev.length === target) return prev;
      if (prev.length < target) {
        const add = Array.from(
          { length: target - prev.length },
          emptyPalette,
        );
        return [...prev, ...add];
      }
      return prev.slice(0, target);
    });
  };

  const tarifCalc = useMemo(() => {
    const margeTotal = Number(margeTotalPct) || 0;

    const mkDefault = (overrides = {}) => ({
      departDept: null,
      destDept: null,
      fuelPct: 0,
      coutHT: 0,
      fuel: 0,
      coutTotal: 0,
      margeTotal,
      prixHT: 0,
      prixTTC: 0,
      prixTotalHT: 0,
      prixTotalTTC: 0,
      ...overrides,
    });

    if (!rates) return { status: "loading", ...mkDefault() };

    const departDept = deptFromCP(enlevement.cp);
    const destDept = deptFromCP(livraison.cp);
    const fuelPct = Number(rates.fuel_surcharge_pct) || 0;

    // Exigence : si expéditeur ≠ 77 ou 94, on affiche 0 + message d'erreur
    if (departDept !== "77" && departDept !== "94") {
      return {
        status: "error",
        message:
          "CP expéditeur incompatible : seules les grilles au départ de 77 et 94 sont disponibles.",
        ...mkDefault({ departDept, destDept, fuelPct }),
      };
    }

    const grid = rates.depart?.[departDept];
    if (!grid) {
      return {
        status: "error",
        message: `Grille ${departDept} introuvable.`,
        ...mkDefault({ departDept, destDept, fuelPct }),
      };
    }

    if (!destDept) {
      return {
        status: "pending-dest",
        message: "Saisir le CP destinataire pour calculer le tarif.",
        ...mkDefault({ departDept, destDept: null, fuelPct }),
      };
    }

    const zonePrices = grid[destDept];
    if (!zonePrices) {
      return {
        status: "error",
        message: `Aucun tarif pour le département ${destDept} au départ du ${departDept}.`,
        ...mkDefault({ departDept, destDept, fuelPct }),
      };
    }

    // Coûts
    const coutHT = Number(zonePrices[nbPalettes]) || 0;
    const fuel = coutHT * (fuelPct / 100);
    const coutTotal = coutHT + fuel;

    // Prix de vente — piloté par la marge totale (source unique)
    const prixHT = coutTotal * (1 + margeTotal / 100);
    const prixTTC = prixHT * TVA;
    // Sans MBE, prix total = prix transport
    const prixTotalHT = prixHT;
    const prixTotalTTC = prixTTC;

    return {
      status: "ok",
      departDept,
      destDept,
      fuelPct,
      coutHT,
      fuel,
      coutTotal,
      margeTotal,
      prixHT,
      prixTTC,
      prixTotalHT,
      prixTotalTTC,
    };
  }, [rates, enlevement.cp, livraison.cp, nbPalettes, margeTotalPct]);

  // ----- Handlers sync bidirectionnelle : tout se ramène à margeTotalPct -----
  // (on ne peut recalculer la marge que si coutTotal > 0)
  const setPrixHTFromInput = (val) => {
    const v = Number(val);
    if (!Number.isFinite(v)) return;
    const ct = tarifCalc.coutTotal;
    if (ct > 0) setMargeTotalPct((v / ct - 1) * 100);
  };

  const setPrixTTCFromInput = (val) => {
    const v = Number(val);
    if (!Number.isFinite(v)) return;
    const ct = tarifCalc.coutTotal;
    if (ct > 0) setMargeTotalPct((v / TVA / ct - 1) * 100);
  };

  const setMargeFromInput = (val) => {
    const v = Number(val);
    if (Number.isFinite(v)) setMargeTotalPct(v);
  };

  const suggestions = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return [];
    return clients
      .filter((c) => (c.societe || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [clientQuery, clients]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ---------- Sélection / réinitialisation client ----------
  const handlePickClient = (c) => {
    // contact = "Nom Prenom" (concaténé). Vide si les deux sont absents.
    const fullName = [c.nom, c.prenom].filter((s) => s && s.trim()).join(" ");
    const partyFields = {
      societe: c.societe || "",
      adresse1: c.adresse1 || "",
      adresse2: c.adresse2 || "",
      cp: c.cp || "",
      ville: c.ville || "",
      pays: c.pays || "France",
      contact: fullName,
      tel: c.tel || "",
      email: c.email || "",
    };
    // On conserve l'objet client complet (id, contacts[], destinations[]…)
    // par-dessus on superpose les champs party formatés pour l'affichage.
    setClient({ ...c, ...partyFields });
    setEnlevement(partyFields); // pré-rempli, restera modifiable
    setClientQuery(partyFields.societe);
    setShowSuggest(false);
    // Module Client se replie automatiquement après sélection
    setOpen((s) => ({ ...s, client: false }));
  };

  const clearClient = () => {
    setClient(null);
    setEnlevement(emptyParty());
    setClientQuery("");
  };

  // ---------- Mutation génération ----------
  const generateMutation = useMutation({
    mutationFn: generateDemandePalette,
    onError: (err) => {
      setFormError(err?.message || "Erreur lors de la génération");
    },
    onSuccess: () => {
      setFormError(null);
      // Le backend a mis à jour le carnet de destinations du client :
      // on rafraîchit la liste pour récupérer la nouvelle destination.
      queryClient.invalidateQueries({ queryKey: ["palette-clients"] });
    },
  });

  // ---------- Handlers palettes ----------
  const updatePalette = (idx, patch) => {
    setPalettes((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  };

  // ---------- Validation ----------
  const partyOk = (p) => p.societe && p.adresse1 && p.cp && p.ville;

  // Palettes à envoyer en sortie : si "identiques", on recopie la palette #1 sur toutes.
  const effectivePalettes = useMemo(() => {
    if (!palettes.length) return [];
    if (palettesIdentiques) {
      const first = palettes[0];
      return palettes.map(() => ({
        poids: first.poids,
        dimensions: first.dimensions,
      }));
    }
    return palettes;
  }, [palettes, palettesIdentiques]);

  const canSubmit = useMemo(() => {
    if (!client) return false;
    if (!partyOk(enlevement) || !partyOk(livraison)) return false;
    if (!effectivePalettes.length) return false;
    for (const p of effectivePalettes) {
      const poidsNum = Number(p.poids);
      if (!Number.isFinite(poidsNum) || poidsNum <= 0) return false;
      if (!p.dimensions?.trim()) return false;
    }
    return true;
  }, [client, enlevement, livraison, effectivePalettes]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (!client) {
      setFormError("Sélectionnez un client via la barre de recherche.");
      setOpen((s) => ({ ...s, client: true }));
      return;
    }
    if (!canSubmit) {
      setFormError("Merci de remplir tous les champs obligatoires.");
      setOpen({ client: true, expediteur: true, destinataire: true, palettes: true });
      return;
    }
    generateMutation.mutate({
      // Identifiant du client sélectionné — utilisé côté serveur pour
      // attacher la destination au carnet du bon client.
      clientId: client?.id,
      enlevement,
      livraison,
      palettes: effectivePalettes.map((p) => ({
        poids: Number(p.poids),
        dimensions: p.dimensions.trim(),
        gerbable: Boolean(globalGerbable),
      })),
      // Bloc tarif (coût HT + surcharge carburant) pour remplir
      // la zone "Autres Frais / Total Transport" du template DHL.
      tarif: {
        coutHT: tarifCalc?.coutHT ?? 0,
        fuel: tarifCalc?.fuel ?? 0,
        coutTotal: tarifCalc?.coutTotal ?? 0,
      },
    });
  };

  // ---------- Champs réutilisables ----------
  // kind = "client" | "expediteur" | "destinataire"
  // Détermine le comportement de la loupe : contacts du client (par défaut)
  // ou carnet des destinations sauvegardées (mode "destinataire").
  const renderPartyFields = ({ values, onChange, locked, kind = "expediteur" }) => (
    <PartyFields
      values={values}
      onChange={onChange}
      locked={locked}
      client={client}
      kind={kind}
    />
  );

  // ---------- Rendu ----------
  return (
    <div className="dp">
      <header className="dp__header">
        <h1 className="dp__title">Nouvelle demande de tarifs</h1>
        <p className="dp__subtitle">
          Sélectionnez un client puis renseignez la livraison et les palettes
          pour générer le fichier Excel à envoyer à DHL Freight.
        </p>
      </header>

      <div className="dp__layout">
      <form className="dp__form dp__form--main" onSubmit={handleSubmit} noValidate>
        {/* ============== Barre de recherche CLIENT ============== */}
        <div className="dp__searchbar" ref={suggestRef}>
          <label className="dp__searchbar-label">CLIENT</label>
          <div className="dp__searchbar-wrap">
            <input
              type="text"
              className={`dp__searchbar-input ${
                !client ? "dp__searchbar-input--invalid" : ""
              }`}
              value={clientQuery}
              onChange={(e) => {
                setClientQuery(e.target.value);
                setShowSuggest(true);
                if (client && e.target.value !== client.societe) {
                  // Tant qu'on n'a pas re-sélectionné, on annule le verrou
                  setClient(null);
                }
              }}
              onFocus={() => setShowSuggest(true)}
              placeholder="Rechercher un client…"
              autoComplete="off"
            />
            {client && (
              <button
                type="button"
                className="dp__searchbar-clear"
                onClick={clearClient}
                title="Changer de client"
                aria-label="Effacer la sélection"
              >
                ×
              </button>
            )}
            {showSuggest && suggestions.length > 0 && (
              <ul className="dp__suggest">
                {suggestions.map((c) => (
                  <li key={c.id || c.societe}>
                    <button
                      type="button"
                      className="dp__suggest-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handlePickClient(c)}
                    >
                      <span className="dp__suggest-societe">{c.societe}</span>
                      <span className="dp__suggest-adresse">
                        {[
                          c.adresse1,
                          [c.cp, c.ville].filter(Boolean).join(" "),
                          c.pays,
                        ]
                          .filter(Boolean)
                          .join(" - ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!client && (
            <span className="dp__inline-err">Ce champ est obligatoire !</span>
          )}
        </div>

        {/* ============== Module CLIENT (verrouillé) ============== */}
        <Section
          title="Client"
          summary={client ? partySummary(client) : ""}
          accent="red"
          open={open.client}
          onToggle={() => toggle("client")}
        >
          {!client ? (
            <p className="dp__empty">
              Sélectionnez un client dans la barre de recherche ci-dessus.
            </p>
          ) : (
            renderPartyFields({
              values: client,
              onChange: () => {}, // verrouillé
              locked: true,
              kind: "client",
            })
          )}
        </Section>

        {/* ============== Module EXPÉDITEUR (modifiable) ============== */}
        <Section
          title="Expéditeur"
          summary={partySummary(enlevement)}
          accent="red"
          open={open.expediteur}
          onToggle={() => toggle("expediteur")}
        >
          {!client ? (
            <p className="dp__empty">
              Sélectionnez d'abord un client. L'expéditeur sera pré-rempli puis
              modifiable.
            </p>
          ) : (
            renderPartyFields({
              values: enlevement,
              onChange: setEnlevement,
              locked: false,
              kind: "expediteur",
            })
          )}
        </Section>

        {/* ============== Module DESTINATAIRE ============== */}
        <Section
          title="Destinataire"
          summary={partySummary(livraison)}
          accent="red"
          open={open.destinataire}
          onToggle={() => toggle("destinataire")}
        >
          {renderPartyFields({
            values: livraison,
            onChange: setLivraison,
            locked: false,
            kind: "destinataire",
          })}
        </Section>

        {/* ============== Module PALETTES ============== */}
        <Section
          title={`Palettes (${palettes.length})`}
          accent="red"
          open={open.palettes}
          onToggle={() => toggle("palettes")}
          headerRight={
            <label
              className="dp__palette-identique"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={palettesIdentiques}
                onChange={(e) => setPalettesIdentiques(e.target.checked)}
              />
              <span>Palettes identiques</span>
            </label>
          }
        >
          <div className="dp__palettes dp__palettes--compact">
            {(palettesIdentiques ? palettes.slice(0, 1) : palettes).map(
              (p, idx) => (
                <div key={idx} className="dp__palette-row dp__palette-row--inline">
                  <span className="dp__palette-idx">
                    {palettesIdentiques && palettes.length > 1
                      ? `×${palettes.length}`
                      : `#${idx + 1}`}
                  </span>

                  <Field
                    label="Poids (kg)"
                    required
                    type="number"
                    value={p.poids}
                    onChange={(v) => updatePalette(idx, { poids: v })}
                    submitted={submitted}
                    inputProps={{ min: "0", step: "0.1" }}
                  />

                  <Field
                    label="Dimensions"
                    required
                    value={p.dimensions}
                    onChange={(v) => updatePalette(idx, { dimensions: v })}
                    submitted={submitted}
                    placeholder="100x80x160"
                  />
                </div>
              ),
            )}
          </div>
        </Section>

        {formError && (
          <div className="dp__error" role="alert">
            {formError}
          </div>
        )}

        <div className="dp__actions">
          <button
            type="submit"
            className="dp__submit-btn"
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending
              ? "Génération en cours…"
              : "Générer la demande Excel"}
          </button>
        </div>
      </form>

      <aside className="dp__calc" aria-label="Calcul tarif">
        <TarifSidebar
          calc={tarifCalc}
          nbPalettes={nbPalettes}
          onNbPalettesChange={handleNbPalettesChange}
          gerbable={globalGerbable}
          onGerbableChange={setGlobalGerbable}
          onPrixHTChange={setPrixHTFromInput}
          onPrixTTCChange={setPrixTTCFromInput}
          onMargeChange={setMargeFromInput}
        />
      </aside>
      </div>
    </div>
  );
}

// =====================================================
// TarifSidebar : panneau droit calcul tarif DHL
// =====================================================

// Champ éditable "label flottant + valeur soulignée" (type screenshot utilisateur)
// - defaultValue + key : évite de perturber la saisie utilisateur,
//   mais resynchronise quand la source change (nouveau CP, nouvelle marge, etc.)
// - commit sur blur + touche Entrée
function EditableMoney({
  id,
  label,
  value,
  disabled = false,
  onCommit,
  suffix = "€",
  strong = false,
}) {
  const numericVal = Number.isFinite(value) ? value : 0;
  const strVal = fmt2(numericVal);
  const cls = [
    "dp__pcf",
    disabled && "dp__pcf--disabled",
    strong && "dp__pcf--strong",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <label htmlFor={id} className="dp__pcf-label">
        {label}
      </label>
      <div className="dp__pcf-inputwrap">
        <input
          id={id}
          key={`${id}-${strVal}`}
          type="number"
          min="0"
          step="0.01"
          defaultValue={strVal}
          disabled={disabled}
          className="dp__pcf-input"
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.currentTarget.select()}
          onBlur={(e) => onCommit?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        <span className="dp__pcf-suffix">{suffix}</span>
      </div>
    </div>
  );
}

// Champ readonly type "ticker" (PRIX TOTAL HT/TTC, COÛT TOTAL…)
function ReadonlyMoney({ label, value, strong = false }) {
  return (
    <div className={`dp__pcf dp__pcf--ro ${strong ? "dp__pcf--strong" : ""}`}>
      <span className="dp__pcf-label">{label}</span>
      <div className="dp__pcf-inputwrap">
        <span className="dp__pcf-input dp__pcf-input--ro">
          {fmt2(Number.isFinite(value) ? value : 0)}
        </span>
        <span className="dp__pcf-suffix">€</span>
      </div>
    </div>
  );
}

// Champ éditable pourcentage (marge expé)
function EditablePct({ id, label, value, disabled = false, onCommit }) {
  const v = Number.isFinite(value) ? value : 0;
  const strVal = fmt1(v);
  return (
    <div className={`dp__pcf ${disabled ? "dp__pcf--disabled" : ""}`}>
      <label htmlFor={id} className="dp__pcf-label">
        {label}
      </label>
      <div className="dp__pcf-inputwrap">
        <input
          id={id}
          key={`${id}-${strVal}`}
          type="number"
          step="0.1"
          defaultValue={strVal}
          disabled={disabled}
          className="dp__pcf-input"
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.currentTarget.select()}
          onBlur={(e) => onCommit?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        <span className="dp__pcf-suffix">%</span>
      </div>
    </div>
  );
}

function TarifSidebar({
  calc,
  nbPalettes,
  onNbPalettesChange,
  gerbable,
  onGerbableChange,
  onPrixHTChange,
  onPrixTTCChange,
  onMargeChange,
}) {
  const loading = calc.status === "loading";
  const pending = calc.status === "pending-dest";
  const error = calc.status === "error";

  // Inputs PRIX / MARGE désactivés tant qu'on n'a pas un coutTotal > 0
  const editDisabled = !(calc.coutTotal > 0);

  return (
    <div className="dp__calc-card">
      <div className="dp__calc-head">
        <h3 className="dp__calc-title">Calcul tarif</h3>
      </div>

      {/* Sélecteur nb palettes */}
      <div className="dp__calc-block">
        <div className="dp__calc-block-label">Nombre de palettes</div>
        <div className="dp__calc-pal-grid">
          {NB_PALETTES_OPTIONS.map((opt) => {
            const isSel = nbPalettes === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                className={`dp__calc-pal-btn ${
                  isSel ? "dp__calc-pal-btn--sel" : ""
                }`}
                onClick={() => onNbPalettesChange(opt.key)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <label className="dp__calc-gerbable">
          <input
            type="checkbox"
            checked={Boolean(gerbable)}
            onChange={(e) => onGerbableChange(e.target.checked)}
          />
          <span>Gerbable</span>
        </label>
      </div>

      {/* ============ Bloc PRIX (Prix HT/TTC éditables ; Prix total HT/TTC en lecture seule, pilotés par margeTotal) ============ */}
      <div className="dp__calc-pricegrid">
        <EditableMoney
          id="dp-prix-ht"
          label="Prix HT"
          value={calc.prixHT}
          disabled={editDisabled}
          onCommit={onPrixHTChange}
        />
        <EditableMoney
          id="dp-prix-ttc"
          label="Prix TTC"
          value={calc.prixTTC}
          disabled={editDisabled}
          onCommit={onPrixTTCChange}
        />
        <ReadonlyMoney
          label="Prix total HT"
          value={calc.prixTotalHT}
        />
        <ReadonlyMoney
          label="Prix total TTC"
          value={calc.prixTotalTTC}
        />
      </div>

      {/* ============ Bloc COÛTS + MARGE TOTALE ============ */}
      <div className="dp__calc-costgrid">
        <ReadonlyMoney label="Coût HT" value={calc.coutHT} />
        <ReadonlyMoney
          label={`Supplément carburant${calc.fuelPct ? ` (${fmt1(calc.fuelPct)} %)` : ""}`}
          value={calc.fuel}
        />
        <ReadonlyMoney label="Coût total" value={calc.coutTotal} />
        <EditablePct
          id="dp-marge-total"
          label="% Marge total"
          value={calc.margeTotal}
          disabled={editDisabled}
          onCommit={onMargeChange}
        />
      </div>

      {/* Messages d'état */}
      {loading && (
        <div className="dp__calc-msg dp__calc-msg--info">
          Chargement de la grille tarifaire…
        </div>
      )}
      {error && (
        <div className="dp__calc-msg dp__calc-msg--err" role="alert">
          {calc.message}
        </div>
      )}
      {pending && (
        <div className="dp__calc-msg dp__calc-msg--info">{calc.message}</div>
      )}
    </div>
  );
}

// =====================================================
// Composant Section : entête colorée + chevron + collapse
// =====================================================
function Section({
  title,
  summary,
  accent = "red",
  open,
  onToggle,
  headerRight,
  children,
}) {
  return (
    <section className={`dp__section dp__section--${accent}`}>
      <button
        type="button"
        className="dp__section-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="dp__section-title">{title}{summary ? " :" : ""}</span>
        {summary && <span className="dp__section-summary">{summary}</span>}
        <span className="dp__section-spacer" />
        {headerRight && (
          <span
            className="dp__section-headerRight"
            onClick={(e) => e.stopPropagation()}
          >
            {headerRight}
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && <div className="dp__section-body">{children}</div>}
    </section>
  );
}

// =====================================================
// Champ générique : label flottant + input souligné
// =====================================================
// =====================================================
// PartyFields : agrégat des champs d'un tiers (avec Pays combobox + CP→Ville)
// =====================================================
function PartyFields({ values, onChange, locked, client, kind = "expediteur" }) {
  const set = (patch) => onChange({ ...values, ...patch });
  const [contactsOpen, setContactsOpen] = useState(false);
  const [destinationsOpen, setDestinationsOpen] = useState(false);

  const contacts = useMemo(() => getClientContacts(client), [client]);
  const destinations = useMemo(
    () => (Array.isArray(client?.destinations) ? client.destinations : []),
    [client],
  );
  const hasClient = Boolean(client);
  const isDestinataire = kind === "destinataire";

  // Loupe (mode expéditeur) : remplit uniquement le bloc contact
  const handlePickContact = (c) => {
    set({
      contact: fullNameFromContact(c),
      email: c.email || "",
      tel: c.tel || "",
    });
    setContactsOpen(false);
  };

  // Loupe (mode destinataire) : remplit toute la section avec une destination
  // sauvegardée du client (société + adresse + contact).
  const handlePickDestination = (d) => {
    onChange({
      societe: d.societe || "",
      adresse1: d.adresse1 || "",
      adresse2: d.adresse2 || "",
      cp: d.cp || "",
      ville: d.ville || "",
      pays: d.pays || "France",
      contact: d.contact || "",
      tel: d.tel || "",
      email: d.email || "",
    });
    setDestinationsOpen(false);
  };

  // Comportement de la loupe selon le contexte
  const loupeLabel = isDestinataire
    ? "Choisir une destination enregistrée"
    : "Choisir un contact du client";
  const loupeDisabled = isDestinataire
    ? !hasClient || destinations.length === 0
    : !hasClient || contacts.length === 0;
  const handleLoupeClick = isDestinataire
    ? () => setDestinationsOpen(true)
    : () => setContactsOpen(true);

  // Profil : ré-injecte toutes les données du client (société + adresse + contact principal)
  const handleResetFromClient = () => {
    if (!client) return;
    const main = (Array.isArray(client.contacts) && client.contacts[0]) || {
      nom: client.nom,
      prenom: client.prenom,
      email: client.email,
      tel: client.tel,
    };
    onChange({
      societe: client.societe || "",
      adresse1: client.adresse1 || "",
      adresse2: client.adresse2 || "",
      cp: client.cp || "",
      ville: client.ville || "",
      pays: client.pays || "France",
      contact: fullNameFromContact(main),
      tel: main?.tel || "",
      email: main?.email || "",
    });
  };

  // Maison : remplit avec l'adresse de notre agent MBE
  const handleFillAgent = () => {
    onChange({ ...AGENT_PARTY });
  };

  // Gomme : vide tout sauf le pays par défaut
  const handleClearAll = () => {
    onChange({
      societe: "",
      adresse1: "",
      adresse2: "",
      cp: "",
      ville: "",
      pays: "France",
      contact: "",
      tel: "",
      email: "",
    });
  };

  return (
    <div className="dp__grid">
      {/* Ligne 1 : Société + barre d'actions (loupe / profil / gomme) */}
      <Field label="Société" required value={values.societe}
        onChange={(v) => set({ societe: v })} locked={locked} m9 />
      {!locked && (
        <div className="dp__row-actions" role="group" aria-label="Actions tiers">
          <IconButton
            label={loupeLabel}
            onClick={handleLoupeClick}
            disabled={loupeDisabled}
          >
            <SearchIcon />
          </IconButton>
          <IconButton
            label="Pré-remplir avec le client"
            onClick={handleResetFromClient}
            disabled={!hasClient}
          >
            <UserIcon />
          </IconButton>
          <IconButton
            label="Pré-remplir avec l'adresse de l'agent MBE"
            onClick={handleFillAgent}
          >
            <HomeIcon />
          </IconButton>
          <IconButton
            label="Vider le formulaire"
            onClick={handleClearAll}
          >
            <EraserIcon />
          </IconButton>
        </div>
      )}
      {locked && <div className="dp__row-actions dp__row-actions--placeholder" />}

      {/* Ligne 2 : Adresse 1 + Adresse 2 */}
      <Field label="Adresse 1" required value={values.adresse1}
        onChange={(v) => set({ adresse1: v })} locked={locked}
        placeholder="N° et rue" />
      <Field label="Adresse 2" value={values.adresse2}
        onChange={(v) => set({ adresse2: v })} locked={locked}
        placeholder="Bâtiment, étage, complément…" />

      {/* Ligne 3 : Code postal + Ville + Pays */}
      <PostalCodeField
        value={values.cp}
        country={values.pays || "France"}
        locked={locked}
        onChange={(v) => set({ cp: v })}
        onPickCity={(ville) => set({ ville })}
      />
      <Field label="Ville" required value={values.ville}
        onChange={(v) => set({ ville: v })} locked={locked} m4 />
      <CountryField
        value={values.pays}
        onChange={(v) => set({ pays: v })}
        locked={locked}
      />

      {/* Ligne 4 : Contact + Téléphone + Email */}
      <Field label="Contact" value={values.contact}
        onChange={(v) => set({ contact: v })} locked={locked} m4 />
      <Field label="Téléphone" value={values.tel}
        onChange={(v) => set({ tel: v })} locked={locked} m4 />
      <Field label="Email" type="email" value={values.email}
        onChange={(v) => set({ email: v })} locked={locked} m4
        placeholder="contact@societe.com" />

      {contactsOpen && (
        <ContactsPickerModal
          societe={client?.societe}
          contacts={contacts}
          onPick={handlePickContact}
          onClose={() => setContactsOpen(false)}
        />
      )}

      {destinationsOpen && (
        <DestinationsPickerModal
          clientId={client?.id}
          societe={client?.societe}
          destinations={destinations}
          onPick={handlePickDestination}
          onClose={() => setDestinationsOpen(false)}
        />
      )}
    </div>
  );
}

// =====================================================
// Petite barre d'icônes (loupe / profil / gomme)
// =====================================================
function IconButton({ label, onClick, disabled = false, children }) {
  return (
    <button
      type="button"
      className="dp__icon-btn"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V10.5Z" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M3 17l6 6 12-12-6-6L3 17z" />
      <path d="M9 23h12" />
    </svg>
  );
}

// =====================================================
// ContactsPickerModal : popup choix d'un contact du client
// =====================================================
function ContactsPickerModal({ societe, contacts, onClose, onPick }) {
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dp__modal-overlay" onClick={onClose}>
      <div
        className="dp__modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dp__modal-close"
          onClick={onClose}
          aria-label="Fermer"
        >
          ×
        </button>
        <h2 className="dp__modal-title">Sélection du contact</h2>
        {societe && (
          <p className="dp__modal-disclaimer">
            Choisissez un contact pour <strong>{societe}</strong>. Le nom, l'email
            et le téléphone seront recopiés dans la section.
          </p>
        )}
        <div className="dp__modal-meta">
          (1-{contacts.length}/{contacts.length})
        </div>
        <div className="dp__modal-table-wrap">
          <table className="dp__modal-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th className="dp__th-right">Téléphone</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => {
                const name = fullNameFromContact(c) || "—";
                const isSel = hovered === i;
                return (
                  <tr
                    key={`${c.email || ""}-${c.tel || ""}-${i}`}
                    className={isSel ? "dp__row--selected" : ""}
                    onMouseEnter={() => setHovered(i)}
                    onClick={() => onPick(c)}
                  >
                    <td>{name}</td>
                    <td>{c.email || ""}</td>
                    <td className="dp__th-right">{c.tel || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// DestinationsPickerModal : popup carnet des destinations sauvegardées
// =====================================================
function DestinationsPickerModal({
  clientId,
  societe,
  destinations,
  onClose,
  onPick,
}) {
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState(null);
  // On masque localement les destinations en cours de suppression pour avoir
  // un feedback UI instantané, sans dupliquer la liste source. Lorsque la
  // requête `palette-clients` est rafraîchie, la prop `destinations` est mise
  // à jour et le filtre devient un no-op naturellement.
  const [pendingDeletes, setPendingDeletes] = useState(() => new Set());
  const [deleteError, setDeleteError] = useState(null);

  const items = useMemo(
    () => (destinations || []).filter((d) => !pendingDeletes.has(d.id)),
    [destinations, pendingDeletes],
  );

  // Esc pour fermer
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleDelete = async (e, dest) => {
    e.stopPropagation();
    if (!clientId || !dest?.id) return;
    const ok = window.confirm(
      `Supprimer "${dest.societe || "(sans nom)"}" du carnet de destinations ?`,
    );
    if (!ok) return;
    try {
      await deleteClientDestination(clientId, dest.id);
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

  return (
    <div className="dp__modal-overlay" onClick={onClose}>
      <div
        className="dp__modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dp__modal-close"
          onClick={onClose}
          aria-label="Fermer"
        >
          ×
        </button>
        <h2 className="dp__modal-title">Carnet des destinations</h2>
        {societe && (
          <p className="dp__modal-disclaimer">
            Destinations enregistrées à partir des demandes précédentes pour{" "}
            <strong>{societe}</strong>. Cliquez sur une ligne pour pré-remplir le
            module destinataire.
          </p>
        )}
        <div className="dp__modal-meta">
          (1-{items.length}/{items.length})
        </div>

        {items.length === 0 ? (
          <p className="dp__empty">
            Aucune destination enregistrée pour ce client. Elle sera ajoutée
            automatiquement à la prochaine génération de demande.
          </p>
        ) : (
          <div className="dp__modal-table-wrap">
            <table className="dp__modal-table">
              <thead>
                <tr>
                  <th>Société</th>
                  <th>Adresse</th>
                  <th>Ville</th>
                  <th className="dp__th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d, i) => {
                  const isSel = hovered === i;
                  const adresse = [d.adresse1, d.adresse2]
                    .filter(Boolean)
                    .join(" - ");
                  const cpVille = [d.cp, d.ville].filter(Boolean).join(" ");
                  const villeStr =
                    d.pays && d.pays !== "France"
                      ? `${cpVille} (${d.pays})`
                      : cpVille;
                  return (
                    <tr
                      key={d.id || i}
                      className={isSel ? "dp__row--selected" : ""}
                      onMouseEnter={() => setHovered(i)}
                      onClick={() => onPick(d)}
                    >
                      <td>{d.societe || "—"}</td>
                      <td>{adresse || "—"}</td>
                      <td>{villeStr || "—"}</td>
                      <td className="dp__th-right">
                        <button
                          type="button"
                          className="dp__icon-btn"
                          onClick={(e) => handleDelete(e, d)}
                          title="Supprimer cette destination"
                          aria-label="Supprimer"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {deleteError && (
          <div className="dp__error" role="alert">
            {deleteError}
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================
// CountryField : combobox Pays avec recherche
// =====================================================
function CountryField({ value, onChange, locked = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const matches = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q));
  }, [value]);

  const empty = !value;
  const cls = [
    "dp__ufield",
    "dp__ufield--m5",
    locked && "dp__ufield--locked",
    !empty && "dp__ufield--filled",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} ref={wrapRef}>
      <label className="dp__ulabel">Pays</label>
      <div className="dp__pill">
        <input
          type="text"
          className="dp__pill-input"
          value={value || ""}
          readOnly={locked}
          onFocus={() => !locked && setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          placeholder="Rechercher un pays…"
          autoComplete="off"
        />
        <button
          type="button"
          className="dp__pill-chev"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => !locked && setOpen((o) => !o)}
          tabIndex={-1}
          aria-label="Ouvrir la liste des pays"
        >
          <Chevron open={open} />
        </button>
        {open && !locked && (
          <ul className="dp__suggest dp__suggest--pill">
            {matches.length === 0 ? (
              <li className="dp__suggest-empty">Aucun résultat</li>
            ) : (
              matches.slice(0, 100).map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    className="dp__suggest-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(c.name);
                      setOpen(false);
                    }}
                  >
                    <span className="dp__suggest-societe">{c.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// =====================================================
// PostalCodeField : input CP + popup villes au blur
// =====================================================
function PostalCodeField({ value, country, locked, onChange, onPickCity }) {
  const [cities, setCities] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState(null);

  const empty = !value || (typeof value === "string" && !value.trim());
  const showRequired = empty && !locked;

  const cls = [
    "dp__ufield",
    "dp__ufield--small",
    locked && "dp__ufield--locked",
    showRequired && "dp__ufield--required",
    !empty && "dp__ufield--filled",
  ]
    .filter(Boolean)
    .join(" ");

  const handleBlur = async () => {
    if (locked || !value || !value.trim()) return;
    setLoading(true);
    setLookupError(null);
    try {
      const list = await lookupCitiesByCP(value.trim(), country);
      setCities(list);
      if (list.length === 1) {
        // une seule ville -> remplit directement, pas de popup
        onPickCity(list[0].ville);
        setModalOpen(false);
      } else if (list.length > 1) {
        setModalOpen(true);
      } else {
        setModalOpen(false);
        setLookupError(
          `Aucune ville trouvée pour ${value.trim()} (${country || "France"}).`,
        );
      }
    } catch {
      setLookupError("Erreur lors de la recherche de la ville.");
    } finally {
      setLoading(false);
    }
  };

  // Quand le user re-tape, on efface le message d'erreur précédent
  const handleChange = (e) => {
    if (lookupError) setLookupError(null);
    onChange(e.target.value);
  };

  return (
    <>
      <div className={cls}>
        <label className="dp__ulabel">
          Code postal<span className="dp__req">*</span>
        </label>
        <div className="dp__combobox">
          <input
            type="text"
            className="dp__uinput"
            value={value || ""}
            readOnly={locked}
            onChange={handleChange}
            onBlur={handleBlur}
            autoComplete="off"
          />
          {loading && (
            <span className="dp__cp-loading" aria-hidden="true">…</span>
          )}
        </div>
        {showRequired && (
          <span className="dp__inline-err">Ce champ est obligatoire !</span>
        )}
        {!showRequired && lookupError && (
          <span className="dp__inline-err">{lookupError}</span>
        )}
      </div>

      {modalOpen && (
        <CityValidationModal
          cp={value}
          cities={cities}
          onClose={() => setModalOpen(false)}
          onPick={(ville) => {
            onPickCity(ville);
            setModalOpen(false);
          }}
        />
      )}
    </>
  );
}

// =====================================================
// CityValidationModal : modale "Validation de la ville" type MBEhub
// =====================================================
function CityValidationModal({ cp, cities, onClose, onPick }) {
  const [selected, setSelected] = useState(null);

  // Esc pour fermer
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dp__modal-overlay" onClick={onClose}>
      <div
        className="dp__modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dp__modal-close"
          onClick={onClose}
          aria-label="Fermer"
        >
          ×
        </button>
        <h2 className="dp__modal-title">Validation de la ville</h2>
        <p className="dp__modal-disclaimer">
          Cette liste n'est qu'une suggestion. Veuillez vérifier que l'adresse
          sélectionnée est correcte ! Il s'agit d'un outil d'aide à la saisie,
          qui peut être incomplet ou inadapté pour certains pays et certains
          transporteurs.
        </p>
        <div className="dp__modal-meta">
          (1-{cities.length}/{cities.length})
        </div>
        <div className="dp__modal-table-wrap">
          <table className="dp__modal-table">
            <thead>
              <tr>
                <th>Code postal</th>
                <th>Ville</th>
                <th className="dp__th-right">Dép./Prov.</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((c, i) => {
                const isSel = selected === i;
                return (
                  <tr
                    key={`${c.ville}-${i}`}
                    className={isSel ? "dp__row--selected" : ""}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => onPick(c.ville)}
                  >
                    <td>{cp} - {c.cp || cp}</td>
                    <td>{c.ville}</td>
                    <td className="dp__th-right">{c.region || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  placeholder,
  locked = false,
  // submitted prop conservée pour compat mais non gating l'affichage erreur
  submitted: _submitted = false, // eslint-disable-line no-unused-vars
  small = false,
  wide = false,
  full = false,
  m4 = false,
  m5 = false,
  m9 = false,
  inputProps = {},
}) {
  const empty = !value || (typeof value === "string" && !value.trim());
  // Champ requis vide → toujours afficher l'état "à remplir"
  const showRequired = required && empty && !locked;

  const cls = [
    "dp__ufield",
    small && "dp__ufield--small",
    wide && "dp__ufield--wide",
    full && "dp__ufield--full",
    m4 && "dp__ufield--m4",
    m5 && "dp__ufield--m5",
    m9 && "dp__ufield--m9",
    locked && "dp__ufield--locked",
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
        onChange={locked ? undefined : (e) => onChange(e.target.value)}
        readOnly={locked}
        placeholder={placeholder}
        {...inputProps}
      />
      {showRequired && (
        <span className="dp__inline-err">Ce champ est obligatoire !</span>
      )}
    </div>
  );
}
