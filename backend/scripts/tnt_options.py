#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extrait les lignes de facture TNT dont le service/option != "RS".

Retourne une liste de dicts :
  [{"CLIENT": "...", "OPTION": "RS - ZEL"}, ...]

Adapté depuis script/extract_option.py fourni par l'utilisateur.
"""
from __future__ import annotations

import re
from typing import Dict, List

# BT TNT = 16 chiffres
BT_REGEX = re.compile(r"\b\d{16}\b")

# Date en début de ligne: "03/11 "
DATE_PREFIX = re.compile(r"^\s*\d{2}/\d{2}\s+")

AFTER_BT_PATTERN = re.compile(
    r"""
    ^\s*
    (?:(?P<v>V)\s+)?
    (?P<poids>\d+(?:[.,]\d+)?)\s+
    (?P<produit>[A-Z0-9]{2,5})\s+
    (?P<prix_transport>-?\d+(?:[.,]\d+)?)\s+
    (?P<svc>.+?)\s+
    (?P<prix_svc>-?\d+(?:[.,]\d+)?)\s+
    (?P<total>-?\d+(?:[.,]\d+)?)\s*
    $
    """,
    re.VERBOSE,
)

DASH_CHARS = {
    "\u2212": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u2012": "-",
    "\u2010": "-",
    "\u00ad": "-",
}


def _normalize_spaces(s: str) -> str:
    s = (s or "").replace("\u00A0", " ")
    return re.sub(r"\s+", " ", s).strip()


def _normalize_dashes(s: str) -> str:
    for ch, rep in DASH_CHARS.items():
        s = s.replace(ch, rep)
    return s


def _normalize_option(s: str) -> str:
    s = _normalize_spaces(_normalize_dashes(s))
    s = re.sub(r"\s*-\s*", " - ", s)
    return _normalize_spaces(s)


def extract_option_rows(pdf) -> List[Dict[str, str]]:
    """Prend un objet pdfplumber.PDF ouvert et retourne les lignes option!=RS."""
    rows: List[Dict[str, str]] = []
    seen_keys = set()

    for page in pdf.pages:
        text = page.extract_text() or ""
        lines = [ln for ln in text.splitlines() if ln.strip()]

        for raw_ln in lines:
            ln = _normalize_spaces(raw_ln)

            m_bt = BT_REGEX.search(ln)
            if not m_bt:
                continue
            bt = m_bt.group(0)

            ln_no_date = _normalize_spaces(DATE_PREFIX.sub("", ln))

            m_bt2 = BT_REGEX.search(ln_no_date)
            if not m_bt2:
                continue

            prefix = _normalize_spaces(ln_no_date[: m_bt2.start()])
            rest = _normalize_spaces(ln_no_date[m_bt2.end() :])

            m = AFTER_BT_PATTERN.match(rest)
            if not m:
                continue

            poids = m.group("poids")
            produit = m.group("produit")
            prix_transport = m.group("prix_transport")
            svc_raw = m.group("svc")
            prix_svc = m.group("prix_svc")
            total = m.group("total")

            option = _normalize_option(svc_raw)
            if option == "RS":
                continue

            client_parts: List[str] = []
            if prefix:
                client_parts.append(prefix)
            client_parts.extend([bt, poids, produit, prix_transport, prix_svc, total])
            client = _normalize_spaces(" ".join(client_parts))

            key = (client, option)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            rows.append({"CLIENT": client, "OPTION": option})

    return rows
