import csv
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, unquote

import requests


# ---------------------------
# CONFIG (à adapter si besoin)
# ---------------------------
BASE_DIR = Path(__file__).resolve().parents[1]  # si script dans /scripts
DATA_DIR = BASE_DIR / "data"

CSV_FILES = [
    ("cameras",     DATA_DIR / "cameras.csv"),
    ("nvrs",        DATA_DIR / "nvrs.csv"),
    ("hdds",        DATA_DIR / "hdds.csv"),
    ("switches",    DATA_DIR / "switches.csv"),
    ("accessories", DATA_DIR / "accessories.csv"),
    ("screens",     DATA_DIR / "screens.csv"),
    ("enclosures",  DATA_DIR / "enclosures.csv"),
    ("signage",     DATA_DIR / "signage.csv"),
]

OUT_IMAGES = DATA_DIR / "Images"
OUT_FT = DATA_DIR / "Fiche_tech"

TIMEOUT = 25
SLEEP_BETWEEN = 0.05  # évite de spammer le serveur
HEADERS = {
    "User-Agent": "ConfigurateurComelit/1.0 (local downloader)"
}

# ---------------------------
# HELPERS
# ---------------------------
def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def safe_id(s: str) -> str:
    s = str(s or "").strip()
    # on garde uniquement caractères safe pour fichier
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s)
    return s or "UNKNOWN"

def guess_ext_from_url(url: str, default: str = "") -> str:
    try:
        path = urlparse(url).path
        path = unquote(path)
        ext = os.path.splitext(path)[1].lower()
        if ext and len(ext) <= 6:
            return ext
    except Exception:
        pass
    return default

def download_if_missing(url: str, dst: Path) -> str:
    """
    Télécharge url -> dst si dst n'existe pas.
    Retourne un statut texte.
    """
    if not url:
        return "SKIP (URL vide)"
    if dst.exists() and dst.stat().st_size > 0:
        return "SKIP (déjà présent)"

    try:
        with requests.get(url, stream=True, timeout=TIMEOUT, headers=HEADERS) as r:
            r.raise_for_status()
            ensure_dir(dst.parent)
            tmp = dst.with_suffix(dst.suffix + ".part")
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 64):
                    if chunk:
                        f.write(chunk)
            tmp.replace(dst)
        time.sleep(SLEEP_BETWEEN)
        return "OK"
    except Exception as e:
        return f"ERR ({type(e).__name__}: {e})"

def read_csv_rows(csv_path: Path):
    # gestion BOM + séparateur virgule
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield row

def get_row_id(row: dict) -> str:
    # tes CSV ont toujours "id"
    return safe_id(row.get("id", ""))

def get_url(row: dict, key: str) -> str:
    v = row.get(key, "") or ""
    v = str(v).strip()
    return v
def collect_accessory_ids_from_mapping(csv_path: Path) -> set[str]:
    """
    accessories.csv (mapping) contient des colonnes du style:
    junction_box_id, wall_mount_id, ceiling_mount_id, ...
    On collecte tous les champs qui finissent par _id.
    """
    ids = set()
    if not csv_path.exists():
        return ids

    for row in read_csv_rows(csv_path):
        for k, v in row.items():
            if not k:
                continue
            kk = str(k).strip().lower()
            if not kk.endswith("_id"):
                continue
            val = safe_id(v)
            if val and val != "UNKNOWN" and val.upper() != "—":
                ids.add(val.upper())
    return ids

# ---------------------------
# MAIN
# ---------------------------
def main():
    print(f"BASE_DIR : {BASE_DIR}")
    print(f"DATA_DIR : {DATA_DIR}")
    print("")

    total_ok = total_skip = total_err = 0

    for family, csv_path in CSV_FILES:
        if not csv_path.exists():
            print(f"[{family}] CSV introuvable -> {csv_path}")
            continue

        print(f"=== {family} ===")
        img_dir = OUT_IMAGES / family
        ft_dir = OUT_FT / family
        ensure_dir(img_dir)
        ensure_dir(ft_dir)

         # --- CAS SPECIAL: accessories.csv est un MAPPING (pas une liste produits)
        # Il ne contient pas forcément image_url/datasheet_url, donc on ne peut pas télécharger "directement".
        # On génère au minimum la liste des IDs d'accessoires rencontrés.
        if family == "accessories":
            acc_ids = collect_accessory_ids_from_mapping(csv_path)
            if acc_ids:
                ensure_dir(ft_dir)
                ensure_dir(img_dir)
                out_list = DATA_DIR / "_accessories_ids_from_mapping.txt"
                out_list.write_text("\n".join(sorted(acc_ids)) + "\n", encoding="utf-8")
                print(f"[accessories] Mapping détecté: {len(acc_ids)} IDs trouvés -> {out_list}")
            else:
                print("[accessories] Mapping détecté mais aucun *_id trouvé.")


        for row in read_csv_rows(csv_path):
            pid = get_row_id(row)
            if pid == "UNKNOWN":
                continue

            image_url = get_url(row, "image_url")
            datasheet_url = get_url(row, "datasheet_url")

            # IMAGE
            if image_url:
                ext = guess_ext_from_url(image_url, default=".png")  # défaut .png si pas d'ext
                img_dst = img_dir / f"{pid}{ext}"
                st = download_if_missing(image_url, img_dst)
                if st == "OK": total_ok += 1
                elif st.startswith("SKIP"): total_skip += 1
                else: total_err += 1
                if st != "SKIP (URL vide)":
                    print(f"IMG  {pid:<18} -> {st}")

            # FICHE TECH (force .pdf)
            if datasheet_url:
                ft_dst = ft_dir / f"{pid}.pdf"
                st = download_if_missing(datasheet_url, ft_dst)
                if st == "OK": total_ok += 1
                elif st.startswith("SKIP"): total_skip += 1
                else: total_err += 1
                if st != "SKIP (URL vide)":
                    print(f"FT   {pid:<18} -> {st}")

        print("")
    print("=== Résumé ===")
    print(f"OK   : {total_ok}")
    print(f"SKIP : {total_skip}")
    print(f"ERR  : {total_err}")

    # code retour pratique
    if total_err > 0:
        sys.exit(2)

if __name__ == "__main__":
    main()
