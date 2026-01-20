from __future__ import annotations

from fastapi import FastAPI, HTTPException, Header, Body, Depends, Request
from fastapi.responses import PlainTextResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.middleware.cors import CORSMiddleware

import os
import io
import re
import csv
import json
import time
import zipfile
import secrets
from collections import defaultdict, deque
from typing import Dict, Set, Tuple, Optional, List

# ==========================================================
# Paths / Config
# ==========================================================
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(APP_ROOT, '..'))
FRONTEND_DIR = os.path.join(BASE_DIR, 'frontend')
DATA_DIR = os.path.join(BASE_DIR, 'data')
DATASHEETS_DIR = os.path.join(DATA_DIR, 'Fiche_tech')  # data/Fiche_tech/<family>/<REF>.pdf

DEBUG_BACK = os.getenv('DEBUG_BACK', '0') == '1'

ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin')
TOKENS: Dict[str, float] = {}
TOKEN_TTL_SECONDS = 8 * 60 * 60  # 8h

security = HTTPBasic()

# anti brute-force login (local-friendly)
LOGIN_WINDOW_SEC = 60
LOGIN_MAX_ATTEMPTS = 8
LOGIN_ATTEMPTS = defaultdict(lambda: deque())  # ip -> timestamps

# CSVs exposed by the admin panel
ALLOWED = {
    'cameras': 'cameras.csv',
    'nvrs': 'nvrs.csv',
    'hdds': 'hdds.csv',
    'switches': 'switches.csv',
    'accessories': 'accessories.csv',
    'screens': 'screens.csv',
    'enclosures': 'enclosures.csv',
    'signage': 'signage.csv',
}

# Families used for local datasheets classification in the ZIP
FAMILIES = {
    'cameras': 'cameras',
    'nvrs': 'nvrs',
    'hdds': 'hdds',
    'switches': 'switches',
    'accessories': 'accessories',
    'screens': 'screens',
    'enclosures': 'enclosures',
    'signage': 'signage',
}

# ==========================================================
# Auth helpers
# ==========================================================

def require_auth(auth: str | None) -> bool:
    if not auth or not auth.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Missing token')
    token = auth.split(' ', 1)[1].strip()
    exp = TOKENS.get(token)
    if not exp or exp < time.time():
        TOKENS.pop(token, None)
        raise HTTPException(status_code=401, detail='Invalid/expired token')
    return True


def require_basic_admin(credentials: HTTPBasicCredentials = Depends(security)) -> bool:
    ok_user = secrets.compare_digest(credentials.username, 'admin')
    ok_pwd = secrets.compare_digest(credentials.password, ADMIN_PASSWORD)
    if not (ok_user and ok_pwd):
        raise HTTPException(status_code=401, detail='Unauthorized')
    return True


def check_login_rate_limit(ip: str) -> None:
    now = time.time()
    q = LOGIN_ATTEMPTS[ip]
    while q and (now - q[0]) > LOGIN_WINDOW_SEC:
        q.popleft()
    if len(q) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail='Too many attempts, retry later')
    q.append(now)


# ==========================================================
# App + CORS
# ==========================================================
app = FastAPI()

# Allow Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


if DEBUG_BACK:
    print('BASE_DIR      =', BASE_DIR)
    print('FRONTEND_DIR  =', FRONTEND_DIR)
    print('DATA_DIR      =', DATA_DIR)
    print('DATASHEETS_DIR=', DATASHEETS_DIR)


# ==========================================================
# Frontend routes
# ==========================================================
@app.get('/')
def home():
    index_path = os.path.join(FRONTEND_DIR, 'index.html')
    if not os.path.isfile(index_path):
        raise HTTPException(status_code=500, detail=f'index.html introuvable: {index_path}')
    return FileResponse(index_path)


@app.get('/admin')
def admin_page(_=Depends(require_basic_admin)):
    admin_path = os.path.join(FRONTEND_DIR, 'admin.html')
    if not os.path.isfile(admin_path):
        raise HTTPException(status_code=500, detail=f'admin.html introuvable: {admin_path}')
    return FileResponse(admin_path)


# ==========================================================
# API: login + CSV read/write
# ==========================================================
@app.post('/api/login')
def login(request: Request, payload: dict = Body(...)):
    ip = request.client.host if request.client else 'unknown'
    check_login_rate_limit(ip)

    pwd = (payload.get('password') or '').strip()
    if pwd != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail='Bad password')

    token = secrets.token_urlsafe(32)
    TOKENS[token] = time.time() + TOKEN_TTL_SECONDS
    return {'token': token, 'expires_in': TOKEN_TTL_SECONDS}


