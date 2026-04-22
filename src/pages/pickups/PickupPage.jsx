import { useState } from "react";
import FormField from "../../components/FormField";
import { getCarrierByslug, PICKUP_CARRIERS } from "../../utils/constants";
import "../../assets/Style/pages/PickupPage.css";

const initialForm = {
  companyName: "",
  contactPerson: "",
  pickupAddress: "",
  phoneNumber: "",
  numberOfParcels: 1,
  totalWeight: "",
  requestedDate: new Date().toISOString().split("T")[0],
};

/**
 * Page générique de demande d'enlèvement.
 * Le transporteur est passé en prop.
 */
export default function PickupPage({ carrierSlug }) {
  const carrier = getCarrierByslug(PICKUP_CARRIERS, carrierSlug);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Efface l'erreur du champ si présente
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
  };

  const validate = () => {
    const e = {};
    if (!form.companyName.trim()) e.companyName = "Nom de société requis";
    if (!form.contactPerson.trim()) e.contactPerson = "Nom du contact requis";
    if (!form.pickupAddress.trim()) e.pickupAddress = "Adresse requise";
    if (!form.phoneNumber.trim()) e.phoneNumber = "Téléphone requis";
    if (!form.numberOfParcels || form.numberOfParcels < 1)
      e.numberOfParcels = "Au moins 1 colis";
    if (!form.totalWeight || Number(form.totalWeight) <= 0)
      e.totalWeight = "Poids invalide";
    if (!form.requestedDate) e.requestedDate = "Date requise";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccessMsg("");
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      // TODO : brancher l'appel API backend (POST /api/<carrier>/pickup)
      // await pickupApi.create(carrier.slug, form);
      await new Promise((r) => setTimeout(r, 600));
      setSuccessMsg(
        `Demande d'enlèvement ${carrier.name} envoyée avec succès !`
      );
      setForm(initialForm);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setForm(initialForm);
    setErrors({});
    setSuccessMsg("");
  };

  if (!carrier) {
    return (
      <div className="pickup-page">
        <h1>Transporteur inconnu</h1>
      </div>
    );
  }

  return (
    <div className="pickup-page">
      <header className="pickup-page__header">
        <h1 className="pickup-page__title">
          Demande d'enlèvement {carrier.name}
        </h1>
        <p className="pickup-page__subtitle">
          Planifiez une nouvelle collecte depuis votre établissement.
        </p>
      </header>

      <form className="pickup-page__form" onSubmit={handleSubmit} noValidate>
        {/* Sender Information */}
        <section className="pickup-page__section">
          <div className="pickup-page__section-head">
            <span className="pickup-page__section-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <h2 className="pickup-page__section-title">Informations expéditeur</h2>
          </div>

          <div className="pickup-page__grid pickup-page__grid--2">
            <FormField
              label="Nom de la société"
              name="companyName"
              value={form.companyName}
              onChange={handleChange}
              placeholder="Acme Corp"
              required
              error={errors.companyName}
            />
            <FormField
              label="Personne de contact"
              name="contactPerson"
              value={form.contactPerson}
              onChange={handleChange}
              placeholder="Jane Doe"
              required
              error={errors.contactPerson}
            />
            <FormField
              label="Adresse d'enlèvement"
              name="pickupAddress"
              value={form.pickupAddress}
              onChange={handleChange}
              placeholder="123 rue de la Logistique, 75001 Paris"
              required
              error={errors.pickupAddress}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              }
            />
            <FormField
              label="Numéro de téléphone"
              name="phoneNumber"
              type="tel"
              value={form.phoneNumber}
              onChange={handleChange}
              placeholder="+33 1 23 45 67 89"
              required
              error={errors.phoneNumber}
            />
          </div>
        </section>

        {/* Consignment Details */}
        <section className="pickup-page__section">
          <div className="pickup-page__section-head">
            <span className="pickup-page__section-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </span>
            <h2 className="pickup-page__section-title">Détails de l'envoi</h2>
          </div>

          <div className="pickup-page__grid pickup-page__grid--3">
            <FormField
              label="Nombre de colis"
              name="numberOfParcels"
              type="number"
              min="1"
              value={form.numberOfParcels}
              onChange={handleChange}
              required
              error={errors.numberOfParcels}
            />
            <FormField
              label="Poids total (kg)"
              name="totalWeight"
              type="number"
              min="0"
              step="0.1"
              value={form.totalWeight}
              onChange={handleChange}
              placeholder="0.0"
              required
              error={errors.totalWeight}
            />
            <FormField
              label="Date souhaitée"
              name="requestedDate"
              type="date"
              value={form.requestedDate}
              onChange={handleChange}
              required
              error={errors.requestedDate}
            />
          </div>
        </section>

        {/* Actions */}
        <div className="pickup-page__actions">
          <button
            type="button"
            className="pickup-page__btn pickup-page__btn--secondary"
            onClick={handleReset}
            disabled={isSubmitting}
          >
            Réinitialiser
          </button>
          <button
            type="submit"
            className="pickup-page__btn pickup-page__btn--primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Envoi en cours…" : "Envoyer la demande"}
          </button>
        </div>

        {successMsg && (
          <div className="pickup-page__success">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {successMsg}
          </div>
        )}
      </form>
    </div>
  );
}
