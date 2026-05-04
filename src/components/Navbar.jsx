import { useState, useRef, useEffect } from "react";
import { NavLink, Link } from "react-router-dom";
import {
  INVOICE_CARRIERS,
  PALETTE_SECTIONS,
  PICKUP_CARRIERS,
  ROUTES,
} from "../utils/constants";
import ThemeSwitcher from "./ThemeSwitcher";
import "../assets/Style/components/Navbar.css";

export default function Navbar() {
  const [openMenu, setOpenMenu] = useState(null);
  const navRef = useRef(null);

  // Ferme le dropdown quand on clique en dehors
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleMenu = (name) => {
    setOpenMenu((prev) => (prev === name ? null : name));
  };

  const closeMenu = () => setOpenMenu(null);

  return (
    <nav className="navbar" ref={navRef}>
      <div className="navbar__inner">
        {/* Logo */}
        <Link to={ROUTES.dashboard} className="navbar__brand" onClick={closeMenu}>
          <span className="navbar__logo" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </span>
          <span className="navbar__title">BackOfficeMBE</span>
        </Link>

        {/* Liens de navigation */}
        <ul className="navbar__links">
          <li>
            <NavLink
              to={ROUTES.dashboard}
              end
              className={({ isActive }) =>
                "navbar__link" + (isActive ? " is-active" : "")
              }
              onClick={closeMenu}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              Tableau de bord
            </NavLink>
          </li>

          {/* Factures dropdown */}
          <li className="navbar__dropdown-wrap">
            <button
              type="button"
              className={
                "navbar__link navbar__dropdown-btn" +
                (openMenu === "invoices" ? " is-open" : "")
              }
              onClick={() => toggleMenu("invoices")}
              aria-expanded={openMenu === "invoices"}
              aria-haspopup="true"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Factures
              <svg className="navbar__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {openMenu === "invoices" && (
              <ul className="navbar__menu">
                {INVOICE_CARRIERS.map((c) => (
                  <li key={c.slug}>
                    <NavLink
                      to={ROUTES.invoice(c.slug)}
                      className="navbar__menu-item"
                      onClick={closeMenu}
                    >
                      Facture {c.name}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </li>

          {/* Enlèvements dropdown */}
          <li className="navbar__dropdown-wrap">
            <button
              type="button"
              className={
                "navbar__link navbar__dropdown-btn" +
                (openMenu === "pickups" ? " is-open" : "")
              }
              onClick={() => toggleMenu("pickups")}
              aria-expanded={openMenu === "pickups"}
              aria-haspopup="true"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              Enlèvements
              <svg className="navbar__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {openMenu === "pickups" && (
              <ul className="navbar__menu">
                {PICKUP_CARRIERS.map((c) => (
                  <li key={c.slug}>
                    <NavLink
                      to={ROUTES.pickup(c.slug)}
                      className="navbar__menu-item"
                      onClick={closeMenu}
                    >
                      Enlèvement {c.name}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </li>

          {/* Palettes dropdown — Nouvelle demande + Historique */}
          <li className="navbar__dropdown-wrap">
            <button
              type="button"
              className={
                "navbar__link navbar__dropdown-btn" +
                (openMenu === "palettes" ? " is-open" : "")
              }
              onClick={() => toggleMenu("palettes")}
              aria-expanded={openMenu === "palettes"}
              aria-haspopup="true"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="3" />
                <circle cx="5" cy="17" r="3" />
                <circle cx="19" cy="17" r="3" />
              </svg>
              Palettes
              <svg className="navbar__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {openMenu === "palettes" && (
              <ul className="navbar__menu">
                {PALETTE_SECTIONS.map((s) => (
                  <li key={s.slug}>
                    <NavLink
                      to={ROUTES.palette(s.slug)}
                      className="navbar__menu-item"
                      onClick={closeMenu}
                    >
                      {s.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </li>

          {/* Carnet clients — entrée de menu indépendante */}
          <li>
            <NavLink
              to={ROUTES.clients}
              className={({ isActive }) =>
                "navbar__link" + (isActive ? " is-active" : "")
              }
              onClick={closeMenu}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                <circle cx="12" cy="10" r="2.5" />
                <path d="M9 16c.7-1.5 2-2.3 3-2.3s2.3.8 3 2.3" />
              </svg>
              Carnet clients
            </NavLink>
          </li>
        </ul>

        {/* Sélecteur de thème à droite */}
        <div className="navbar__actions">
          <ThemeSwitcher />
        </div>
      </div>
    </nav>
  );
}
