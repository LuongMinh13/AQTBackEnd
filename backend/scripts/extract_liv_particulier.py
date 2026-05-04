# extract_liv_particulier.py
import re
import csv
import sys
from pathlib import Path
import pdfplumber

# Helpers partagés
from _ups_common import (
    MONTHS,
    TRACK_RE,
    MONEY_RE,
    DATE_RE_ANCHORED as DATE_RE,
    default_year,
    parse_year_from_page,
    parse_page_number,
    normalize_date_fr,
)

BAD_CHARS_RE = re.compile(r"[<>|/\\]+")
MULTISPACE_RE = re.compile(r"\s+")

STOP_BLOCK_MARKERS = (
    "Montant total de l'envoi",
    "20,00 % T.V.A",
    "20,00% T.V.A",
    "Total",
)

HEADER_GARBAGE_STARTS = (
    "Détail", "Detail", "Date", "Envoi", "ID parent", "Référence", "Reference",
    "Service", "Zone", "Colis", "Poids", "Conteneur",
)

REFERENCE_STOP_MARKERS = (
    "Expéditeur", "Expediteur", "Destinataire", "Payeur",
    "Description", "Fret", "Taxe", "Surge Fee",
    "Liv.particulier", "Liv. particulier", "Dimensions", "Poids",
)

SERVICE_TOKENS = ("Dom.", "Standard", "Express", "Saver", "Worldwide", "Expedited",)

PKG_TAIL_RE = re.compile(r"(?i)\s*\bPKG\b\s*$")


def norm_line(s: str) -> str:
    s = (s or "").replace("\xa0", " ")
    s = BAD_CHARS_RE.sub(" ", s)
    s = MULTISPACE_RE.sub(" ", s).strip()
    return s


def strip_pkg_from_reference(ref: str) -> str:
    ref = norm_line(ref)
    if not ref:
        return ""
    ref = PKG_TAIL_RE.sub("", ref).strip()
    return ref


def looks_like_reference(s: str) -> bool:
    if not s:
        return False
    x = s.strip()
    if len(x) < 2:
        return False
    if any(x.startswith(h) for h in HEADER_GARBAGE_STARTS):
        return False
    if x == "PKG":
        return False
    if MONEY_RE.search(x):
        return False
    if TRACK_RE.search(x):
        return False
    return True


def split_candidates_from_line(line: str):
    l = norm_line(line)
    l = re.sub(r"^\d{1,2}\s+[A-Za-zéûôîÉÛÔÎ]+\s+", "", l).strip()
    l = TRACK_RE.sub(" ", l)
    l = MULTISPACE_RE.sub(" ", l).strip()

    cut_markers = [" Dom.", " Service ", " Zone ", " Colis ", " Poids", " Conteneur"]
    cut_pos = None
    for cm in cut_markers:
        p = l.find(cm)
        if p != -1:
            cut_pos = p if cut_pos is None else min(cut_pos, p)
    if cut_pos is not None:
        l = l[:cut_pos].strip()

    l = re.sub(r"\b\d{1,3}\b", " ", l)
    l = MULTISPACE_RE.sub(" ", l).strip()

    if not l:
        return []
    return [l]


def pick_reference_from_header_lines(header_lines):
    candidates = []
    for raw in header_lines:
        l = norm_line(raw)
        if not l:
            continue
        if any(m in l for m in REFERENCE_STOP_MARKERS):
            break
        l = MONEY_RE.sub("", l).strip()
        if not l:
            continue
        for cand in split_candidates_from_line(l):
            cand = cand.strip()
            cand = cand.replace("Référence n°:", "").replace("Référence n°", "").replace("Reference n°", "").strip()
            cand = MULTISPACE_RE.sub(" ", cand).strip()
            cand = strip_pkg_from_reference(cand)
            if looks_like_reference(cand):
                candidates.append(cand)

    uniq = []
    seen = set()
    for c in candidates:
        key = c.upper()
        if key not in seen:
            seen.add(key)
            uniq.append(c)

    if not uniq:
        return ""

    def is_numeric_only(s: str) -> bool:
        return bool(re.fullmatch(r"\d+", s.strip()))

    non_numeric = [u for u in uniq if not is_numeric_only(u)]

    if len(non_numeric) >= 2:
        return strip_pkg_from_reference(non_numeric[-1].strip())
    if len(non_numeric) == 1:
        return strip_pkg_from_reference(non_numeric[0].strip())
    return strip_pkg_from_reference(uniq[-1].strip())


