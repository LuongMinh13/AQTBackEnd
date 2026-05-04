"""
Orchestrateur pour l'extraction d'une ou plusieurs factures UPS.

Usage:
    python3 process_ups.py <pdf1> [<pdf2> ... <pdfN>]

Sortie (stdout) : JSON avec 4 clés, résultats fusionnés sur tous les PDFs :
  - audit           : lignes "Frais de correction"
  - liv_particulier : lignes "Liv. particulier"
  - residence       : lignes "Résidence"
  - suppenlevement  : lignes "Demande d'enlèvement"

Optimisations :
  - Chaque PDF est ouvert UNE seule fois avec pdfplumber et les 4 extracteurs
    sont appliqués en parallèle à chaque page.
  - Une erreur sur une page n'arrête plus le traitement des autres pages.
  - La détection des sections est robuste aux apostrophes typographiques et
    aux variations d'espacement.
  - Les 4 sections sont dédupliquées de façon homogène.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Iterable

import pdfplumber

# Ajoute le dossier du script au path pour pouvoir importer les extracteurs
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

# Helpers partagés (regex de détection robuste, formatage FR)
from _ups_common import (
    LIV_PARTICULIER_RE,
    DEMANDE_ENLEVEMENT_RE,
    FRAIS_CORRECTION_RE,
    RESIDENCE_RE,
    parse_year_from_page,
    parse_page_number,
    float_to_fr_money,
    normalize_text,
)

# Extracteurs page-level (chaque module ne fait plus que sa logique métier)
from extract_audit import extract_audit_from_page
from extract_liv_particulier import extract_liv_particulier_from_page
from extract_residence import extract_residence_from_page
from extract_suppenlevement import (
    extract_records_from_text as extract_suppenlevement_from_page,
)


# ---------------------------------------------------------------------------
# Déduplication
# ---------------------------------------------------------------------------
def _dedup(rows: list[dict], key_fields: tuple[str, ...]) -> list[dict]:
    """Dédoublonne une liste de dicts sur un tuple de clés, en préservant l'ordre."""
    seen: set[tuple] = set()
    out: list[dict] = []
    for r in rows:
        key = tuple(r.get(f) for f in key_fields)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


# ---------------------------------------------------------------------------
# Formatage des sorties (un schéma stable pour le backend Node)
# ---------------------------------------------------------------------------
def format_audit(rows: list[dict]) -> list[dict]:
    dedup = _dedup(rows, ("DATE", "NUMERO SUIVI", "PRIX NET"))
    return [
        {
            "DATE": r.get("DATE") or "",
            "NUMERO SUIVI": r.get("NUMERO SUIVI") or "",
            "Description (audited weight)": r.get("Description (audited weight)") or "",
            "PRIX NET": float_to_fr_money(r.get("PRIX NET")),
        }
        for r in dedup
    ]


def format_liv(rows: list[dict]) -> list[dict]:
    dedup = _dedup(rows, ("DATE", "NUMERO SUIVI"))
    return [
        {
            "REFERENCE": r.get("REFERENCE") or "",
            "DATE": r.get("DATE") or "",
            "NUMERO SUIVI": r.get("NUMERO SUIVI") or "",
            "Description": r.get("Description") or "",
        }
        for r in dedup
    ]


def format_residence(rows: list[dict]) -> list[dict]:
    dedup = _dedup(rows, ("DATE", "NUMERO SUIVI"))
    return [
        {
            "REFERENCE": r.get("REFERENCE") or "",
            "DATE": r.get("DATE") or "",
            "NUMERO SUIVI": r.get("NUMERO SUIVI") or "",
            "Description": r.get("Description") or "",
        }
        for r in dedup
    ]