@app.get('/api/csv/{name}', response_class=PlainTextResponse)
def read_csv(name: str):
    if name not in ALLOWED:
        raise HTTPException(status_code=404, detail='Unknown CSV')

    path = os.path.join(DATA_DIR, ALLOWED[name])
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f'File missing: {path}')

    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


@app.post('/api/csv/{name}', response_class=PlainTextResponse)
def write_csv(
    name: str,
    content: str = Body(..., embed=True),
    authorization: str | None = Header(default=None),
):
    require_auth(authorization)

    if name not in ALLOWED:
        raise HTTPException(status_code=404, detail='Unknown CSV')

    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, ALLOWED[name])

    # backup
    if os.path.isfile(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                old = f.read()
            with open(path + '.bak', 'w', encoding='utf-8') as f:
                f.write(old)
        except Exception:
            pass

    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content.strip() + '\n')

    return 'OK'


# ==========================================================
# Static mounts
# ==========================================================
# CSV, images, fiches techniques locales, etc.
os.makedirs(DATA_DIR, exist_ok=True)

# URL canonique (déjà utilisé par ton admin panel)
app.mount('/data', StaticFiles(directory=DATA_DIR), name='data')

# Alias pratique pour le frontend/PDF (si ton buildPdfHtml pointe sur /media/...)
app.mount('/media', StaticFiles(directory=DATA_DIR), name='media')

# Front static assets (js/css/images)
app.mount('/app', StaticFiles(directory=FRONTEND_DIR, html=True), name='frontend')



# ==========================================================
# Local datasheets indexing (for ZIP export)
# ==========================================================

def _safe_zip_name(name: str) -> str:
    name = (name or 'file').strip()
    name = re.sub(r'[\\/\?%\*:|"<>]', '_', name)
    name = re.sub(r'\s+', ' ', name)
    return name[:180]


