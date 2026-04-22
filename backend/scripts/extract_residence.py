import re
import csv
import sys
from datetime import datetime
from pathlib import Path
import pdfplumber

MONTHS = {
    "Jan": "01", "Fév": "02", "Fev": "02", "Mar": "03", "Avr": "04", "Mai": "05", "Juin": "06",
    "Juil": "07", "Aoû": "08", "Aou": "08", "Sep": "09", "Oct": "10", "Nov": "11", "Déc": "12", "Dec": "12"
}

MONEY_RE = re.compile(r"\b\d{1,3}(?:[ \xa0]\d{3})*,\d{2}\b")
TRACK_RE = re.compile(r"\b1Z[A-Z0-9]{16}\b")
DATE_RE = re.compile(r"^(?P<d>\d{1,2})\s+(?P<m>[A-Za-zéûôîÉÛÔÎ]+)\b")


def default_year() -> str:
    return str(datetime.now().year)


def parse_page_number(text: str):
    m = re.search(r"Page:\s*(\d+)\s+de\s+\d+", text)
    return int(m.group(1)) if m else None


def parse_year_from_page(text: str, default: str = None) -> str:
    if default is None:
        default = default_year()
    m = re.search(r"Date facture\s+\d{1,2}\s+[A-Za-zéûôîÉÛÔÎ]+\s+(\d{4})", text or "")
    return m.group(1) if m else default


def fr_money_to_float(s: str):
    if not s:
        return None
    s = s.replace("\xa0", " ").strip()
    s = s.replace(" ", "")
    s = s.replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None


def float_to_fr_money(x):
    if x is None or x == "":
        return ""
    try:
        return f"{float(x):.2f}".replace(".", ",")
    except Exception:
        return ""


def normalize_date_fr(day: str, mon: str, year: str):
    mon3 = mon[:3]
    mon_num = MONTHS.get(mon3)
    if not mon_num:
        return None
    dd = f"{int(day):02d}"
    return f"{dd}/{mon_num}/{year}"


def clean_reference_lines(chunk_lines):
    no_money = []
    for l in chunk_lines:
        l2 = MONEY_RE.sub("", l).strip()
        if l2:
            no_money.append(l2)

    banned_starts = (
        "Résidence", "Date", "Envoi", "Référence", "Montant", "Remise", "Prix net",
        "Total", "20,00", "T.V.A", "EUR"
    )

    filtered = []
    for l in no_money:
        if any(l.startswith(b) for b in banned_starts):
            continue
        l = TRACK_RE.sub("", l).strip()
        l = re.sub(r"^\d{1,2}\s+[A-Za-zéûôîÉÛÔÎ]+\s+", "", l).strip()
        if l:
            filtered.append(l)

    if not filtered:
        return ""

    def is_useless(x):
        x = x.strip()
        return (not x) or x in ("#",)

    if len(filtered) >= 2 and re.fullmatch(r"\d+", filtered[0].strip()):
        for cand in reversed(filtered[1:]):
            if not is_useless(cand):
                return cand.strip()

    for cand in reversed(filtered):
        if not is_useless(cand):
            return cand.strip()

    return filtered[-1].strip()


def extract_residence_from_page(text: str, page_no: int, year: str = None):
    if year is None:
        year = parse_year_from_page(text)

    lines = [l.rstrip() for l in (text or "").splitlines() if l.strip()]

    if not any("Résidence" in l for l in lines):
        return []

    stop_markers = (
        "Total Frais Régularisation résidence",
        "Total Frais Régularisation résidence.",
        "Total Frais Régularisation résidence (suite)",
    )

    results = []
    in_residence = False
    i = 0

    while i < len(lines):
        l = lines[i].strip()

        if ("Résidence" in l) and ("Total" not in l):
            in_residence = True
            i += 1
            continue

        if not in_residence:
            i += 1
            continue

        if any(sm in l for sm in stop_markers):
            break

        mdate = DATE_RE.match(l)
        if mdate and TRACK_RE.search(l):
            day = mdate.group("d")
            mon = mdate.group("m")
            date_fr = normalize_date_fr(day, mon, year)
            tracking = TRACK_RE.search(l).group(0)

            chunk_lines = [l]
            j = i + 1
            while j < len(lines):
                nxt = lines[j].strip()
                if any(sm in nxt for sm in stop_markers):
                    break
                mdate2 = DATE_RE.match(nxt)
                if mdate2 and TRACK_RE.search(nxt):
                    break
                if nxt.startswith("20,00") or nxt.startswith("T.V.A") or nxt.startswith("Total"):
                    break
                chunk_lines.append(nxt)
                j += 1

            reference = clean_reference_lines(chunk_lines)

            results.append({
                "REFERENCE": reference,
                "DATE": date_fr,
                "NUMERO SUIVI": tracking,
                "Description": "Livraison résidentielle",
            })

            i = j
            continue

        i += 1

    return results


def extract_residence_from_pdf(pdf_path: Path):
    all_rows = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "Résidence" not in text:
                continue
            page_no = parse_page_number(text)
            year = parse_year_from_page(text)
            recs = extract_residence_from_page(text, page_no, year=year)
            all_rows.extend(recs)
    return all_rows


def process_pdf(pdf_path: Path, out_csv: Path):
    all_rows = extract_residence_from_pdf(pdf_path)
    out_csv.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["REFERENCE", "DATE", "NUMERO SUIVI", "Description"]
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";")
        w.writeheader()
        for r in all_rows:
            w.writerow(r)

    print(f"OK: {len(all_rows)} lignes extraites -> {out_csv}")


def main():
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    input_dir = project_root / "data" / "input"
    output_dir = project_root / "data" / "output"

    args = sys.argv[1:]

    if len(args) == 0:
        pdfs = list(input_dir.glob("*.pdf")) + list(input_dir.glob("*.PDF"))
        if not pdfs:
            print(f"Aucun PDF trouvé dans {input_dir}")
            return
        for pdf_path in sorted(pdfs):
            out_csv = output_dir / f"{pdf_path.stem}_residence.csv"
            process_pdf(pdf_path, out_csv)
        return

    pdf_arg = Path(args[0])
    if not pdf_arg.is_absolute():
        candidate = input_dir / pdf_arg
        pdf_path = candidate if candidate.exists() else project_root / pdf_arg
    else:
        pdf_path = pdf_arg

    if not pdf_path.exists():
        print(f"PDF introuvable: {pdf_path}")
        return

    if len(args) >= 2:
        out_csv = Path(args[1])
        if not out_csv.is_absolute():
            out_csv = output_dir / out_csv
    else:
        out_csv = output_dir / f"{pdf_path.stem}_residence.csv"

    process_pdf(pdf_path, out_csv)


if __name__ == "__main__":
    main()
