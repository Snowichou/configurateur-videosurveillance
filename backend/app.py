"""
============================================================
FastAPI Backend - Configurateur Comelit (Render Ready)
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
# CONFIGURATION - ADAPTÉE POUR RENDER
# ============================================================

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(APP_ROOT, ".."))

# Frontend buildé - LE CHEMIN CORRECT EST frontend/dist (pas frontend)
FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")

# Données CSV
DATA_DIR = os.path.join(BASE_DIR, "data")

# Admin password
ADMIN_PASSWORD = os.getenv("CONFIG_ADMIN_PASSWORD", "admin")
if ADMIN_PASSWORD == "admin":
    print("⚠️  ATTENTION: Mot de passe admin par défaut!")

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
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
# API ROUTES
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
    cur.execute("SELECT substr(ts_utc,1,10) d, COUNT(*) c FROM kpi_events GROUP BY d ORDER BY d DESC LIMIT 90;")
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
        cur.execute("SELECT ts_utc, session_id, event, payload_json, path, ip FROM kpi_events WHERE event = ? ORDER BY id DESC LIMIT ?;", (event, limit))
    else:
        cur.execute("SELECT ts_utc, session_id, event, payload_json, path, ip FROM kpi_events ORDER BY id DESC LIMIT ?;", (limit,))
    rows = []
    for ts, sid, ev, pj, path, ip in cur.fetchall():
        try:
            payload = json.loads(pj) if pj else {}
        except:
            payload = {"_raw": pj}
        rows.append({"ts_utc": ts, "session_id": sid, "event": ev, "payload": payload, "path": path, "ip": ip})
    con.close()
    return {"rows": rows}

@app.get("/api/kpi/export.csv")
def kpi_export_csv(authorization: str | None = Header(default=None)):
    require_auth(authorization)
    con = _db()
    cur = con.cursor()
    cur.execute("SELECT ts_utc, session_id, event, payload_json, path, ua, ip FROM kpi_events ORDER BY id DESC;")
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow(["ts_utc","session_id","event","payload_json","path","ua","ip"])
    for r in cur.fetchall():
        w.writerow(list(r))
    con.close()
    data = out.getvalue().encode("utf-8")
    return Response(content=data, media_type="text/csv; charset=utf-8", 
                    headers={"Content-Disposition": 'attachment; filename="kpi_export.csv"'})

class ResetMonthIn(BaseModel):
    month: str = Field(..., min_length=7, max_length=7)

@app.delete("/api/kpi/reset-month")
def kpi_reset_month(data: ResetMonthIn, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    try:
        parts = data.month.split("-")
        year, month = int(parts[0]), int(parts[1])
        if not (2020 <= year <= 2100 and 1 <= month <= 12):
            raise ValueError()
    except:
        raise HTTPException(400, "Format invalide (YYYY-MM)")
    start = f"{year}-{month:02d}-01"
    end = f"{year}-{month+1:02d}-01" if month < 12 else f"{year+1}-01-01"
    con = _db()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) FROM kpi_events WHERE ts_utc >= ? AND ts_utc < ?", (start, end))
    count = cur.fetchone()[0]
    cur.execute("DELETE FROM kpi_events WHERE ts_utc >= ? AND ts_utc < ?", (start, end))
    con.commit()
    con.close()
    return {"success": True, "deleted": count, "message": f"{count} événement(s) supprimé(s)"}

# ============================================================
# EXPORT ZIP
# ============================================================

class ExportZipIn(BaseModel):
    pdf_base64: str
    product_ids: list[str] = []
    zip_name: str = "export.zip"

@app.post("/export/localzip")
async def export_localzip(data: ExportZipIn):
    try:
        pdf_bytes = base64.b64decode(data.pdf_base64)
    except:
        raise HTTPException(400, "PDF base64 invalide")
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("rapport_configuration.pdf", pdf_bytes)
    zip_buffer.seek(0)
    return Response(content=zip_buffer.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{data.zip_name}"'})

@app.get("/export/test")
def export_test():
    return {
        "ok": True, 
        "frontend_dist": FRONTEND_DIST, 
        "frontend_exists": os.path.isdir(FRONTEND_DIST),
        "data_dir": DATA_DIR,
        "data_exists": os.path.isdir(DATA_DIR)
    }

# ============================================================
# STATIC FILES - MOUNT CONDITIONALLY
# ============================================================

# Log des chemins
print(f"📁 BASE_DIR: {BASE_DIR}")
print(f"📁 FRONTEND_DIST: {FRONTEND_DIST} (exists: {os.path.isdir(FRONTEND_DIST)})")
print(f"📁 DATA_DIR: {DATA_DIR} (exists: {os.path.isdir(DATA_DIR)})")

# Servir les données CSV
if os.path.isdir(DATA_DIR):
    app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")
    print("✅ /data mounted")

# Servir le frontend buildé (dist/)
if os.path.isdir(FRONTEND_DIST):
    # Assets JS/CSS
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
        print("✅ /assets mounted")
    
    # Page admin (chercher dans plusieurs endroits)
    @app.get("/admin")
    async def admin_page():
        candidates = [
            os.path.join(FRONTEND_DIST, "admin.html"),
            os.path.join(BASE_DIR, "frontend", "public", "admin.html"),
            os.path.join(BASE_DIR, "frontend", "dist", "admin.html"),
        ]
        for p in candidates:
            if os.path.isfile(p):
                return FileResponse(p)
        raise HTTPException(404, "admin.html not found")
    
    # Route racine - servir index.html
    @app.get("/")
    async def root():
        index = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        raise HTTPException(404, "index.html not found")
    
    # Catch-all pour SPA (fichiers statiques ou index.html)
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Ignorer les routes API
        if full_path.startswith(("api/", "data/", "export/", "health", "assets/")):
            raise HTTPException(404)
        
        # Fichier existe dans dist/ ?
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        
        # Sinon SPA fallback -> index.html
        index = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        
        raise HTTPException(404)

    print("✅ Frontend routes configured")

else:
    print(f"⚠️ Frontend dist not found at {FRONTEND_DIST}")
    
    @app.get("/")
    def no_frontend():
        return {"error": "Frontend not built", "expected": FRONTEND_DIST}

# ============================================================
# STARTUP
# ============================================================
print("""
============================================================
🚀 Configurateur Comelit - Ready!
============================================================
""")
