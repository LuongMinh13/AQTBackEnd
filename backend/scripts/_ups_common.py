"""
Helpers communs aux extracteurs UPS.

Centralise les regex, dictionnaires et fonctions de formatage qui étaient
dupliqués entre les 4 extracteurs (audit, liv_particulier, residence,
suppenlevement) et dans l'orchestrateur process_ups.py.

Chaque extracteur ré-exporte ces helpers (via `from _ups_common import ...`)
afin de préserver la compatibilité ascendante des imports existants.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional


# ----------------------------
# Mois FR -> MM
# ----------------------------
MONTHS: dict[str, str] = {
    "Jan": "01",
    "Fév": "02", "Fev": "02",
    "Mar": "03",
    "Avr": "04",
    "Mai": "05",
    "Juin": "06",
    "Juil": "07",
    "Aoû": "08", "Aou": "08",
    "Sep": "09",
    "Oct": "10",
    "Nov": "11",
    "Déc": "12", "Dec": "12",
}


# ----------------------------
# Regex unifiées
# ----------------------------
# Numéro de suivi UPS (1Z + 16 alphanumériques)
TRACK_RE = re.compile(r"\b1Z[A-Z0-9]{16}\b")

# Montant FR : 1 234,56 ou 1234,56 (avec espace insécable possible)
MONEY_RE = re.compile(r"\b\d{1,3}(?:[ \xa0]\d{3})*,\d{2}\b")

# Date FR libre dans la ligne : "5 Mai", "12 Déc", … — case-insensitive,
# limitée aux abréviations UPS connues (utilisée par extract_audit).
DATE_RE = re.compile(
    r"(?P<d>\d{1,2})\s*"
    r"(?P<m>Jan|Fév|Fev|Mar|Avr|Mai|Juin|Juil|Aoû|Aou|Sep|Oct|Nov|Déc|Dec)\b",
    re.IGNORECASE,
)

# Date ancrée en début de ligne (utilisée par liv_particulier / residence /
# suppenlevement). Plus permissive sur le mois — on s'appuie sur MONTHS pour
# valider après coup.
DATE_RE_ANCHORED = re.compile(
    r"^(?P<d>\d{1,2})\s+(?P<m>[A-Za-zéûôîÉÛÔÎ]+)\b"
)

# Détection robuste des marqueurs de sections (apostrophes droites OU
# typographiques, espaces optionnels).
LIV_PARTICULIER_RE = re.compile(r"Liv\.?\s*particulier", re.IGNORECASE)
DEMANDE_ENLEVEMENT_RE = re.compile(
    r"Demande\s+d['\u2019]enl[èe]vement", re.IGNORECASE
)
FRAIS_CORRECTION_RE = re.compile(r"Frais\s+de\s+correction", re.IGNORECASE)
RESIDENCE_RE = re.compile(r"R[ée]sidence", re.IGNORECASE)


# ----------------------------
# Helpers de formatage FR
# ----------------------------
def default_year() -> str:
    """Année par défaut : année courante (fallback si non détectée dans le PDF)."""
    return str(datetime.now().year)


def normalize_text(s: Optional[str]) -> str:
    """Normalise un texte de page : apostrophes typographiques + NBSP."""
    if not s:
        return ""
    return s.replace("\u2019", "'").replace("\xa0", " ")


def normalize_line(s: Optional[str]) -> str:
    """Normalise une ligne : NBSP, apostrophes typographiques, espaces multiples."""
    s = (s or "").replace("\xa0", " ").replace("\u2019", "'")
    return " ".join(s.split())


def fr_money_to_float(s: Optional[str]) -> Optional[float]:
    """Convertit '1 234,56' (style FR) en 1234.56. None si non parsable."""
    if not s:
        return None
    s = s.replace("\xa0", " ").strip()
    s = s.replace(" ", "")
    s = s.replace(",", ".")
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def float_to_fr_money(x) -> str:
    """Formate un float en '1234,56' (style FR), '' si vide/None."""
    if x is None or x == "":
        return ""
    try:
        return f"{float(x):.2f}".replace(".", ",")
    except (ValueError, TypeError):
        return ""


def normalize_date_fr(day: str, mon: str, year: str) -> Optional[str]:
    """Construit 'JJ/MM/AAAA' à partir d'un jour, d'un mois FR, et d'une année."""
    mon_clean = (mon or "").capitalize()[:3]
    mon_num = MONTHS.get(mon_clean)
    if not mon_num:
        return None
    try:
        dd = f"{int(day):02d}"
    except (ValueError, TypeError):
        return None
    return f"{dd}/{mon_num}/{year}"


def parse_year_from_page(text: Optional[str], default: Optional[str] = None) -> str:
    """Cherche 'Date facture X Mois YYYY' dans le texte. Sinon fallback année courante."""
    if default is None:
        default = default_year()
    m = re.search(
        r"Date facture\s+\d{1,2}\s+[A-Za-zéûôîÉÛÔÎ]+\s+(\d{4})",
        text or "",
    )
    return m.group(1) if m else default


def parse_page_number(text: Optional[str]) -> Optional[int]:
    """Cherche 'Page: N de M' et retourne N (ou None si introuvable)."""
    m = re.search(r"Page:\s*(\d+)\s+de\s+\d+", text or "")
    return int(m.group(1)) if m else None


# ----------------------------
# Table tarifaire (Demande d'enlèvement)
# ----------------------------
# Mappe un prix net UPS connu vers le prix de vente facturé au client.
# Externalisée ici plutôt qu'en valeurs littérales dans extract_suppenlevement
# afin de pouvoir évoluer sans toucher au code d'extraction.
PRIX_VENTE_TABLE: dict[float, float] = {
    0.58: 0.80,
    2.17: 2.80,
}


def compute_prix_vente(
    prix_net: Optional[float],
    tolerance: float = 0.001,
) -> Optional[float]:
    """Mappe un prix net UPS connu vers le prix de vente correspondant."""
    if prix_net is None:
        return None
    for net, vente in PRIX_VENTE_TABLE.items():
        if abs(prix_net - net) < tolerance:
            return vente
    return None