def _read_csv_ids(csv_path: str) -> Set[str]:
    ids: Set[str] = set()
    if not os.path.isfile(csv_path):
        return ids
    with open(csv_path, 'r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = (row.get('id') or '').strip()
            if pid:
                ids.add(pid.upper())
    return ids


# Cache: (signature, id_to_family)
_CATALOG_CACHE_SIG: Optional[Tuple[float, float, float, float, float, float, float, float]] = None
_CATALOG_ID_TO_FAMILY: Dict[str, str] = {}


def _catalog_signature() -> Tuple[float, ...]:
    """Signature based on mtimes of the catalog CSVs."""
    mtimes: List[float] = []
    for key in FAMILIES.keys():
        p = os.path.join(DATA_DIR, ALLOWED.get(key, ''))
        try:
            mtimes.append(os.path.getmtime(p))
        except Exception:
            mtimes.append(0.0)
    return tuple(mtimes)


def _build_catalog_id_to_family() -> Dict[str, str]:
    m: Dict[str, str] = {}
    for fam_key, fam_name in FAMILIES.items():
        csv_file = ALLOWED.get(fam_key)
        if not csv_file:
            continue
        ids = _read_csv_ids(os.path.join(DATA_DIR, csv_file))
        for pid in ids:
            # first win keeps family; collisions are rare (and ok)
            m.setdefault(pid, fam_name)
    return m


def get_catalog_id_to_family() -> Dict[str, str]:
    global _CATALOG_CACHE_SIG, _CATALOG_ID_TO_FAMILY
    sig = _catalog_signature()
    if _CATALOG_CACHE_SIG != sig or not _CATALOG_ID_TO_FAMILY:
        _CATALOG_ID_TO_FAMILY = _build_catalog_id_to_family()
        _CATALOG_CACHE_SIG = sig
        if DEBUG_BACK:
            print(f'[catalog] rebuilt id->family map ({len(_CATALOG_ID_TO_FAMILY)} ids)')
    return _CATALOG_ID_TO_FAMILY


def _find_local_datasheet_path(family: str, product_id: str) -> Optional[str]:
    """Find local PDF for product_id within data/Fiche_tech/<family>/.

    Accepts .pdf or .PDF, product_id case-insensitive.
    """
    if not product_id:
        return None
    pid = product_id.strip()
    if not pid:
        return None

    fam_dir = os.path.join(DATASHEETS_DIR, family)
    if not os.path.isdir(fam_dir):
        return None

    # Try exact and case variants
    candidates = [
        os.path.join(fam_dir, f'{pid}.pdf'),
        os.path.join(fam_dir, f'{pid}.PDF'),
        os.path.join(fam_dir, f'{pid.upper()}.pdf'),
        os.path.join(fam_dir, f'{pid.upper()}.PDF'),
        os.path.join(fam_dir, f'{pid.lower()}.pdf'),
        os.path.join(fam_dir, f'{pid.lower()}.PDF'),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p

    # Fallback scan in family dir (handles weird casing)
    target = f'{pid}.pdf'.lower()
    try:
        for fn in os.listdir(fam_dir):
            if fn.lower() == target:
                p = os.path.join(fam_dir, fn)
                if os.path.isfile(p):
                    return p
    except Exception:
        return None

    return None


def _group_missing(missing: List[Tuple[str, str]]) -> str:
    """missing: list of (family, id)"""
    grouped: Dict[str, List[str]] = defaultdict(list)
    for fam, pid in missing:
        grouped[fam].append(pid)

    lines: List[str] = []
    for fam in sorted(grouped.keys()):
        lines.append(f'[{fam}]')
        for pid in sorted(set(grouped[fam])):
            lines.append(f'- {pid}')
        lines.append('')

    return '\n'.join(lines).strip() + '\n'


# ==========================================================
# Export: PDF + local datasheets ZIP (Option B)
# ==========================================================
@app.post('/export/localzip')
def export_local_zip(payload: dict):
    """Create a ZIP containing the generated PDF + local datasheets.

    payload attendu:
    {
      "pdf_base64": "...",
      "product_ids": ["IT04N2ZA", "NIPNVR032A12NASL", ...],
      "zip_name": "export_configurateur_2026-01-19.zip"
    }

    Datasheets must exist locally as:
      data/Fiche_tech/<family>/<REF>.pdf
    """
    import base64

    pdf_b64 = payload.get('pdf_base64')
    product_ids = payload.get('product_ids') or []
    zip_name = payload.get('zip_name') or 'export_configurateur.zip'

    if not pdf_b64:
        raise HTTPException(status_code=400, detail='pdf_base64 manquant')

    try:
        pdf_bytes = base64.b64decode(pdf_b64)
    except Exception:
        raise HTTPException(status_code=400, detail='pdf_base64 invalide')

    # Normalize product ids
    ids: List[str] = []
    seen = set()
    for x in product_ids:
        pid = str(x or '').strip()
        if not pid:
            continue
        up = pid.upper()
        if up in seen:
            continue
        seen.add(up)
        ids.append(up)

    id_to_family = get_catalog_id_to_family()

    mem = io.BytesIO()
    missing: List[Tuple[str, str]] = []
    included: List[Dict[str, str]] = []

    generated_at = time.strftime('%Y-%m-%d %H:%M:%S')

    with zipfile.ZipFile(mem, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        # PDF
        z.writestr('rapport/rapport_configurateur.pdf', pdf_bytes)

        # Datasheets
        for pid in ids:
            fam = id_to_family.get(pid, 'autres')

            # If unknown family, try all known folders before falling back to autres
            fam_try = [fam] if fam != 'autres' else []
            fam_try.extend([v for v in FAMILIES.values() if v not in fam_try])
            fam_try.append('autres')

            found_path = None
            found_fam = None
            for ftry in fam_try:
                p = _find_local_datasheet_path(ftry, pid)
                if p:
                    found_path = p
                    found_fam = ftry
                    break

            if not found_path or not found_fam:
                missing.append((fam, pid))
                continue

            arcname = f'fiches_techniques/{found_fam}/{pid}.pdf'
            try:
                z.write(found_path, arcname=arcname)
                included.append({'id': pid, 'family': found_fam, 'zip_path': arcname})
            except Exception:
                missing.append((found_fam, pid))

        # Missing report
        if missing:
            z.writestr('fiches_techniques/_MANQUANTES.txt', _group_missing(missing))

        # Manifest (quality optimization)
        manifest = {
            'generated_at': generated_at,
            'datasheets_dir': os.path.relpath(DATASHEETS_DIR, BASE_DIR).replace('\\', '/'),
            'total_ids_requested': len(ids),
            'total_datasheets_included': len(included),
            'total_missing': len({(f, i) for (f, i) in missing}),
            'included': included,
            'missing': [{'family': f, 'id': i} for (f, i) in missing],
        }
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))

    mem.seek(0)
    headers = {'Content-Disposition': f'attachment; filename="{_safe_zip_name(zip_name)}"'}
    return StreamingResponse(mem, media_type='application/zip', headers=headers)
