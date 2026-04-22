import { useState } from "react";
import "../assets/Style/components/ResultsTabs.css";

/**
 * Affichage des résultats en onglets.
 *
 * Props :
 *  - tabs : [{ key, label, columns: [{key,label}], rows: [] }]
 */
export default function ResultsTabs({ tabs }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) || tabs[0];

  if (!activeTab) return null;

  return (
    <div className="results-tabs">
      <div className="results-tabs__header" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={
              "results-tabs__tab" +
              (active === t.key ? " results-tabs__tab--active" : "")
            }
            onClick={() => setActive(t.key)}
          >
            {t.label}
            <span className="results-tabs__count">{t.rows.length}</span>
          </button>
        ))}
      </div>

      <div className="results-tabs__panel" role="tabpanel">
        <div className="results-tabs__table-wrap">
          <table className="results-tabs__table">
            <thead>
              <tr>
                {activeTab.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeTab.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeTab.columns.length}
                    className="results-tabs__empty"
                  >
                    Aucune donnée extraite pour cet onglet.
                  </td>
                </tr>
              ) : (
                activeTab.rows.map((row, idx) => (
                  <tr key={idx}>
                    {activeTab.columns.map((c) => (
                      <td key={c.key}>{row[c.key] ?? ""}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
