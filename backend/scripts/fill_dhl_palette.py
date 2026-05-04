#!/usr/bin/env python3
"""
Remplit le template DHL Freight Palette avec les données d'une demande,
en mode "patch binaire" : on copie le template octet par octet et on ne
modifie QUE les cellules visées dans xl/worksheets/sheet1.xml.

Cette approche évite tous les effets de bord d'openpyxl (drawings
ré-ancrés, externalLinks dégradés, styles altérés, …) qui font que le
fichier n'est plus identique au template DHL d'origine.

Usage:
    python3 fill_dhl_palette.py <template_path> <input_json_path> <output_path>

Le JSON d'entrée attendu (toutes les clés sont optionnelles sauf mention) :
{
  "dates": {
    "emission": "22.04.2026",
    "cotation": "22.04.2026"
  },
  "enlevement": {
    "societe": "...",
    "adresse": "...\\n...\\n..." ou list[str],
    "contact": "...",
    "tel": "..."
  },
  "livraison":  { ... idem ... },
  "cp_enlevement": "34130",
  "cp_livraison":  "62490",
  "palettes": [
    { "poids": 120, "dimensions": "120x80x160", "gerbable": false },
    ...
  ]
}
"""
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape


SHEET_PATH = "xl/worksheets/sheet1.xml"
CALC_CHAIN_PATH = "xl/calcChain.xml"

# ====================
#  Mapping cellules
# ====================
CELL_DATE_EMISSION = "G12"
CELL_DATE_COTATION = "G13"
CELL_VALIDITE      = "G14"   # vidée
CELL_DATE_BOOKING  = "G15"   # vidée

CELL_ENL_SOCIETE   = "G26"
# Lignes adresse : adresse1, adresse2, cp+ville, pays
CELL_ENL_ADRESSE1  = "G27"
CELL_ENL_ADRESSE2  = "G28"
CELL_ENL_CPVILLE   = "G29"
CELL_ENL_PAYS      = "G30"
CELL_ENL_CONTACT   = "G31"
CELL_ENL_TEL       = "G32"

CELL_LIV_SOCIETE   = "K26"
CELL_LIV_ADRESSE1  = "K27"
CELL_LIV_ADRESSE2  = "K28"
CELL_LIV_CPVILLE   = "K29"
CELL_LIV_PAYS      = "K30"
CELL_LIV_CONTACT   = "K31"
CELL_LIV_TEL       = "K32"

CELL_RELATION      = "M47"

# Palettes : 5 lignes utiles (51-55), colonnes F/G/H/I.
# Row 56 (G56:K56 fusionnée) reçoit le COÛT HT — voir cellules tarif.
COLISAGE_ROWS  = [51, 52, 53, 54, 55]
COL_COLISAGE   = "F"
COL_POIDS_REEL = "G"
COL_DIMENSIONS = "H"
COL_GERBABLE   = "I"

# ----- Cellules tarif (bas de la fiche) -----
CELL_COUT_HT          = "G56"   # Transport Net (hors TVA, excl. Fuel)
CELL_FUEL_SURCHARGE   = "H59"   # Fuel surcharge SG
# Assurance Ad Valorem (optionnelle) :
#   C61 = libellé "Assurance Ad Valorem <valeur>€"
#   D61 = montant (valeur × taux/100)
# Quand l'assurance est désactivée, les deux cellules sont vidées pour
# éviter qu'un contenu résiduel du template reste affiché.
CELL_ASSURANCE_LABEL  = "C61"
CELL_ASSURANCE_VALUE  = "D61"
CELL_TOTAL_AUTRES     = "G63"   # Total autres frais (fuel + assurance)
CELL_TOTAL_TRANSPORT  = "G65"   # Total Transport (hors TVA, incl. Fuel + assurance)


# ====================
#  Helpers données
# ====================
def split_adresse(adresse, max_lines=4):
    if adresse is None:
        return []
    if isinstance(adresse, list):
        lines = [str(x) for x in adresse if x is not None and str(x).strip()]
    else:
        lines = [l for l in str(adresse).split("\n") if l.strip()]
    return lines[:max_lines]


