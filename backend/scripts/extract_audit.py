import csv
import sys
from pathlib import Path
import pdfplumber

# Helpers partagés (regex, MONTHS, formatage FR, parsing année/page)
from _ups_common import (
    MONTHS,
    TRACK_RE,
    MONEY_RE,
    DATE_RE,
    default_year,
    parse_year_from_page,
    fr_money_to_float,
    float_to_fr_money,
    normalize_date_fr,
    normalize_line,
)


def find_date_near_block(block_lines, year: str):
    for l in block_lines:
        l2 = normalize_line(l)
        m = DATE_RE.search(l2)
        if m:
            return normalize_date_fr(m.group("d"), m.group("m"), year)
    return None


# ----------------------------
# Extraction logique métier
# ----------------------------
def find_price_net_for_correction(block_lines):
    n = len(block_lines)
    for i in range(n):
        line = normalize_line(block_lines[i])
        if "Frais de correction" not in line:
            continue

        combo = line
        if i + 1 < n:
            combo += " " + normalize_line(block_lines[i + 1])
        if i + 2 < n:
            combo += " " + normalize_line(block_lines[i + 2])

        if "d'expedition" not in combo.lower() and "d'expédition" not in combo.lower():
            continue

        amounts = MONEY_RE.findall(combo)
        if not amounts:
            return None
        return fr_money_to_float(amounts[-1])

    return None


def extract_audit_from_page(text: str, year: str = None):
    lines = [l.strip() for l in (text or "").splitlines() if l.strip()]
    if not lines:
        return []

    if year is None:
        year = parse_year_from_page(text)

    track_positions = []
    for idx, l in enumerate(lines):
        m = TRACK_RE.search(l)
        if m:
            track_positions.append((idx, m.group(0)))

    if not track_positions:
        return []

    results = []
    for pos_idx, (start_i, tracking) in enumerate(track_positions):
        end_i = track_positions[pos_idx + 1][0] if pos_idx + 1 < len(track_positions) else len(lines)
        block_start = max(0, start_i - 6)
        block = lines[block_start:end_i]

        if "Frais de correction" not in "\n".join(block):
            continue

        prix_net = find_price_net_for_correction(block)
        if prix_net is None:
            continue

        date_fr = find_date_near_block(block, year)

        results.append({
            "DATE": date_fr,
            "NUMERO SUIVI": tracking,
            "Description (audited weight)": "Audit Fee",
            "PRIX NET": prix_net
        })

    return results


def extract_audit_from_pdf(pdf_path: Path):
    """Retourne la liste des dictionnaires extraits (sans écrire de CSV)."""
    all_rows = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "Frais de correction" not in text:
                continue
            year = parse_year_from_page(text)
            recs = extract_audit_from_page(text, year=year)
            all_rows.extend(recs)

    # Déduplication
    seen = set()
    dedup = []
    for r in all_rows:
        key = (r.get("DATE"), r.get("NUMERO SUIVI"), r.get("PRIX NET"))
        if key in seen:
            continue
        seen.add(key)
        dedup.append(r)
    return dedup


# ----------------------------
# Traitement PDF -> CSV
# ----------------------------
def process_pdf(pdf_path: Path, out_csv: Path):
    dedup = extract_audit_from_pdf(pdf_path)
    out_csv.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["DATE", "NUMERO SUIVI", "Description (audited weight)", "PRIX NET"]
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";")
        w.writeheader()
        for row in dedup:
            out = dict(row)
            out["PRIX NET"] = float_to_fr_money(out.get("PRIX NET"))
            w.writerow(out)

    print(f"OK: {len(dedup)} lignes extraites -> {out_csv}")


# ----------------------------
# Main (gestion des paths)
# ----------------------------
def main():
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    input_dir = project_root / "data" / "input"
    output_dir = project_root / "data" / "output"

    args = sys.argv[1:]

    if len(args) == 0:
        pdfs = sorted(list(input_dir.glob("*.pdf")) + list(input_dir.glob("*.PDF")))
        if not pdfs:
            print(f"Aucun PDF trouvé dans {input_dir}")
            return

        for pdf_path in pdfs:
            out_csv = output_dir / f"{pdf_path.stem}_audit.csv"
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
        out_csv = output_dir / f"{pdf_path.stem}_audit.csv"

    process_pdf(pdf_path, out_csv)


if __name__ == "__main__":
    main()
