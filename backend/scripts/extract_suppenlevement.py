import re
import csv
import sys
from datetime import datetime
from pathlib import Path
import pdfplumber


def compute_prix_vente(prix_net):
    if prix_net is None:
        return None
    if abs(prix_net - 0.58) < 0.001:
        return 0.80
    if abs(prix_net - 2.17) < 0.001:
        return 2.80
    return None


MONTHS = {
    "Jan": "01", "Fév": "02", "Fev": "02", "Mar": "03", "Avr": "04", "Mai": "05",
    "Juin": "06", "Juil": "07", "Aoû": "08", "Aou": "08", "Sep": "09", "Oct": "10",
    "Nov": "11", "Déc": "12", "Dec": "12"
}


def default_year() -> str:
    return str(datetime.now().year)


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


def parse_year_from_page(text: str, default: str = None) -> str:
    if default is None:
        default = default_year()
    m = re.search(r"Date facture\s+\d{1,2}\s+[A-Za-zéûôîÉÛÔÎ]+\s+(\d{4})", text or "")
    return m.group(1) if m else default


def parse_date_demande_from_dem_raw(dem_raw: str, year: str):
    m = re.search(r"(\d{2})\s+([A-Za-zéûôîÉÛÔÎ]+)", dem_raw.strip())
    if not m:
        return None
    day = m.group(1)
    mon = m.group(2)[:3]
    mon_num = MONTHS.get(mon, None)
    if not mon_num:
        return None
    return f"{day}/{mon_num}/{year}"


def extract_records_from_text(text: str, year: str = None):
    if year is None:
        year = parse_year_from_page(text)

    records = []

    line_pat = re.compile(
        r"(?P<send>\d{2}\s+[A-Za-zéûôîÉÛÔÎ]+)\s+"
        r"(?P<dem>\d{2}\s+[A-Za-zéûôîÉÛÔÎ]+)\s+"
        r"(?P<num>[A-Z0-9]{10,14})\s+"
        r"(?P<ref>.+)"
    )

    lines = [l.strip() for l in text.splitlines() if l.strip()]

    for i, line in enumerate(lines):
        m = line_pat.match(line)
        if not m:
            continue

        num = m.group("num").strip()
        ref = m.group("ref").strip()
        dem_raw = m.group("dem").strip()
        date_demande = parse_date_demande_from_dem_raw(dem_raw, year)

        j = i + 1
        chunk_lines = [line]
        while j < len(lines):
            if line_pat.match(lines[j]):
                break
            chunk_lines.append(lines[j])
            j += 1
        chunk = "\n".join(chunk_lines)

        desc = None
        prix_net = None
        prix_vente = None

        md = re.search(
            r"(Autre adresse\s*-\s*.+?)\s+(\d+,\d{2})\s+(\d+,\d{2})\s+(\d+,\d{2})",
            chunk
        )
        if md:
            desc = md.group(1).strip()
            prix_net = fr_money_to_float(md.group(4))
            prix_vente = compute_prix_vente(prix_net)
        else:
            mdesc = re.search(r"(Autre adresse\s*-\s*.+)", chunk)
            desc = mdesc.group(1).strip() if mdesc else None

        records.append({
            "CLIENT": ref,
            "DATE DEMANDE": date_demande,
            "NUMERO DEMANDE": num,
            "DESCRIPTION": desc,
            "PRIX NET": prix_net,
            "PRIX VENTE": prix_vente
        })

    return records


def extract_suppenlevement_from_pdf(pdf_path: Path):
    all_rows = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "Demande d'enlèvement" not in text:
                continue
            year = parse_year_from_page(text)
            recs = extract_records_from_text(text, year=year)
            all_rows.extend(recs)
    return all_rows


def process_pdf(pdf_path: Path, out_csv: Path):
    all_rows = extract_suppenlevement_from_pdf(pdf_path)
    out_csv.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["CLIENT", "DATE DEMANDE", "NUMERO DEMANDE", "DESCRIPTION", "PRIX NET", "PRIX VENTE"]
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";")
        w.writeheader()
        for row in all_rows:
            row_out = dict(row)
            row_out["PRIX NET"] = float_to_fr_money(row_out.get("PRIX NET"))
            row_out["PRIX VENTE"] = float_to_fr_money(row_out.get("PRIX VENTE"))
            w.writerow(row_out)

    print(f"OK: {len(all_rows)} lignes extraites -> {out_csv}")


def main():
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    input_dir = project_root / "data" / "input"
    output_dir = project_root / "data" / "output"

    args = sys.argv[1:]

    if len(args) == 0:
        pdfs = sorted(list(input_dir.glob("*.pdf")) + list(input_dir.glob("*.PDF")))
        if not pdfs:
            print(f"Aucun PDF trouvé dans: {input_dir}")
            return
        for pdf_path in pdfs:
            out_csv = output_dir / f"{pdf_path.stem}_suppenlevement.csv"
            process_pdf(pdf_path, out_csv)
        return

    pdf_arg = Path(args[0])
    if not pdf_arg.is_absolute():
        candidate = input_dir / pdf_arg
        pdf_path = candidate if candidate.exists() else (project_root / pdf_arg)
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
        out_csv = output_dir / f"{pdf_path.stem}_suppenlevement.csv"

    process_pdf(pdf_path, out_csv)


if __name__ == "__main__":
    main()
