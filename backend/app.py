from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware  # ✅ AJOUT CORS
from pydantic import BaseModel, Field
import os, secrets, time, json, csv, io, sqlite3, base64, zipfile
from datetime import datetime, timezone

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(APP_ROOT, ".."))

FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DATA_DIR = os.path.join(BASE_DIR, "data")

ADMIN_PASSWORD = os.getenv("CONFIG_ADMIN_PASSWORD", "admin")  # change in prod
TOKENS: dict[str, float] = {}

ALLOWED = {
    "cameras": "cameras.csv",
    "nvrs": "nvrs.csv",
    "hdds": "hdds.csv",
    "switches": "switches.csv",
    "accessories": "accessories.csv",
    "screens": "screens.csv",
    "enclosures": "enclosures.csv",
    "signage": "signage.csv",
}

KPI_DB = os.path.join(APP_ROOT, "kpi.sqlite3")

def _db():
    con = sqlite3.connect(KPI_DB)
    con.execute("""
      CREATE TABLE IF NOT EXISTS kpi_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_utc TEXT NOT NULL,
        session_id TEXT,
        event TEXT NOT NULL,
        payload_json TEXT,
        path TEXT,
        ua TEXT,
        ip TEXT
      );
    """)
    con.execute("CREATE INDEX IF NOT EXISTS idx_kpi_ts ON kpi_events(ts_utc);")
    con.execute("CREATE INDEX IF NOT EXISTS idx_kpi_event ON kpi_events(event);")
    con.commit()
    return con

_db().close()

app = FastAPI()

# ============================================================
# ✅ CORS MIDDLEWARE - PERMET LES REQUÊTES CROSS-ORIGIN
# ============================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",      # Vite dev server
        "http://127.0.0.1:5173",
        "http://localhost:3000",      # Autre port possible
        "http://127.0.0.1:3000",
        "http://localhost:8000",      # Self
        "http://127.0.0.1:8000",
        "*",                          # Autorise tout (dev only, à restreindre en prod)
    ],
    allow_credentials=True,
    allow_methods=["*"],              # GET, POST, PUT, DELETE, OPTIONS, etc.
    allow_headers=["*"],              # Tous les headers
)

# Front
if os.path.isdir(FRONTEND_DIR):
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="app")

# ✅ Data (CSV + Images + fiches tech)
if os.path.isdir(DATA_DIR):
    app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")
else:
    print("[WARN] DATA_DIR not found:", DATA_DIR)


def require_auth(auth: str | None):
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth.split(" ", 1)[1].strip()
    exp = TOKENS.get(token)
    if not exp or exp < time.time():
        raise HTTPException(status_code=401, detail="Invalid or expired token")

def _csv_path(kind: str) -> str:
    fn = ALLOWED.get(kind)
    if not fn:
        raise HTTPException(status_code=404, detail="Unknown catalog")
    p = os.path.abspath(os.path.join(DATA_DIR, fn))
    if not p.startswith(os.path.abspath(DATA_DIR)):
        raise HTTPException(status_code=400, detail="Bad path")
    return p

def _read_csv_as_rows(path: str):
    if not os.path.exists(path):
        return [], []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames or []
        rows = list(reader)
    return cols, rows

def _write_rows_as_csv(path: str, columns: list[str], rows: list[dict]):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: ("" if r.get(c) is None else str(r.get(c))) for c in columns})

@app.get("/health")
def health():
    return {"ok": True}

class LoginIn(BaseModel):
    password: str = Field(..., min_length=1)

@app.post("/api/login")
def login(data: LoginIn):
    if data.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Bad password")
    token = secrets.token_urlsafe(24)
    TOKENS[token] = time.time() + 24 * 3600
    return {"token": token, "expires_in": 24 * 3600}

