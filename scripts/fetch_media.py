from __future__ import annotations

import csv
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests


# =========================
# CONFIG
# =========================
BASE_DIR = Path(r"C:\AI\Configurateur")
DATA_DIR = BASE_DIR / "data"

OUT_IMAGES = DATA_DIR / "Images"
OUT_FT = DATA_DIR / "Fiche_tech"

TIMEOUT_S = 25
ALLOWED_HOSTS = {"staticpro.comelitgroup.com"}  # garde-fou


# Familles CSV “classiques” (id + image_url + datasheet_url)
CSV_STANDARD = [
    ("cameras", DATA_DIR / "cameras.csv"),
    ("nvrs", DATA_DIR / "nvrs.csv"),
    ("hdds", DATA_DIR / "hdds.csv"),
    ("switches", DATA_DIR / "switches.csv"),
    ("screens", DATA_DIR / "screens.csv"),
    ("enclosures", DATA_DIR / "enclosures.csv"),
    ("signage", DATA_DIR / "signage.csv"),
]

# CSV “mapping”
CSV_ACCESSORIES = ("accessories", DATA_DIR / "accessories.csv")


# =========================
# HELPERS
# =========================
def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def is_false_like(v: str | None) -> bool:
    if v is None:
        return True
    s = str(v).strip().lower()
    return s in ("", "false", "0", "none", "null", "—")


def safe_id(v: str | None) -> str:
    if is_false_like(v):
        return ""
    return str(v).strip()


def safe_url(v: str | None) -> str:
    if is_false_like(v):
        return ""
    return str(v).strip()


def is_allowed_url(url: str) -> bool:
    try:
        p = urlparse(url)
        return p.scheme in ("http", "https") and (p.netloc in ALLOWED_HOSTS)
    except Exception:
        return False


def guess_ext_from_url(url: str, default: str) -> str:
    try:
        path = urlparse(url).path
        _, ext = os.path.splitext(path)
        ext = (ext or "").lower().strip()
        if ext in (".png", ".jpg", ".jpeg", ".webp", ".pdf"):
            return ext
    except Exception:
        pass
    return default


def download_if_missing(url: str, dst: Path) -> str:
    if not url:
        return "SKIP (URL vide)"
    if not is_allowed_url(url):
        return f"SKIP (host interdit: {urlparse(url).netloc})"
    if dst.exists() and dst.stat().st_size > 0:
        return "SKIP (déjà présent)"

    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        with requests.get(url, stream=True, timeout=TIMEOUT_S) as r:
            r.raise_for_status()
            with open(dst, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 128):
                    if chunk:
                        f.write(chunk)
        return "OK"
    except Exception as e:
        return f"ERR ({type(e).__name__}: {e})"


def read_csv_rows(csv_path: Path) -> list[dict]:
    rows: list[dict] = []
    if not csv_path.exists():
        return rows
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({k: (v or "").strip() for k, v in row.items()})
    return rows


