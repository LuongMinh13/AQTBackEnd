"""
Orchestrateur pour l'extraction d'une facture TNT.

Usage:
    python3 process_tnt.py <pdf_path> <hub_xlsx_path>

Sortie (stdout) : JSON avec 3 clés :
  - bt_non_identifiables : BT du PDF absents de l'Excel HUB
  - services_options     : lignes dont l'option != "RS"
  - poids_differents     : lignes où le bucket kg PDF > bucket kg HUB

Optimisation : le PDF est ouvert UNE seule fois avec pdfplumber et les
3 extracteurs sont appliqués sur cet objet. Le HUB est lu une fois puis
réutilisé pour les deux comparaisons.
"""
import json
import sys
from pathlib import Path

import pdfplumber

# Ajoute le dossier du script au path pour pouvoir importer les extracteurs
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from tnt_bt_non_identifiables import (
    extract_pdf_rows as btni_extract_pdf_rows,
    extract_tracking_from_excel as btni_extract_excel_bts,
    compute_missing as btni_compute_missing,
)
from tnt_options import extract_option_rows as options_extract_rows
from tnt_poids import (
    extract_pdf_records as poids_extract_pdf_records,
    extract_hub_bt_weight as poids_extract_hub_weights,
    compute_weight_differences as poids_compute_differences,
)


def process(pdf_path: Path, hub_path: Path) -> dict:
    """Ouvre le PDF une fois, lit le HUB une fois, applique les 3 extracteurs."""
    # Excel HUB : on le lit 2 fois (set des BT + map bt->poids). On pourrait
    # factoriser mais ces helpers gèrent la résolution de colonnes proprement.
    excel_bt_set = btni_extract_excel_bts(hub_path)
    hub_weight_map = poids_extract_hub_weights(hub_path)

    with pdfplumber.open(str(pdf_path)) as pdf:
        # 1) BT non identifiables (words + regroupement visuel)
        pdf_records_for_btni = btni_extract_pdf_rows(pdf)
        bt_non_identifiables = btni_compute_missing(pdf_records_for_btni, excel_bt_set)

        # 2) Services / options différents (text splitlines)
        services_options = options_extract_rows(pdf)

        # 3) Poids différents (text splitlines)
        pdf_map_poids = poids_extract_pdf_records(pdf)
        poids_differents = poids_compute_differences(pdf_map_poids, hub_weight_map)

    return {
        "bt_non_identifiables": bt_non_identifiables,
        "services_options": services_options,
        "poids_differents": poids_differents,
    }


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(
            json.dumps({"error": "usage: process_tnt.py <pdf_path> <hub_xlsx_path>"}),
            file=sys.stderr,
        )
        sys.exit(2)

    pdf_path = Path(args[0])
    hub_path = Path(args[1])

    if not pdf_path.exists():
        print(json.dumps({"error": f"PDF not found: {pdf_path}"}), file=sys.stderr)
        sys.exit(3)
    if not hub_path.exists():
        print(json.dumps({"error": f"HUB file not found: {hub_path}"}), file=sys.stderr)
        sys.exit(3)

    try:
        result = process(pdf_path, hub_path)
    except Exception as e:
        print(
            json.dumps({"error": f"processing failed: {type(e).__name__}: {e}"}),
            file=sys.stderr,
        )
        sys.exit(1)

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
