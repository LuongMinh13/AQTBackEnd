import "../assets/Style/components/DashboardCard.css";

/**
 * Grande carte modulaire du Dashboard.
 * Props :
 *  - icon      : node (SVG) affiché dans la pastille colorée
 *  - iconTone  : "blue" | "orange" | "green" (couleur de la pastille)
 *  - title     : titre de la card (ex: "Traitement des factures")
 *  - subtitle  : sous-titre descriptif
 *  - children  : contenu (StatCards, texte, etc.)
 *  - footer    : actions en bas (boutons)
 */
export default function DashboardCard({
  icon,
  iconTone = "blue",
  title,
  subtitle,
  children,
  footer,
}) {
  return (
    <section className="db-card">
      <div className="db-card__header">
        {icon && (
          <span className={`db-card__icon db-card__icon--${iconTone}`}>
            {icon}
          </span>
        )}
        <div className="db-card__heading">
          <h2 className="db-card__title">{title}</h2>
          {subtitle ? <p className="db-card__subtitle">{subtitle}</p> : null}
        </div>
      </div>

      {children && <div className="db-card__body">{children}</div>}

      {footer && <div className="db-card__footer">{footer}</div>}
    </section>
  );
}
