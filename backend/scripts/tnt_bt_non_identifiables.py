#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extrait les BT (16 chiffres) présents dans le PDF TNT mais absents du
fichier Excel HUB (colonne "N° de suivi" par défaut).

Retourne une liste de dicts :
  [{"Ligne_PDF": "ROT DK FR59 ... 6218955002436407 0,60"}, ...]

Adapté depuis script/extract_BTNI.py fourni par l'utilisateur.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import pandas as pd
import pdfplumber

# -----------------------------
# Regex
# -----------------------------
BT_REGEX = re.compile(r"\b\d{16}\b")
DATE_REGEX = re.compile(r"^\d{2}/\d{2}$")
WEIGHT_REGEX = re.compile(r"^\d{1,3},\d{1,2}$")


def _safe_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return str(v)
    return str(v)


def _group_words_by_line(words: List[dict], y_tol: float = 2.0) -> List[List[dict]]:
    if not words:
        return []
    words_sorted = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines: List[List[dict]] = []
    current: List[dict] = []
    current_y: Optional[float] = None
    for w in words_sorted:
        y = w["top"]
        if current_y is None:
            current_y = y
            current = [w]
            continue
        if abs(y - current_y) <= y_tol:
            current.append(w)
        else:
            lines.append(sorted(current, key=lambda z: z["x0"]))
            current_y = y
            current = [w]
    if current:
        lines.append(sorted(current, key=lambda z: z["x0"]))
    return lines


def _clean_token(t: str) -> str:
    return t.strip().replace("\u00ad", "")


def _extract_row_text_after_date_to_weight(tokens: List[str]) -> Optional[str]:
    if not tokens:
        return None
    tokens = [_clean_token(t) for t in tokens if _clean_token(t)]
    if not tokens:
        return None

    bt_idx = None
    for i, t in enumerate(tokens):
        if BT_REGEX.fullmatch(t):
            bt_idx = i
            break
    if bt_idx is None:
        return None

    weight_idx = None
    for j in range(bt_idx + 1, min(bt_idx + 6, len(tokens))):
        if WEIGHT_REGEX.fullmatch(tokens[j]):
            weight_idx = j
            break
    if weight_idx is None:
        return None

    start_idx = 0
    if DATE_REGEX.fullmatch(tokens[0]):
        start_idx = 1
    if start_idx >= bt_idx:
        start_idx = bt_idx

    slice_tokens = tokens[start_idx : weight_idx + 1]
    joined = " ".join(slice_tokens)
    upper = joined.upper()
    if (
        "IBAN" in upper
        or "BIC" in upper
        or "RÉFÉRENCE BANCAIRE" in upper
        or "REFERENCE BANCAIRE" in upper
    ):
        return None
    return joined


def extract_pdf_rows(pdf) -> List[Dict]:
    """Prend un objet pdfplumber.PDF (déjà ouvert) et renvoie tous les records."""
    records: List[Dict] = []
    seen_bt: Set[str] = set()
    for page_index, page in enumerate(pdf.pages, start=1):
        words = page.extract_words(
            x_tolerance=1.5,
            y_tolerance=2.0,
            keep_blank_chars=False,
            use_text_flow=False,
        )
        lines = _group_words_by_line(words, y_tol=2.0)
        for line_words in lines:
            tokens = [w["text"] for w in line_words]
            row = _extract_row_text_after_date_to_weight(tokens)
            if not row:
                continue
            bt = BT_REGEX.search(row).group(0)
            if bt in seen_bt:
                continue
            seen_bt.add(bt)
            records.append({"bt": bt, "page": page_index, "row": row})
    return records


def extract_tracking_from_excel(
    xlsx_path: Path,
    col_name: str = "N° de suivi",
    sheet: Optional[str] = None,
) -> Set[str]:
    df = pd.read_excel(xlsx_path, sheet_name=(sheet if sheet else 0), dtype=object)
    cols_map = {str(c).strip(): c for c in df.columns}
    if col_name not in cols_map:
        lowered = {str(c).strip().lower(): c for c in df.columns}
        if col_name.strip().lower() in lowered:
            real_col = lowered[col_name.strip().lower()]
        else:
            raise KeyError(
                f"Colonne '{col_name}' introuvable. Colonnes dispo: {list(df.columns)}"
            )
    else:
        real_col = cols_map[col_name]

    out: Set[str] = set()
    for v in df[real_col].tolist():
        s = _safe_str(v).strip()
        if not s or s.lower() == "nan":
            continue
        for m in BT_REGEX.findall(s):
            out.add(m)
    return out


def compute_missing(
    pdf_records: List[Dict],
    excel_bt_set: Set[str],
) -> List[Dict[str, str]]:
    """Retourne la liste des lignes PDF dont le BT est absent de l'Excel HUB."""
    return [{"Ligne_PDF": r["row"]} for r in pdf_records if r["bt"] not in excel_bt_set]
