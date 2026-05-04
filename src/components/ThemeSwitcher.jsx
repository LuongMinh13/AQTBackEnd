import { useEffect, useRef, useState } from "react";
import { useTheme } from "../hooks/useTheme";
import "../assets/Style/components/ThemeSwitcher.css";

/**
 * Liste déroulante pour changer de thème.
 * Affiche le nom du thème actif + flèche, puis un menu
 * avec les 4 options en toutes lettres.
 */

// Libellés affichés dans le menu
const THEME_LABELS = {
  light: "Light",
  dark: "Sombre",
  pride: "Gay",
  subaru: "Subaru",
};

export default function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Ferme le dropdown en cliquant en dehors
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (id) => {
    setTheme(id);
    setOpen(false);
  };

  return (
    <div className="theme-switcher" ref={wrapRef}>
      <button
        type="button"
        className={"theme-switcher__btn" + (open ? " is-open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="theme-switcher__label">
          {THEME_LABELS[theme] ?? theme}
        </span>
        <svg
          className="theme-switcher__caret"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul className="theme-switcher__menu" role="listbox">
          {themes.map((id) => (
            <li key={id}>
              <button
                type="button"
                role="option"
                aria-selected={theme === id}
                className={
                  "theme-switcher__option theme-switcher__option--" +
                  id +
                  (theme === id ? " is-active" : "")
                }
                onClick={() => handleSelect(id)}
              >
                {THEME_LABELS[id] ?? id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
