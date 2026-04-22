import { useNavigate } from "react-router-dom";
import DashboardCard from "../components/DashboardCard";
import StatCard from "../components/StatCard";
import { INVOICE_CARRIERS, PICKUP_CARRIERS, ROUTES } from "../utils/constants";
import "../assets/Style/pages/Dashboard.css";

// Icônes SVG utilisées dans les cards
const IconInvoice = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const IconTruck = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13" />
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
);

const IconPalette = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="3" />
    <circle cx="5" cy="17" r="3" />
    <circle cx="19" cy="17" r="3" />
  </svg>
);

const IconActivity = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const IconCheck = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="9 12 12 15 16 10" />
  </svg>
);

const IconCalendar = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <h1 className="dashboard__title">Tableau de bord</h1>
        <p className="dashboard__subtitle">
          Centre de pilotage pour la logistique et le back-office.
        </p>
      </header>

      <div className="dashboard__grid">
        {/* Carte Factures */}
        <DashboardCard
          icon={IconInvoice}
          iconTone="blue"
          title="Traitement des factures"
          subtitle="Traitez les nouvelles factures des transporteurs et exportez les données en CSV."
          footer={
            <>
              {INVOICE_CARRIERS.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => navigate(ROUTES.invoice(c.slug))}
                >
                  Facture {c.name}
                </button>
              ))}
            </>
          }
        >
          <div className="dashboard__stats">
            <StatCard
              icon={IconActivity}
              label="Fichiers totaux"
              value="0"
              tone="neutral"
            />
            <StatCard
              icon={IconCheck}
              label="Traités"
              value="0"
              tone="success"
            />
          </div>
        </DashboardCard>

        {/* Carte Enlèvements */}
        <DashboardCard
          icon={IconTruck}
          iconTone="orange"
          title="Demandes d'enlèvement"
          subtitle="Planifiez les collectes de colis pour tous vos transporteurs."
          footer={
            <>
              {PICKUP_CARRIERS.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => navigate(ROUTES.pickup(c.slug))}
                >
                  {c.name}
                </button>
              ))}
            </>
          }
        >
          <div className="dashboard__stats">
            <StatCard
              icon={IconActivity}
              label="Demandes totales"
              value="0"
              tone="neutral"
            />
            <StatCard
              icon={IconCalendar}
              label="Planifiées"
              value="0"
              tone="info"
            />
          </div>
        </DashboardCard>

        {/* Carte Palettes */}
        <DashboardCard
          icon={IconPalette}
          iconTone="green"
          title="Demande Palette"
          subtitle="Importez un devis DHL et pré-remplissez les adresses pour vos expéditions de palettes."
          footer={
            <button
              type="button"
              onClick={() => navigate(ROUTES.palettes)}
            >
              Accéder au module
            </button>
          }
        >
          <div className="dashboard__info-box">
            Automatisez la saisie des adresses d'enlèvement et de livraison
            dans vos fichiers Excel DHL.
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}