def format_gerbable(g):
    if g is True or str(g).lower() in ("o", "oui", "y", "yes", "true", "1"):
        return "O"
    return "N"


# ====================
#  Patch sheet1.xml
# ====================
# Une <c> peut s'étaler sur plusieurs lignes (rare, mais possible). On
# capture donc paresseusement jusqu'à </c> ou la balise auto-fermante.
_CELL_RE_TEMPLATE = (
    r'(<c\b[^>]*\br="{ref}"[^>]*?)(?:'
    r'/>'                       # cellule vide auto-fermée
    r'|'
    r'>.*?</c>'                 # cellule avec contenu
    r')'
)


def _build_cell_xml(ref, style, value):
    """Construit le XML d'une <c> patchée, en préservant le style.

    - Si value est None ou "" → cellule vide (<c r=... s=.../>)
    - Si value est numérique  → <c r=... s=... t="n"><v>...</v></c>
    - Sinon (texte)           → <c r=... s=... t="inlineStr"><is><t>...</t></is></c>
    """
    s_attr = f' s="{style}"' if style else ""
    if value is None or value == "":
        return f'<c r="{ref}"{s_attr}/>'

    # Nombre ?
    # IMPORTANT : on ne convertit JAMAIS un str en number ici, sinon on
    # casse les téléphones ("0658…" → 658…), les codes postaux ("01000"
    # → 1000), etc. La conversion str→float doit être faite EXPLICITEMENT
    # en amont par collect_updates() pour les seules valeurs numériques
    # (poids notamment).
    is_number = isinstance(value, (int, float)) and not isinstance(value, bool)
    num_value = value if is_number else None

    if is_number:
        # int "propre" si pas de décimale
        if isinstance(num_value, float) and num_value.is_integer():
            txt = str(int(num_value))
        else:
            txt = str(num_value)
        return f'<c r="{ref}"{s_attr} t="n"><v>{txt}</v></c>'

    # Texte → inlineStr (xml:space="preserve" pour conserver les espaces)
    txt = xml_escape(str(value))
    return (
        f'<c r="{ref}"{s_attr} t="inlineStr">'
        f'<is><t xml:space="preserve">{txt}</t></is>'
        f'</c>'
    )


def _col_to_index(col_letters):
    """A→1, B→2, …, AA→27."""
    n = 0
    for ch in col_letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n


def _split_ref(ref):
    """A1 → ('A', 1)."""
    m = re.match(r"([A-Z]+)(\d+)", ref)
    return m.group(1), int(m.group(2))


def _insert_cell(sheet_xml, ref, value):
    """Insère une <c> dans la <row> correspondante, ou crée la <row>.

    On respecte l'ordre des cellules par index de colonne, ce qu'Excel
    exige strictement (sinon il considère le fichier corrompu).
    """
    col, row = _split_ref(ref)
    target_idx = _col_to_index(col)
    new_c = _build_cell_xml(ref, None, value)

    # Cherche la <row r="row" …>…</row>
    row_re = re.compile(
        r'(<row\b[^>]*\br="' + str(row) + r'"[^>]*?)(/>|>(.*?)</row>)',
        re.DOTALL,
    )
    rm = row_re.search(sheet_xml)
    if not rm:
        # Pas de row → insère une nouvelle row dans <sheetData>.
        # On respecte l'ordre des rows par numéro.
        sd_re = re.compile(r'(<sheetData>)(.*?)(</sheetData>)', re.DOTALL)
        sdm = sd_re.search(sheet_xml)
        if not sdm:
            raise ValueError("sheetData introuvable")
        rows_block = sdm.group(2)
        # Insère avant la première row dont r > row
        insert_pos = len(rows_block)
        for m2 in re.finditer(r'<row\b[^>]*\br="(\d+)"', rows_block):
            if int(m2.group(1)) > row:
                insert_pos = m2.start()
                break
        new_row = f'<row r="{row}">{new_c}</row>'
        new_block = rows_block[:insert_pos] + new_row + rows_block[insert_pos:]
        return sheet_xml[:sdm.start()] + sdm.group(1) + new_block + sdm.group(3) + sheet_xml[sdm.end():]

    # Row trouvée
    opening = rm.group(1)
    closer = rm.group(2)
    if closer == "/>":
        # Row auto-fermée (vide) : on l'ouvre et on ajoute la cellule
        new_row = opening + ">" + new_c + "</row>"
        return sheet_xml[:rm.start()] + new_row + sheet_xml[rm.end():]

    inner = rm.group(3)
    # Trouve la position d'insertion par index de colonne
    insert_pos = len(inner)
    for cm in re.finditer(r'<c\b[^>]*\br="([A-Z]+)\d+"', inner):
        if _col_to_index(cm.group(1)) > target_idx:
            insert_pos = cm.start()
            break
    new_inner = inner[:insert_pos] + new_c + inner[insert_pos:]
    new_row = opening + ">" + new_inner + "</row>"
    return sheet_xml[:rm.start()] + new_row + sheet_xml[rm.end():]


