"""
============================================================
FastAPI Backend - Configurateur Comelit (Production Ready)
============================================================
"""

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import os, secrets, time, json, csv, io, sqlite3, base64, zipfile
from datetime import datetime, timezone

# ============================================================
# CONFIGURATION
# ============================================================

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(APP_ROOT, ".."))

# En production, le frontend buildé est dans /app/frontend
FRONTEND_DIR = os.environ.get("FRONTEND_DIR", os.path.join(BASE_DIR, "frontend"))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "data"))

# Mot de passe admin (à définir en variable d'environnement)
ADMIN_PASSWORD = os.getenv("CONFIG_ADMIN_PASSWORD", "admin")
if ADMIN_PASSWORD == "admin":
    print("[WARN] ⚠️  Utilisation du mot de passe par défaut. Définissez CONFIG_ADMIN_PASSWORD en production!")

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

# ============================================================
# DATABASE
# ============================================================

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

# ============================================================
# APP FASTAPI
# ============================================================

app = FastAPI(
    title="Configurateur Comelit",
    description="API pour le configurateur vidéosurveillance",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS - En production, restreindre aux domaines autorisés
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# STATIC FILES
# ============================================================

# Monter le frontend (fichiers buildés)
if os.path.isdir(FRONTEND_DIR):
    # Servir index.html à la racine
    @app.get("/")
    async def root():
        index_path = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        raise HTTPException(404, "index.html not found")
    
    # Servir les assets statiques
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")
    
    # Fallback pour SPA (toutes les routes non-API retournent index.html)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Ne pas intercepter les routes API
        if full_path.startswith("api/") or full_path.startswith("data/") or full_path.startswith("export/"):
            raise HTTPException(404)
        
        # Fichiers statiques existants
        file_path = os.path.join(FRONTEND_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        
        # Sinon, retourner index.html (SPA routing)
        index_path = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        raise HTTPException(404)

# Monter les données (CSV + fiches techniques)
if os.path.isdir(DATA_DIR):
    app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")
else:
    print(f"[WARN] DATA_DIR not found: {DATA_DIR}")

# ============================================================
# AUTH
# ============================================================

def require_auth(auth: str | None):
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth.split(" ", 1)[1].strip()
    exp = TOKENS.get(token)
    if not exp or exp < time.time():
        raise HTTPException(status_code=401, detail="Invalid or expired token")

# ============================================================
# CSV HELPERS
# ============================================================

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

# ============================================================
# ROUTES API
# ============================================================

@app.get("/health")
def health():
    return {"ok": True, "timestamp": datetime.now(timezone.utc).isoformat()}

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
    candidates = [
        os.path.join(FRONTEND_DIR, "admin.html"),
        os.path.join(FRONTEND_DIR, "public", "admin.html"),
        os.path.join(APP_ROOT, "admin.html"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return FileResponse(p)
    raise HTTPException(status_code=404, detail="admin.html not found")

# ============================================================
# CATALOG API
# ============================================================

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

# ============================================================
# KPI API
# ============================================================

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
      LIMIT 90;
    """)
    by_day = [{"date": d, "count": int(c)} for (d, c) in cur.fetchall()][::-1]
    con.close()
    return {"total": total, "top": top, "by_day": by_day}

@app.get("/api/kpi/events")
def kpi_events(limit: int = 200, event: str = None, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    limit = max(1, min(int(limit or 200), 5000))
    con = _db()
    cur = con.cursor()
    
    if event:
        cur.execute("""
          SELECT ts_utc, session_id, event, payload_json, path, ip
          FROM kpi_events
          WHERE event = ?
          ORDER BY id DESC
          LIMIT ?;
        """, (event, limit))
    else:
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
# RESET KPI (TESTS)
# ============================================================

class ResetMonthIn(BaseModel):
    month: str = Field(..., description="Mois au format YYYY-MM", min_length=7, max_length=7)

@app.delete("/api/kpi/reset-month")
def kpi_reset_month(data: ResetMonthIn, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    
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
    
    start_date = f"{year}-{month:02d}-01"
    if month == 12:
        end_date = f"{year + 1}-01-01"
    else:
        end_date = f"{year}-{month + 1:02d}-01"
    
    con = _db()
    cur = con.cursor()
    
    cur.execute(
        "SELECT COUNT(*) FROM kpi_events WHERE ts_utc >= ? AND ts_utc < ?",
        (start_date, end_date)
    )
    count_before = int(cur.fetchone()[0] or 0)
    
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

# ============================================================
# EXPORT ZIP
# ============================================================

class ExportZipIn(BaseModel):
    pdf_base64: str = Field(..., description="PDF principal encodé en base64")
    product_ids: list[str] = Field(default_factory=list, description="Liste des IDs produits")
    zip_name: str = Field(default="export.zip", description="Nom du fichier ZIP")

def find_datasheet_for_product(product_id: str) -> str | None:
    if not product_id:
        return None
    
    clean_id = str(product_id).strip()
    
    search_dirs = [
        os.path.join(DATA_DIR, "fiches_techniques"),
        os.path.join(DATA_DIR, "datasheets"),
        os.path.join(DATA_DIR, "pdf"),
        os.path.join(DATA_DIR, "docs"),
        DATA_DIR,
    ]
    
    extensions = [".pdf", ".PDF"]
    
    patterns = [
        clean_id,
        clean_id.upper(),
        clean_id.lower(),
        clean_id.replace("-", "_"),
        clean_id.replace("_", "-"),
        f"FT_{clean_id}",
        f"DS_{clean_id}",
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
    try:
        pdf_bytes = base64.b64decode(data.pdf_base64)
        if len(pdf_bytes) < 1000:
            raise ValueError("PDF trop petit")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF base64 invalide: {e}")
    
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("rapport_configuration.pdf", pdf_bytes)
        
        added_files = set()
        missing_products = []
        
        for product_id in data.product_ids:
            if not product_id:
                continue
                
            datasheet_path = find_datasheet_for_product(product_id)
            
            if datasheet_path and os.path.isfile(datasheet_path):
                if datasheet_path in added_files:
                    continue
                added_files.add(datasheet_path)
                
                filename = os.path.basename(datasheet_path)
                zip_path = f"fiches_techniques/{filename}"
                
                try:
                    with open(datasheet_path, "rb") as f:
                        zf.writestr(zip_path, f.read())
                except Exception as e:
                    print(f"[WARN] Impossible de lire {datasheet_path}: {e}")
            else:
                missing_products.append(product_id)
        
        log_content = f"""Export généré le {datetime.now().isoformat()}

Produits demandés: {len(data.product_ids)}
Fiches techniques trouvées: {len(added_files)}
Fiches techniques manquantes: {len(missing_products)}

Produits sans fiche technique:
{chr(10).join(f"- {p}" for p in missing_products) if missing_products else "(aucun)"}
"""
        zf.writestr("_info_export.txt", log_content.encode("utf-8"))
    
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

@app.get("/export/test")
def export_test():
    return {
        "ok": True,
        "message": "Export endpoint is working",
        "data_dir": DATA_DIR,
        "data_dir_exists": os.path.isdir(DATA_DIR),
        "frontend_dir": FRONTEND_DIR,
        "frontend_dir_exists": os.path.isdir(FRONTEND_DIR),
    }

# ============================================================
# STARTUP
# ============================================================

print(f"""
============================================================
🚀 Configurateur Comelit - Backend Ready
============================================================
📁 Frontend: {FRONTEND_DIR} (exists: {os.path.isdir(FRONTEND_DIR)})
📁 Data: {DATA_DIR} (exists: {os.path.isdir(DATA_DIR)})
🔐 Admin password: {'[CUSTOM]' if ADMIN_PASSWORD != 'admin' else '[DEFAULT - CHANGE IN PRODUCTION!]'}
============================================================
""")
