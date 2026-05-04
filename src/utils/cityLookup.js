// Résolution code postal -> liste de villes.
// Stratégie :
//   - FR  : geo.api.gouv.fr (officiel, exhaustif, sans clé)
//   - autre : api.zippopotam.us (gratuit, sans clé, couverture monde)
// Cache mémoire simple par "CC|cp" pour éviter les appels répétés.
import { countryNameToCode } from "./countries";

const cache = new Map();

function normalizeFR(places) {
  // geo.api.gouv.fr : [{nom, codePostaux, codeDepartement, ...}]
  return places
    .map((p) => ({
      ville: (p.nom || "").trim(),
      cp: Array.isArray(p.codesPostaux) ? p.codesPostaux[0] : "",
      region: p.codeDepartement || "",
    }))
    .filter((c) => c.ville);
}

function normalizeZippo(json) {
  // zippopotam : { places: [{"place name", "state", ...}] }
  const places = Array.isArray(json?.places) ? json.places : [];
  return places
    .map((p) => ({
      ville: (p["place name"] || "").trim(),
      cp: json["post code"] || "",
      region: p.state || p["state abbreviation"] || "",
    }))
    .filter((c) => c.ville);
}

/**
 * Cherche les villes correspondant à un code postal.
 * @param {string} cp - code postal (ex "54120")
 * @param {string} countryName - nom français du pays (ex "France")
 * @returns {Promise<Array<{ville, cp, region}>>}
 */
export async function lookupCitiesByCP(cp, countryName) {
  const code = countryNameToCode(countryName) || "FR";
  const cleanCp = String(cp || "").trim();
  if (!cleanCp) return [];

  const cacheKey = `${code}|${cleanCp}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let result = [];
  try {
    if (code === "FR") {
      const url = `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(
        cleanCp,
      )}&fields=nom,codesPostaux,codeDepartement&format=json`;
      const r = await fetch(url);
      if (r.ok) {
        const json = await r.json();
        result = normalizeFR(Array.isArray(json) ? json : []);
      }
    } else {
      const url = `https://api.zippopotam.us/${code.toLowerCase()}/${encodeURIComponent(
        cleanCp,
      )}`;
      const r = await fetch(url);
      if (r.ok) {
        const json = await r.json();
        result = normalizeZippo(json);
      }
    }
  } catch {
    /* ignore - réseau indisponible */
  }

  cache.set(cacheKey, result);
  return result;
}