def patch_calc_chain(calc_xml, removed_refs):
    """Retire les entrées <c r="REF"/> du calcChain pour les cellules dont
    on a supprimé la formule. Sans ça, Excel/LibreOffice affiche une
    alerte "We found a problem with content" car le calcChain référence
    des cellules-formules qui n'en sont plus.
    """
    if not calc_xml or not removed_refs:
        return calc_xml
    out = calc_xml
    for ref in removed_refs:
        # Retire <c r="REF" .../> (avec ou sans attributs supplémentaires)
        pat = re.compile(r'<c\b[^>]*\br="' + re.escape(ref) + r'"[^/>]*/>')
        out = pat.sub("", out)
    return out


def patch_sheet(sheet_xml, updates, formula_refs_dropped=None):
    """Patche les cellules listées dans updates ({ref: value}).

    Conserve l'attribut s="…" (style) des cellules existantes pour ne
    pas casser polices / couleurs / bordures du template.

    formula_refs_dropped : set optionnel rempli par l'appelant avec les
    refs des cellules dont on a écrasé une formule (utile pour nettoyer
    calcChain.xml ensuite).
    """
    out = sheet_xml
    for ref, value in updates.items():
        regex = re.compile(_CELL_RE_TEMPLATE.format(ref=ref), re.DOTALL)
        m = regex.search(out)
        if not m:
            # Cellule absente du XML d'origine.
            #  - Si on n'a rien à y écrire (valeur vide), on ignore
            #    silencieusement : la cellule restera "vraiment" vide.
            #  - Sinon, on l'insère dans la <row> correspondante en
            #    respectant l'ordre des références (Excel l'exige).
            if value is None or value == "":
                continue
            out = _insert_cell(out, ref, value)
            continue
        opening = m.group(1)  # contient <c r="..." s="..." t="..." …
        # Récupère le style éventuel
        style_match = re.search(r'\bs="([^"]+)"', opening)
        style = style_match.group(1) if style_match else None
        # Si la cellule contenait une formule, on note qu'on l'a supprimée
        # (pour nettoyer calcChain.xml ensuite).
        full_match = m.group(0)
        if formula_refs_dropped is not None and "<f" in full_match:
            formula_refs_dropped.add(ref)
        new_c = _build_cell_xml(ref, style, value)
        out = out[: m.start()] + new_c + out[m.end():]
    return out


