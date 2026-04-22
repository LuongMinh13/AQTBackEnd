#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compare les poids entre un PDF TNT et un fichier Excel HUB.
Exporte les lignes où le bucket kg PDF > bucket kg HUB.

Retourne :
  [
    {
      "CLIENT": "...",
      "Saisie MBE OnLine": "3,00",
      "Régularisation": "",
      "SC": "",
      "TOTAL": "",
    },
    ...
  ]

NOTE : la colonne "Régularisation" est laissée vide — la logique tarifs
n'est pas branchée pour l'instant (cf. extratc_poidv2.py mis de côté).

Adapté depuis script/extract_poid.py fourni par l'utilisateur.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

# -----------------------------
# Regex / helpers
# -----------------------------
BT_REGEX = re.compile(r"\b\d{16}\b")
DATE_PREFIX = re.compile(r"^\s*\d{2}/\d{2}\s+")
AFTER_BT_WEIGHT = re.compile(r"^\s*(?:V\s*)?(?P<w>\d+(?:[.,]\d+)?)\b")


def _safe_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return str(v)
    return str(v)


def _parse_fr_decimal(s: str) -> Optional[Decimal]:
    s = (s or "").strip()
    if not s:
        return None
    s = s.replace("\u00A0", " ").strip().replace(",", ".")
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _fmt_fr_2(x: Decimal) -> str:
    return str(x.quantize(Decimal("0.00"))).replace(".", ",")


def _kg_bucket(w: Decimal) -> int:
    """0,0 -> 0 ; 1,0 -> 1 ; 1,1..1,9 -> 2 ; 2,0 -> 2 ; 2,1..2,9 -> 3 ..."""
    if w <= 0:
        return 0
    if w == w.to_integral_value():
        return int(w)
    return int(w.to_integral_value(rounding="ROUND_FLOOR")) + 1


# -----------------------------
# PDF
# -----------------------------
def extract_pdf_records(pdf) -> Dict[str, Dict]:
    """Prend un pdfplumber.PDF ouvert et retourne bt -> {client, pdf_weight}."""
    bt_map: Dict[str, Dict] = {}
    for page_index, page in enumerate(pdf.pages, start=1):
        text = page.extract_text() or ""
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

        for ln in lines:
            m_bt = BT_REGEX.search(ln)
            if not m_bt:
                continue
            bt = m_bt.group(0)
            if bt in bt_map:
                continue

            ln_no_date = DATE_PREFIX.sub("", ln).strip()
            m_bt2 = BT_REGEX.search(ln_no_date)
            if not m_bt2:
                continue

            bt_end = m_bt2.end()
            after = ln_no_date[bt_end:]
            m_w = AFTER_BT_WEIGHT.search(after)
            if not m_w:
                continue

            w_dec = _parse_fr_decimal(m_w.group("w"))
            if w_dec is None:
                continue

            cut_len = bt_end + m_w.end()
            client = ln_no_date[:cut_len].strip()

            bt_map[bt] = {
                "bt": bt,
                "client": client,
                "pdf_weight": w_dec,
                "page": page_index,
            }
    return bt_map


# -----------------------------
# Excel HUB
# -----------------------------
def extract_hub_bt_weight(
    xlsx_path: Path,
    bt_col: str = "N° de suivi",
    weight_col: str = "Poids transporteur",
    sheet: Optional[str] = None,
) -> Dict[str, Decimal]:
    df = pd.read_excel(xlsx_path, sheet_name=(sheet if sheet else 0), dtype=object)

    cols_map = {str(c).strip(): c for c in df.columns}
    low_map = {str(c).strip().lower(): c for c in df.columns}

    def _resolve_col(name: str):
        if name in cols_map:
            return cols_map[name]
        n2 = name.strip().lower()
        if n2 in low_map:
            return low_map[n2]
        raise KeyError(
            f"Colonne '{name}' introuvable. Colonnes dispo: {list(df.columns)}"
        )

    real_bt_col = _resolve_col(bt_col)
    real_w_col = _resolve_col(weight_col)

    out: Dict[str, Decimal] = {}
    for bt_val, w_val in zip(df[real_bt_col].tolist(), df[real_w_col].tolist()):
        bt_s = _safe_str(bt_val).strip()
        if not bt_s or bt_s.lower() == "nan":
            continue
        m = BT_REGEX.search(bt_s)
        if not m:
            continue
        bt = m.group(0)

        w_s = _safe_str(w_val).strip()
        if not w_s or w_s.lower() == "nan":
            continue
        w_dec = _parse_fr_decimal(w_s)
        if w_dec is None:
            continue
        out[bt] = w_dec
    return out


# -----------------------------
# Compare
# -----------------------------
def compute_weight_differences(
    pdf_map: Dict[str, Dict],
    hub_map: Dict[str, Decimal],
) -> List[Dict[str, str]]:
    """Lignes où le bucket kg PDF > bucket kg HUB."""
    rows: List[Dict[str, str]] = []
    for bt, rec in pdf_map.items():
        hub_w = hub_map.get(bt)
        if hub_w is None:
            continue
        pdf_w: Decimal = rec["pdf_weight"]
        if _kg_bucket(pdf_w) > _kg_bucket(hub_w):
            rows.append(
                {
                    "CLIENT": rec["client"],
                    "Saisie MBE OnLine": _fmt_fr_2(hub_w),
                    # Logique tarifs non branchée pour l'instant
                    "Régularisation": "",
                    "SC": "",
                    "TOTAL": "",
                }
            )
    return rows