@app.get("/admin", include_in_schema=False)
def admin_page():
    cand1 = os.path.join(FRONTEND_DIR, "public", "admin.html")
    cand2 = os.path.join(FRONTEND_DIR, "admin.html")
    cand3 = os.path.join(APP_ROOT, "admin.html")
    for p in (cand1, cand2, cand3):
        if os.path.exists(p):
            return FileResponse(p)
    raise HTTPException(status_code=404, detail="admin.html not found")

class CatalogOut(BaseModel):
    kind: str
    filename: str
    columns: list[str]
    rows: list[dict]

class CatalogIn(BaseModel):
    columns: list[str]
    rows: list[dict]

@app.get("/api/admin/catalog/{kind}", response_model=CatalogOut)
def get_catalog(kind: str, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    path = _csv_path(kind)
    cols, rows = _read_csv_as_rows(path)
    return {"kind": kind, "filename": os.path.basename(path), "columns": cols, "rows": rows}

@app.put("/api/admin/catalog/{kind}")
def put_catalog(kind: str, data: CatalogIn, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    path = _csv_path(kind)
    cols = [c.strip() for c in (data.columns or []) if str(c).strip()]
    if not cols:
        raise HTTPException(status_code=400, detail="Empty columns")
    rows = []
    for r in (data.rows or []):
        if not isinstance(r, dict):
            raise HTTPException(status_code=400, detail="Bad row format")
        rows.append(r)
    _write_rows_as_csv(path, cols, rows)
    return {"ok": True, "rows": len(rows)}

class KpiIn(BaseModel):
    session_id: str | None = None
    event: str = Field(..., min_length=1, max_length=80)
    payload: dict = Field(default_factory=dict)

@app.post("/api/kpi/collect")
async def kpi_collect(data: KpiIn, request: Request):
    ts = datetime.now(timezone.utc).isoformat()
    ua = request.headers.get("user-agent", "")
    ip = request.client.host if request.client else ""
    path = request.headers.get("x-page-path") or request.headers.get("referer") or ""

    payload_json = json.dumps(data.payload or {}, ensure_ascii=False)

    con = _db()
    con.execute(
        "INSERT INTO kpi_events(ts_utc, session_id, event, payload_json, path, ua, ip) VALUES(?,?,?,?,?,?,?)",
        (ts, data.session_id, data.event, payload_json, path, ua, ip),
    )
    con.commit()
    con.close()
    return {"ok": True}

# ✅ Alias rétro-compat
@app.post("/api/kpi/event")
async def kpi_event_alias(data: KpiIn, request: Request):
    return await kpi_collect(data, request)

@app.get("/api/kpi/summary")
def kpi_summary(authorization: str | None = Header(default=None)):
    require_auth(authorization)
    con = _db()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) FROM kpi_events;")
    total = int(cur.fetchone()[0] or 0)
    cur.execute("SELECT event, COUNT(*) c FROM kpi_events GROUP BY event ORDER BY c DESC LIMIT 20;")
    top = [{"event": e, "count": int(c)} for (e, c) in cur.fetchall()]
    cur.execute("""
      SELECT substr(ts_utc,1,10) d, COUNT(*) c
      FROM kpi_events
      GROUP BY d
      ORDER BY d DESC
      LIMIT 30;
    """)
    by_day = [{"date": d, "count": int(c)} for (d, c) in cur.fetchall()][::-1]
    con.close()
    return {"total": total, "top": top, "by_day": by_day}

@app.get("/api/kpi/events")
def kpi_events(limit: int = 200, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    limit = max(1, min(int(limit or 200), 2000))
    con = _db()
    cur = con.cursor()
    cur.execute("""
      SELECT ts_utc, session_id, event, payload_json, path, ip
      FROM kpi_events
      ORDER BY id DESC
      LIMIT ?;
    """, (limit,))
    rows = []
    for ts, sid, ev, pj, path, ip in cur.fetchall():
        try:
            payload = json.loads(pj) if pj else {}
        except Exception:
            payload = {"_raw": pj}
        rows.append({"ts_utc": ts, "session_id": sid, "event": ev, "payload": payload, "path": path, "ip": ip})
    con.close()
    return {"rows": rows}

@app.get("/api/kpi/export.csv")
def kpi_export_csv(authorization: str | None = Header(default=None)):
    require_auth(authorization)
    con = _db()
    cur = con.cursor()
    cur.execute("""
      SELECT ts_utc, session_id, event, payload_json, path, ua, ip
      FROM kpi_events
      ORDER BY id DESC;
    """)
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow(["ts_utc","session_id","event","payload_json","path","ua","ip"])
    for r in cur.fetchall():
        w.writerow(list(r))
    con.close()
    data = out.getvalue().encode("utf-8")
    headers = {"Content-Disposition": 'attachment; filename="kpi_export.csv"'}
    return Response(content=data, media_type="text/csv; charset=utf-8", headers=headers)


# ============================================================
# ✅ EXPORT ZIP (PDF + FICHES TECHNIQUES LOCALES)
# ============================================================

class ExportZipIn(BaseModel):
    pdf_base64: str = Field(..., description="PDF principal encodé en base64")
    product_ids: list[str] = Field(default_factory=list, description="Liste des IDs produits")
    zip_name: str = Field(default="export.zip", description="Nom du fichier ZIP")

def find_datasheet_for_product(product_id: str) -> str | None:
    """
    Cherche la fiche technique d'un produit dans DATA_DIR.
    Retourne le chemin absolu si trouvé, None sinon.
    """
    if not product_id:
        return None
    
    # Nettoyer l'ID
    clean_id = str(product_id).strip()
    
    # Dossiers où chercher les fiches techniques
    search_dirs = [
        os.path.join(DATA_DIR, "fiches_techniques"),
        os.path.join(DATA_DIR, "datasheets"),
        os.path.join(DATA_DIR, "pdf"),
        os.path.join(DATA_DIR, "docs"),
        DATA_DIR,
    ]
    
    # Extensions possibles
    extensions = [".pdf", ".PDF"]
    
    # Patterns de noms de fichiers
    patterns = [
        clean_id,                           # Exact match
        clean_id.upper(),
        clean_id.lower(),
        clean_id.replace("-", "_"),
        clean_id.replace("_", "-"),
        f"FT_{clean_id}",                   # Fiche Technique prefix
        f"DS_{clean_id}",                   # Datasheet prefix
        f"datasheet_{clean_id}",
    ]
    
    for search_dir in search_dirs:
        if not os.path.isdir(search_dir):
            continue
            
        for pattern in patterns:
            for ext in extensions:
                candidate = os.path.join(search_dir, pattern + ext)
                if os.path.isfile(candidate):
                    return candidate
                    
        # Recherche récursive dans les sous-dossiers
        for root, dirs, files in os.walk(search_dir):
            for f in files:
                if not f.lower().endswith(".pdf"):
                    continue
                name_no_ext = os.path.splitext(f)[0]
                if clean_id.lower() in name_no_ext.lower():
                    return os.path.join(root, f)
    
    return None


@app.post("/export/localzip")
async def export_localzip(data: ExportZipIn):
    """
    Génère un ZIP contenant :
    - Le PDF principal (rapport de configuration)
    - Les fiches techniques des produits (si trouvées localement)
    """
    
    # 1) Décoder le PDF principal
    try:
        pdf_bytes = base64.b64decode(data.pdf_base64)
        if len(pdf_bytes) < 1000:
            raise ValueError("PDF trop petit")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF base64 invalide: {e}")
    
    # 2) Créer le ZIP en mémoire
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # Ajouter le PDF principal
        zf.writestr("rapport_configuration.pdf", pdf_bytes)
        
        # 3) Chercher et ajouter les fiches techniques
        added_files = set()
        missing_products = []
        
        for product_id in data.product_ids:
            if not product_id:
                continue
                
            datasheet_path = find_datasheet_for_product(product_id)
            
            if datasheet_path and os.path.isfile(datasheet_path):
                # Éviter les doublons
                if datasheet_path in added_files:
                    continue
                added_files.add(datasheet_path)
                
                # Nom dans le ZIP
                filename = os.path.basename(datasheet_path)
                zip_path = f"fiches_techniques/{filename}"
                
                try:
                    with open(datasheet_path, "rb") as f:
                        zf.writestr(zip_path, f.read())
                except Exception as e:
                    print(f"[WARN] Impossible de lire {datasheet_path}: {e}")
            else:
                missing_products.append(product_id)
        
        # 4) Ajouter un fichier de log
        log_content = f"""Export généré le {datetime.now().isoformat()}

Produits demandés: {len(data.product_ids)}
Fiches techniques trouvées: {len(added_files)}
Fiches techniques manquantes: {len(missing_products)}

Produits sans fiche technique:
{chr(10).join(f"- {p}" for p in missing_products) if missing_products else "(aucun)"}
"""
        zf.writestr("_info_export.txt", log_content.encode("utf-8"))
    
    # 5) Retourner le ZIP
    zip_buffer.seek(0)
    zip_bytes = zip_buffer.getvalue()
    
    headers = {
        "Content-Disposition": f'attachment; filename="{data.zip_name}"',
        "Content-Type": "application/zip",
    }
    
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers=headers
    )


# ============================================================
# ✅ ROUTE DE TEST POUR VÉRIFIER QUE LE BACKEND FONCTIONNE
# ============================================================
@app.get("/export/test")
def export_test():
    """Route de test pour vérifier que l'export fonctionne"""
    return {
        "ok": True,
        "message": "Export endpoint is working",
        "data_dir": DATA_DIR,
        "data_dir_exists": os.path.isdir(DATA_DIR),
    }


# ============================================================
# ✅ RESET KPI DU MOIS (POUR TESTS)
# ============================================================
class ResetMonthIn(BaseModel):
    month: str = Field(..., description="Mois au format YYYY-MM", min_length=7, max_length=7)

@app.delete("/api/kpi/reset-month")
def kpi_reset_month(data: ResetMonthIn, authorization: str | None = Header(default=None)):
    """
    Supprime tous les événements KPI d'un mois donné.
    ⚠️ Action irréversible - Usage: tests uniquement.
    """
    require_auth(authorization)
    
    # Valider le format du mois (YYYY-MM)
    try:
        parts = data.month.split("-")
        if len(parts) != 2:
            raise ValueError("Format invalide")
        year = int(parts[0])
        month = int(parts[1])
        if year < 2020 or year > 2100:
            raise ValueError("Année hors limites")
        if month < 1 or month > 12:
            raise ValueError("Mois invalide")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Format de mois invalide (attendu: YYYY-MM): {e}")
    
    # Calculer les bornes du mois
    start_date = f"{year}-{month:02d}-01"
    if month == 12:
        end_date = f"{year + 1}-01-01"
    else:
        end_date = f"{year}-{month + 1:02d}-01"
    
    # Supprimer les événements
    con = _db()
    cur = con.cursor()
    
    # Compter avant suppression
    cur.execute(
        "SELECT COUNT(*) FROM kpi_events WHERE ts_utc >= ? AND ts_utc < ?",
        (start_date, end_date)
    )
    count_before = int(cur.fetchone()[0] or 0)
    
    # Supprimer
    cur.execute(
        "DELETE FROM kpi_events WHERE ts_utc >= ? AND ts_utc < ?",
        (start_date, end_date)
    )
    
    con.commit()
    con.close()
    
    return {
        "success": True,
        "month": data.month,
        "deleted": count_before,
        "message": f"{count_before} événement(s) supprimé(s) pour {data.month}"
    }