def iter_shipments(lines):
    i = 0
    n = len(lines)
    while i < n:
        l = lines[i]
        mdate = DATE_RE.match(l)
        if not mdate:
            i += 1
            continue

        tracking = None
        if TRACK_RE.search(l):
            tracking = TRACK_RE.search(l).group(0)
        else:
            for k in (i + 1, i + 2):
                if k < n and TRACK_RE.search(lines[k]):
                    tracking = TRACK_RE.search(lines[k]).group(0)
                    break
        if not tracking:
            i += 1
            continue

        j = i + 1
        while j < n:
            lj = lines[j]
            m2 = DATE_RE.match(lj)
            if m2:
                if TRACK_RE.search(lj) or (j + 1 < n and TRACK_RE.search(lines[j + 1])) or (j + 2 < n and TRACK_RE.search(lines[j + 2])):
                    break
            if any(sm in lj for sm in STOP_BLOCK_MARKERS):
                j += 1
                break
            j += 1

        block = lines[i:j]
        yield i, j, block
        i = j


def extract_liv_particulier_from_page(text: str, page_no: int, year: str = None):
    if year is None:
        year = parse_year_from_page(text)

    raw_lines = [(l.rstrip()) for l in (text or "").splitlines()]
    lines = [norm_line(l) for l in raw_lines if norm_line(l)]

    results = []
    for _, _, block in iter_shipments(lines):
        block_text = "\n".join(block)
        if not re.search(r"\bLiv\.?\s*particulier\b", block_text, flags=re.IGNORECASE):
            continue

        first_line = block[0]
        mdate = DATE_RE.match(first_line)
        if not mdate:
            for bl in block:
                mdate = DATE_RE.match(bl)
                if mdate:
                    first_line = bl
                    break
        if not mdate:
            continue

        date_fr = normalize_date_fr(mdate.group("d"), mdate.group("m"), year)
        mtrk = TRACK_RE.search(block_text)
        if not mtrk:
            continue
        tracking = mtrk.group(0)

        header_lines = []
        for bl in block:
            header_lines.append(bl)
            if any(m in bl for m in REFERENCE_STOP_MARKERS):
                break

        reference = pick_reference_from_header_lines(header_lines)
        reference = strip_pkg_from_reference(reference)

        results.append({
            "REFERENCE": reference,
            "DATE": date_fr,
            "NUMERO SUIVI": tracking,
            "Description": "Liv.particulier",
        })

    return results


def extract_liv_particulier_from_pdf(pdf_path: Path):
    all_rows = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "Liv.particulier" not in text and "Liv. particulier" not in text:
                continue
            page_no = parse_page_number(text)
            year = parse_year_from_page(text)
            recs = extract_liv_particulier_from_page(text, page_no, year=year)
            all_rows.extend(recs)
    return all_rows


def process_pdf(pdf_path: Path, out_csv: Path):
    all_rows = extract_liv_particulier_from_pdf(pdf_path)
    out_csv.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["REFERENCE", "DATE", "NUMERO SUIVI", "Description"]
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";")
        w.writeheader()
        for r in all_rows:
            w.writerow(dict(r))

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
            out_csv = output_dir / f"{pdf_path.stem}_liv_particulier.csv"
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
        out_csv = output_dir / f"{pdf_path.stem}_liv_particulier.csv"

    process_pdf(pdf_path, out_csv)


if __name__ == "__main__":
    main()
