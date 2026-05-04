import { useNavigate } from "react-router-dom";
import { PALETTE_SECTIONS, ROUTES } from "../utils/constants";
import "../assets/Style/pages/Palettes.css";

export default function Palettes() {
  const navigate = useNavigate();

  return (
    <div className="palettes-page">
      <header className="palettes-page__header">
        <h1 className="palettes-page__title">Palettes</h1>
        <p className="palettes-page__subtitle">
          Préparez vos demandes de tarifs DHL Freight et gérez votre carnet
          d'expéditeurs.
        </p>
      </header>

      <div className="palettes-index">
        {PALETTE_SECTIONS.map((s) => (
          <button
            key={s.slug}
            type="button"
            className="palettes-index__card"
            onClick={() => navigate(ROUTES.palette(s.slug))}
          >
            <span className="palettes-index__card-title">{s.name}</span>
            <span className="palettes-index__card-desc">{s.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