# =========================
# ACCESSORIES (mapping)
# =========================
def process_accessories_mapping(csv_path: Path) -> tuple[int, int, int]:
    """
    Télécharge les medias depuis accessories.csv (mapping caméra -> accessoires).
    On récupère:
      junction_box_id + image_url_junction_box + datasheet_url_junction_box
      wall_mount_id   + image_url_wall_mount   + datasheet_url_wall_mount
      ceiling_mount_id+ image_url_ceiling_mount+ datasheet_url_ceiling_mount

    Stockage:
      data/Images/accessories/<ID>.png
      data/Fiche_tech/accessories/<ID>.pdf
    """
    ok = skip = err = 0

    img_dir = OUT_IMAGES / "accessories"
    ft_dir = OUT_FT / "accessories"
    ensure_dir(img_dir)
    ensure_dir(ft_dir)

    rows = read_csv_rows(csv_path)
    if not rows:
        print("[accessories] CSV vide ou introuvable.")
        return ok, skip, err

    # Dédup par ID (une fois suffit)
    seen: set[str] = set()

    def handle_one(acc_id: str, img_url: str, pdf_url: str) -> None:
        nonlocal ok, skip, err

        acc_id = safe_id(acc_id).upper()
        if not acc_id or acc_id in seen:
            return
        seen.add(acc_id)

        # image (PNG attendu, mais on garde un fallback)
        if img_url:
            ext = guess_ext_from_url(img_url, default=".png")
            img_dst = img_dir / f"{acc_id}{ext}"
            st = download_if_missing(img_url, img_dst)
            if st == "OK":
                ok += 1
            elif st.startswith("SKIP"):
                skip += 1
            else:
                err += 1
            print(f"[accessories] IMG {acc_id:<14} -> {st}")

        # datasheet (force .pdf)
        if pdf_url:
            ft_dst = ft_dir / f"{acc_id}.pdf"
            st = download_if_missing(pdf_url, ft_dst)
            if st == "OK":
                ok += 1
            elif st.startswith("SKIP"):
                skip += 1
            else:
                err += 1
            print(f"[accessories] FT  {acc_id:<14} -> {st}")

    for row in rows:
        # Junction box
        handle_one(
            row.get("junction_box_id", ""),
            safe_url(row.get("image_url_junction_box")),
            safe_url(row.get("datasheet_url_junction_box")),
        )
        # Wall mount
        handle_one(
            row.get("wall_mount_id", ""),
            safe_url(row.get("image_url_wall_mount")),
            safe_url(row.get("datasheet_url_wall_mount")),
        )
        # Ceiling mount
        handle_one(
            row.get("ceiling_mount_id", ""),
            safe_url(row.get("image_url_ceiling_mount")),
            safe_url(row.get("datasheet_url_ceiling_mount")),
        )

    # petit fichier “trace” utile
    out_list = DATA_DIR / "_accessories_downloaded_ids.txt"
    out_list.write_text("\n".join(sorted(seen)) + "\n", encoding="utf-8")
    print(f"[accessories] IDs accessoires traités: {len(seen)} -> {out_list}")

    return ok, skip, err


# =========================
# STANDARD CSV (id list)
# =========================
def get_row_id(row: dict) -> str:
    pid = (row.get("id") or "").strip()
    pid = pid.upper()
    return pid if pid else ""


def process_standard_csv(family: str, csv_path: Path) -> tuple[int, int, int]:
    ok = skip = err = 0

    img_dir = OUT_IMAGES / family
    ft_dir = OUT_FT / family
    ensure_dir(img_dir)
    ensure_dir(ft_dir)

    rows = read_csv_rows(csv_path)
    if not rows:
        print(f"[{family}] CSV vide ou introuvable: {csv_path}")
        return ok, skip, err

    for row in rows:
        pid = get_row_id(row)
        if not pid:
            continue

        image_url = safe_url(row.get("image_url"))
        datasheet_url = safe_url(row.get("datasheet_url"))

        if image_url:
            ext = guess_ext_from_url(image_url, default=".png")
            img_dst = img_dir / f"{pid}{ext}"
            st = download_if_missing(image_url, img_dst)
            if st == "OK":
                ok += 1
            elif st.startswith("SKIP"):
                skip += 1
            else:
                err += 1
            print(f"[{family}] IMG {pid:<14} -> {st}")

        if datasheet_url:
            ft_dst = ft_dir / f"{pid}.pdf"
            st = download_if_missing(datasheet_url, ft_dst)
            if st == "OK":
                ok += 1
            elif st.startswith("SKIP"):
                skip += 1
            else:
                err += 1
            print(f"[{family}] FT  {pid:<14} -> {st}")

    return ok, skip, err


def main() -> None:
    print(f"BASE_DIR : {BASE_DIR}")
    print(f"DATA_DIR : {DATA_DIR}")
    print("")

    total_ok = total_skip = total_err = 0

    # Standard
    for family, csv_path in CSV_STANDARD:
        if not csv_path.exists():
            continue
        print(f"=== {family} ===")
        ok, skip, err = process_standard_csv(family, csv_path)
        total_ok += ok
        total_skip += skip
        total_err += err
        print("")

    # Accessories mapping
    fam, acc_csv = CSV_ACCESSORIES
    if acc_csv.exists():
        print("=== accessories (mapping) ===")
        ok, skip, err = process_accessories_mapping(acc_csv)
        total_ok += ok
        total_skip += skip
        total_err += err
        print("")

    print("=== Résumé ===")
    print(f"OK   : {total_ok}")
    print(f"SKIP : {total_skip}")
    print(f"ERR  : {total_err}")

    if total_err > 0:
        sys.exit(2)


if __name__ == "__main__":
    main()
