import { useEffect, useState, useCallback } from "react";

/**
 * Liste des thèmes disponibles dans l'application.
 * Doit rester synchro avec src/assets/Style/themes.css.
 */
export const THEMES = ["light", "dark", "pride", "subaru"];

const STORAGE_KEY = "backoffice-mbe-theme";
const DEFAULT_THEME = "light";

/**
 * Lit le thème stocké dans localStorage, ou retourne le thème par défaut.
 * Protégé contre les environnements SSR (au cas où) et les valeurs invalides.
 */
function readStoredTheme() {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.includes(stored)) return stored;
  } catch {
    /* localStorage bloqué (navigation privée, etc.) : on ignore */
  }
  return DEFAULT_THEME;
}

/**
 * Applique le thème sur <html data-theme="..."> pour que themes.css
 * remplace les variables CSS en cascade.
 * Le thème "light" est le défaut : pas besoin d'attribut.
 */
function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "light") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

/**
 * Hook React pour gérer le thème de l'application.
 * - persistance dans localStorage
 * - applique data-theme sur <html>
 * - expose setTheme + cycleTheme (pour un bouton unique)
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => readStoredTheme());

  // Applique le thème à chaque changement
  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const idx = THEMES.indexOf(current);
      return THEMES[(idx + 1) % THEMES.length];
    });
  }, []);

  return { theme, setTheme, cycleTheme, themes: THEMES };
}