# ====================
#  Pipeline principal
# ====================
def collect_updates(data):
    """Construit la liste {cell_ref: value} à patcher dans la feuille."""
    updates = {}

    dates = data.get("dates") or {}
    if dates.get("emission"):
        updates[CELL_DATE_EMISSION] = dates["emission"]
    if dates.get("cotation"):
        updates[CELL_DATE_COTATION] = dates["cotation"]
    # Validité + date of booking → toujours vidées
    updates[CELL_VALIDITE] = ""
    updates[CELL_DATE_BOOKING] = ""

    def fill_party(party, cell_soc, cell_adr1, cell_adr2, cell_cpville,
                   cell_pays, cell_ct, cell_tel):
        if not party:
            return
        if party.get("societe"):
            updates[cell_soc] = party["societe"]

        # Adresse structurée — chaque ligne va dans sa propre cellule.
        # Si adresse2 est vide, on NE TOUCHE PAS à la cellule (le template
        # peut contenir une valeur de remplissage qui doit rester intacte).
        adresse1 = (party.get("adresse1") or "").strip()
        adresse2 = (party.get("adresse2") or "").strip()
        cp = (party.get("cp") or "").strip()
        ville = (party.get("ville") or "").strip()
        pays = (party.get("pays") or "").strip()

        # Fallback pour rétro-compat : si adresse1 absent mais "adresse"
        # multi-ligne fournie, on resplitte.
        if not adresse1 and party.get("adresse"):
            split = split_adresse(party.get("adresse"), max_lines=4)
            if split:
                adresse1 = split[0] if len(split) > 0 else ""
                if len(split) >= 4:
                    adresse2 = split[1]
                    cpville_legacy = split[2]
                    pays = split[3] or pays
                else:
                    cpville_legacy = split[1] if len(split) > 1 else ""
                    pays = split[2] if len(split) > 2 else pays
                # Si on a déjà cp/ville structurés, on garde, sinon on
                # prend la valeur reconstruite.
                if not (cp or ville) and cpville_legacy:
                    cp = ""
                    ville = cpville_legacy

        updates[cell_adr1] = adresse1
        if adresse2:
            updates[cell_adr2] = adresse2
        # Sinon : on ne met pas la cellule dans updates → cellule intacte.
        cpville = " ".join([s for s in (cp, ville) if s])
        updates[cell_cpville] = cpville
        updates[cell_pays] = pays

        if party.get("contact"):
            updates[cell_ct] = party["contact"]
        if party.get("tel"):
            # Tél : forcé en string pour préserver les "0" initiaux
            updates[cell_tel] = str(party["tel"])

    fill_party(
        data.get("enlevement"),
        CELL_ENL_SOCIETE,
        CELL_ENL_ADRESSE1, CELL_ENL_ADRESSE2,
        CELL_ENL_CPVILLE,  CELL_ENL_PAYS,
        CELL_ENL_CONTACT,  CELL_ENL_TEL,
    )
    fill_party(
        data.get("livraison"),
        CELL_LIV_SOCIETE,
        CELL_LIV_ADRESSE1, CELL_LIV_ADRESSE2,
        CELL_LIV_CPVILLE,  CELL_LIV_PAYS,
        CELL_LIV_CONTACT,  CELL_LIV_TEL,
    )

    cp_enl = (data.get("cp_enlevement") or "").strip()
    cp_liv = (data.get("cp_livraison") or "").strip()
    updates[CELL_RELATION] = f"de FR-{cp_enl} à FR-{cp_liv}"

    # ----- Bloc tarif (bas de la fiche) -----
    # On écrit les valeurs numériques en dur pour remplacer les formules
    # cachées du template (qui pointent vers G56 / contiennent un taux
    # hard-codé 0.1067 incorrect). Si aucune donnée tarif n'est fournie,
    # on remplit quand même avec 0 — il ne faut JAMAIS laisser ces cellules
    # avec leurs formules buguées du template (sinon coût HT reste vide
    # et "Total Transport" calcule via une formule hard-codée sur G56).
    tarif = data.get("tarif") or {}

    def _to_num(v, default=0.0):
        try:
            n = float(v)
            return n if n == n else default  # filtre NaN
        except (TypeError, ValueError):
            return default

    cout_ht = _to_num(tarif.get("coutHT"))
    fuel = _to_num(tarif.get("fuel"))
    # coutTotal : si non fourni explicitement → coutHT + fuel
    if tarif.get("coutTotal") not in (None, ""):
        cout_total = _to_num(tarif.get("coutTotal"))
    else:
        cout_total = cout_ht + fuel

    updates[CELL_COUT_HT]         = round(cout_ht, 2)
    updates[CELL_FUEL_SURCHARGE]  = round(fuel, 2)

    # ----- Assurance Ad Valorem (optionnelle) -----
    # Schéma payload : { enabled: bool, valeur: number, taux: number, montant: number }
    # `montant` est recalculé côté serveur (= valeur × taux / 100). On lui
    # fait confiance ici, mais on protège quand même par _to_num.
    assurance = data.get("assurance") or {}
    ass_enabled = bool(assurance.get("enabled"))
    ass_montant = _to_num(assurance.get("montant"))
    ass_valeur = _to_num(assurance.get("valeur"))

    if ass_enabled and ass_montant > 0:
        # Format français : "32515.75" → "32515,75" ; "32515.0" → "32515".
        if ass_valeur == int(ass_valeur):
            valeur_str = str(int(ass_valeur))
        else:
            valeur_str = f"{ass_valeur:.2f}".replace(".", ",")
        updates[CELL_ASSURANCE_LABEL] = f"Assurance Ad Valorem {valeur_str}€"
        updates[CELL_ASSURANCE_VALUE] = round(ass_montant, 2)
    else:
        # Vide les cellules pour éviter qu'une trace de l'éxécution
        # précédente subsiste si le template les avait pré-remplies.
        updates[CELL_ASSURANCE_LABEL] = ""
        updates[CELL_ASSURANCE_VALUE] = ""
        ass_montant = 0.0

    # Total autres frais = fuel + assurance (hayon par défaut = 0)
    updates[CELL_TOTAL_AUTRES]    = round(fuel + ass_montant, 2)
    # Total Transport (hors TVA) = coût HT + fuel + assurance
    updates[CELL_TOTAL_TRANSPORT] = round(cout_total + ass_montant, 2)

    palettes = data.get("palettes") or []
    if len(palettes) > len(COLISAGE_ROWS):
        raise ValueError(
            f"Trop de palettes ({len(palettes)}), max {len(COLISAGE_ROWS)}"
        )
    for i, row in enumerate(COLISAGE_ROWS):
        if i < len(palettes):
            pal = palettes[i]
            updates[f"{COL_COLISAGE}{row}"] = "1 Palette"
            poids = pal.get("poids")
            if poids is not None and poids != "":
                try:
                    updates[f"{COL_POIDS_REEL}{row}"] = float(poids)
                except (TypeError, ValueError):
                    updates[f"{COL_POIDS_REEL}{row}"] = str(poids)
            else:
                updates[f"{COL_POIDS_REEL}{row}"] = ""
            dims = pal.get("dimensions")
            updates[f"{COL_DIMENSIONS}{row}"] = str(dims) if dims else ""
            updates[f"{COL_GERBABLE}{row}"] = format_gerbable(pal.get("gerbable", False))
        else:
            # Lignes inutilisées → on les vide pour effacer un éventuel
            # contenu résiduel d'une exécution précédente sur le même
            # template (si on patchait deux fois de suite). Ici on travaille
            # toujours à partir du template d'origine donc c'est une
            # ceinture-bretelle.
            updates[f"{COL_COLISAGE}{row}"] = ""
            updates[f"{COL_POIDS_REEL}{row}"] = ""
            updates[f"{COL_DIMENSIONS}{row}"] = ""
            updates[f"{COL_GERBABLE}{row}"] = ""

    return updates


