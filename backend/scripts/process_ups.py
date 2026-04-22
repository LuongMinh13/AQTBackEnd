"""
Orchestrateur pour l'extraction d'une ou plusieurs factures UPS.

Usage:
    python3 process_ups.py <pdf1> [<pdf2> ... <pdfN>]

Sortie (stdout) : JSON avec 4 clés, résultats fusionnés sur tous les PDFs :
  - audit           : lignes "Frais de correction"
  - liv_particulier : lignes "Liv. particulier"
  - residence       : lignes "Résidence"
  - suppenlevement  : lignes "Demande d'enlèvement"

Optimisation : chaque PDF est ouvert UNE seule fois avec pdfplumber et les
4 extracteurs sont appliqués en parallèle à chaque page (au lieu de
rouvrir le PDF 4 fois).
"""
import json
import re
import sys
from pathlib import Path

import pdfplumber

# Ajoute le dossier du script au path pour pouvoir importer les extracteurs
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from extract_audit import (
    extract_audit_from_page,
    parse_year_from_page as parse_year_audit,
    float_to_fr_money as audit_fr_money,
)
from extract_liv_particulier import (
    extract_liv_particulier_from_page,
    parse_page_number as liv_page_no,
    parse_year_from_page as parse_year_liv,
)
from extract_residence import (
    extract_residence_from_page,
    parse_page_number as res_page_no,
    parse_year_from_page as parse_year_res,
)
from extract_suppenlevement import (
    extract_records_from_text as extract_suppenlevement_from_page,
    parse_year_from_page as parse_year_supp,
    float_to_fr_money as supp_fr_money,
)


def format_audit(rows):
    # Déduplication (reprise de extract_audit_from_pdf)
    seen = set()
    dedup = []
    for r in rows:
        key = (r.get("DATE"), r.get("NUMERO SUIVI"), r.get("PRIX NET"))
        if key in seen:
            continue
        seen.add(key)
        dedup.append(r)

    out = []
    for r in dedup:
        out.append({
            "DATE": r.get("DATE") or "",
            "NUMERO SUIVI": r.get("NUMERO SUIVI") or "",
            "Description (audited weight)": r.get("Description (audited weight)") or "",
            "PRIX NET": audit_fr_money(r.get("PRIX NET")),
        })
    return out


def format_liv(rows):
    return [
        {
            "REFERENCE": r.get("REFERENCE") or "",
            "DATE": r.get("DATE") or "",
            "NUMERO SUIVI": r.get("NUMERO SUIVI") or "",
            "Description": r.get("Description") or "",
        }
        for r in rows
    ]


def format_residence(rows):
    return [
        {
            "REFERENCE": r.get("REFERENCE") or "",
            "DATE": r.get("DATE") or "",
            "NUMERO SUIVI": r.get("NUMERO SUIVI") or "",
            "Description": r.get("Description") or "",
        }
        for r in rows
    ]


def format_suppenlevement(rows):
    return [
        {
            "CLIENT": r.get("CLIENT") or "",
            "DATE DEMANDE": r.get("DATE DEMANDE") or "",
            "NUMERO DEMANDE": r.get("NUMERO DEMANDE") or "",
            "DESCRIPTION": r.get("DESCRIPTION") or "",
            "PRIX NET": supp_fr_money(r.get("PRIX NET")),
            "PRIX VENTE": supp_fr_money(r.get("PRIX VENTE")),
        }
        for r in rows
    ]


def extract_from_pdf(pdf_path: Path):
    """Ouvre un PDF une seule fois et applique les 4 extracteurs par page.

    Retourne (audit_rows, liv_rows, res_rows, supp_rows) bruts,
    à dédupliquer/formater ensuite.
    """
    audit_rows = []
    liv_rows = []
    res_rows = []
    supp_rows = []

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if not text:
                continue

            # Audit : "Frais de correction"
            if "Frais de correction" in text:
                year_a = parse_year_audit(text)
                audit_rows.extend(extract_audit_from_page(text, year=year_a))

            # Liv. particulier
            if "Liv.particulier" in text or "Liv. particulier" in text:
                pno = liv_page_no(text)
                year_l = parse_year_liv(text)
                liv_rows.extend(extract_liv_particulier_from_page(text, pno, year=year_l))

            # Résidence
            if "Résidence" in text:
                pno = res_page_no(text)
                year_r = parse_year_res(text)
                res_rows.extend(extract_residence_from_page(text, pno, year=year_r))

            # Demande d'enlèvement
            if "Demande d'enlèvement" in text:
                year_s = parse_year_supp(text)
                supp_rows.extend(extract_suppenlevement_from_page(text, year=year_s))

    return audit_rows, liv_rows, res_rows, supp_rows


def process(pdf_paths):
    """Fusionne les résultats de 1..N PDFs en un seul jeu de données."""
    if isinstance(pdf_paths, (str, Path)):
        pdf_paths = [pdf_paths]

    all_audit = []
    all_liv = []
    all_res = []
    all_supp = []

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


def main():
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
    except Exception as e:
        print(json.dumps({"error": f"processing failed: {type(e).__name__}: {e}"}), file=sys.stderr)
        sys.exit(1)

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
