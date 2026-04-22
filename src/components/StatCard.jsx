import "../assets/Style/components/StatCard.css";

/**
 * Petite carte de statistique affichée dans le Dashboard.
 * Props :
 *  - icon   : node (SVG ou élément) affiché à gauche du label
 *  - label  : libellé (ex: "Fichiers totaux")
 *  - value  : valeur (ex: 0, "12", "—")
 *  - tone   : "neutral" | "success" | "info" (couleur de l'icône)
 */
export default function StatCard({ icon, label, value, tone = "neutral" }) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__head">
        {icon && <span className="stat-card__icon">{icon}</span>}
        <span className="stat-card__label">{label}</span>
      </div>
      <div className="stat-card__value">{value}</div>
    </div>
  );
}