def fill_template(template_path, data, output_path):
    template_path = Path(template_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 1. Copie binaire intégrale du template — drawings, images,
    #    externalLinks, styles, theme, etc. restent strictement identiques.
    shutil.copyfile(template_path, output_path)

    # 2. Lecture de sheet1.xml + calcChain.xml + métadonnées qui le référencent
    CONTENT_TYPES_PATH = "[Content_Types].xml"
    WORKBOOK_RELS_PATH = "xl/_rels/workbook.xml.rels"
    META_PATHS = {CONTENT_TYPES_PATH, WORKBOOK_RELS_PATH}
    EDIT_PATHS = {SHEET_PATH, CALC_CHAIN_PATH} | META_PATHS

    with zipfile.ZipFile(output_path, "r") as zin:
        names = set(zin.namelist())
        sheet_bytes = zin.read(SHEET_PATH)
        calc_bytes = zin.read(CALC_CHAIN_PATH) if CALC_CHAIN_PATH in names else None
        ct_bytes = zin.read(CONTENT_TYPES_PATH) if CONTENT_TYPES_PATH in names else None
        rels_bytes = zin.read(WORKBOOK_RELS_PATH) if WORKBOOK_RELS_PATH in names else None
        # Garde l'ordre & la liste des autres fichiers (hors fichiers patchés)
        other_items = [(zi, zin.read(zi.filename))
                       for zi in zin.infolist() if zi.filename not in EDIT_PATHS]
        sheet_info = zin.getinfo(SHEET_PATH)
        ct_info = zin.getinfo(CONTENT_TYPES_PATH) if ct_bytes is not None else None
        rels_info = zin.getinfo(WORKBOOK_RELS_PATH) if rels_bytes is not None else None

    sheet_xml = sheet_bytes.decode("utf-8")
    calc_xml = calc_bytes.decode("utf-8") if calc_bytes is not None else None
    ct_xml = ct_bytes.decode("utf-8") if ct_bytes is not None else None
    rels_xml = rels_bytes.decode("utf-8") if rels_bytes is not None else None

    # 3. Patche les cellules + nettoie calcChain pour les formules supprimées
    updates = collect_updates(data)
    formula_refs_dropped = set()
    new_sheet_xml = patch_sheet(sheet_xml, updates, formula_refs_dropped)

    # Si calcChain devient vide après nettoyage → on le SUPPRIME entièrement,
    # ainsi que ses références dans [Content_Types].xml et workbook.xml.rels.
    # Excel reconstruit calcChain au prochain enregistrement. Garder un
    # calcChain vide (sans <c>) déclenche une alerte d'intégrité côté Excel.
    drop_calc_chain = False
    new_calc_xml = calc_xml
    if calc_xml is not None and formula_refs_dropped:
        cleaned = patch_calc_chain(calc_xml, formula_refs_dropped)
        # Plus aucune <c> dans calcChain → on jette le fichier
        if not re.search(r'<c\b', cleaned):
            drop_calc_chain = True
        else:
            new_calc_xml = cleaned

    new_ct_xml = ct_xml
    new_rels_xml = rels_xml
    if drop_calc_chain:
        # NB : on utilise [^>]* au lieu de [^/]* — les ContentType
        # contiennent des "/" (ex. application/vnd...).
        if ct_xml is not None:
            new_ct_xml = re.sub(
                r'<Override\b[^>]*PartName="/xl/calcChain\.xml"[^>]*/>',
                '',
                ct_xml,
            )
        if rels_xml is not None:
            new_rels_xml = re.sub(
                r'<Relationship\b[^>]*Target="calcChain\.xml"[^>]*/>',
                '',
                rels_xml,
            )

    # 4. Réécriture du zip — on conserve l'ordre + la compression d'origine
    def _write(zout, info, payload):
        new_info = zipfile.ZipInfo(filename=info.filename, date_time=info.date_time)
        new_info.compress_type = info.compress_type
        new_info.external_attr = info.external_attr
        zout.writestr(new_info, payload)

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for info, payload in other_items:
            _write(zout, info, payload)
        # sheet1.xml (toujours)
        _write(zout, sheet_info, new_sheet_xml.encode("utf-8"))
        # calcChain.xml : on l'écrit sauf s'il a été vidé
        if calc_xml is not None and not drop_calc_chain:
            calc_info = zipfile.ZipInfo(filename=CALC_CHAIN_PATH)
            calc_info.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(calc_info, (new_calc_xml or calc_xml).encode("utf-8"))
        # [Content_Types].xml
        if ct_info is not None:
            _write(zout, ct_info, (new_ct_xml or ct_xml).encode("utf-8"))
        # workbook.xml.rels
        if rels_info is not None:
            _write(zout, rels_info, (new_rels_xml or rels_xml).encode("utf-8"))


def main():
    if len(sys.argv) != 4:
        print(
            "Usage: python3 fill_dhl_palette.py <template> <input.json> <output.xlsx>",
            file=sys.stderr,
        )
        sys.exit(2)

    template_path = sys.argv[1]
    input_json    = sys.argv[2]
    output_path   = sys.argv[3]

    with open(input_json, "r", encoding="utf-8") as f:
        data = json.load(f)

    fill_template(template_path, data, output_path)
    print(output_path)


if __name__ == "__main__":
    main()