def format_suppenlevement(rows: list[dict]) -> list[dict]:
    dedup = _dedup(rows, ("DATE DEMANDE", "NUMERO DEMANDE"))
    return [
        {
            "CLIENT": r.get("CLIENT") or "",
            "DATE DEMANDE": r.get("DATE DEMANDE") or "",
            "NUMERO DEMANDE": r.get("NUMERO DEMANDE") or "",
            "DESCRIPTION": r.get("DESCRIPTION") or "",
            "PRIX NET": float_to_fr_money(r.get("PRIX NET")),
            "PRIX VENTE": float_to_fr_money(r.get("PRIX VENTE")),
        }
        for r in dedup
    ]


# ---------------------------------------------------------------------------
# Extraction par PDF
# ---------------------------------------------------------------------------
def _process_page(
    text: str,
    audit_rows: list[dict],
    liv_rows: list[dict],
    res_rows: list[dict],
    supp_rows: list[dict],
) -> None:
    """Applique les 4 extracteurs sur le texte d'une page (déjà normalisé)."""
    year = parse_year_from_page(text)

    if FRAIS_CORRECTION_RE.search(text):
        audit_rows.extend(extract_audit_from_page(text, year=year))

    if LIV_PARTICULIER_RE.search(text):
        pno = parse_page_number(text)
        liv_rows.extend(extract_liv_particulier_from_page(text, pno, year=year))

    if RESIDENCE_RE.search(text):
        pno = parse_page_number(text)
        res_rows.extend(extract_residence_from_page(text, pno, year=year))

    if DEMANDE_ENLEVEMENT_RE.search(text):
        supp_rows.extend(extract_suppenlevement_from_page(text, year=year))


def extract_from_pdf(
    pdf_path: Path,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """Ouvre un PDF une seule fois et applique les 4 extracteurs par page.

    Une erreur sur une page est journalisée sur stderr mais n'arrête pas le
    traitement des autres pages.
    """
    audit_rows: list[dict] = []
    liv_rows: list[dict] = []
    res_rows: list[dict] = []
    supp_rows: list[dict] = []

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            try:
                raw = page.extract_text() or ""
                if not raw:
                    continue
                # Normalise apostrophes typographiques + NBSP : la détection
                # des sections devient insensible à ces variations.
                text = normalize_text(raw)
                _process_page(text, audit_rows, liv_rows, res_rows, supp_rows)
            except Exception as e:  # noqa: BLE001 — on veut continuer
                page_no = getattr(page, "page_number", "?")
                print(
                    f"[warn] {pdf_path.name} page {page_no}: "
                    f"{type(e).__name__}: {e}",
                    file=sys.stderr,
                )
                continue

    return audit_rows, liv_rows, res_rows, supp_rows


def process(pdf_paths: Iterable[Path | str]) -> dict:
    """Fusionne les résultats de 1..N PDFs en un seul jeu de données."""
    if isinstance(pdf_paths, (str, Path)):
        pdf_paths = [pdf_paths]

    all_audit: list[dict] = []
    all_liv: list[dict] = []
    all_res: list[dict] = []
    all_supp: list[dict] = []

    for p in pdf_paths:
        a, l, r, s = extract_from_pdf(Path(p))
        all_audit.extend(a)
        all_liv.extend(l)
        all_res.extend(r)
        all_supp.extend(s)

    return {
        "audit": format_audit(all_audit),
        "liv_particulier": format_liv(all_liv),
        "residence": format_residence(all_res),
        "suppenlevement": format_suppenlevement(all_supp),
    }


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 1:
        print(json.dumps({"error": "missing PDF path argument"}), file=sys.stderr)
        sys.exit(2)

    pdf_paths = [Path(a) for a in args]
    missing = [str(p) for p in pdf_paths if not p.exists()]
    if missing:
        print(
            json.dumps({"error": f"PDF not found: {', '.join(missing)}"}),
            file=sys.stderr,
        )
        sys.exit(3)

    try:
        result = process(pdf_paths)
    except Exception as e:  # noqa: BLE001
        print(
            json.dumps({"error": f"processing failed: {type(e).__name__}: {e}"}),
            file=sys.stderr,
        )
        sys.exit(1)

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
