import { useNavigate } from "react-router-dom";
import { PICKUP_CARRIERS, ROUTES } from "../utils/constants";

export default function Pickups() {
  const navigate = useNavigate();

  return (
    <div style={{ paddingBlock: "8px 32px" }}>
      <h1 style={{ margin: "0 0 6px 0", fontSize: "clamp(26px, 2.6vw, 36px)", fontWeight: 800, color: "#0f172a" }}>
        Demandes d'enlèvement
      </h1>
      <p style={{ margin: 0, color: "#64748b" }}>
        Sélectionnez un transporteur pour planifier une collecte.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        {PICKUP_CARRIERS.map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => navigate(ROUTES.pickup(c.slug))}
            style={{
              padding: "10px 16px",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
