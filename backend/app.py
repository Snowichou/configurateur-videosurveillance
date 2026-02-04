"""
============================================================
FastAPI Backend - Configurateur Comelit
Version optimisée : Gzip, Cache, Portable
============================================================
"""

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field
import os, secrets, time, json, csv, io, sqlite3, base64, zipfile
from datetime import datetime, timezone

# ============================================================
# CONFIGURATION PORTABLE
# ============================================================

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(APP_ROOT, ".."))

# Frontend : cherche dans plusieurs endroits (portable)
FRONTEND_CANDIDATES = [
    os.path.join(BASE_DIR, "frontend", "dist"),
    os.path.join(BASE_DIR, "dist"),
    os.path.join(APP_ROOT, "dist"),
]
FRONTEND_DIST = next((p for p in FRONTEND_CANDIDATES if os.path.isdir(p)), FRONTEND_CANDIDATES[0])

# Data : idem
DATA_CANDIDATES = [
    os.path.join(BASE_DIR, "data"),
    os.path.join(APP_ROOT, "data"),
    os.path.join(APP_ROOT, "..", "data"),
]
DATA_DIR = next((p for p in DATA_CANDIDATES if os.path.isdir(p)), DATA_CANDIDATES[0])

# Admin password depuis variable d'environnement
ADMIN_PASSWORD = os.getenv("CONFIG_ADMIN_PASSWORD", "admin")
if ADMIN_PASSWORD == "admin":
    print("⚠️  ATTENTION: Mot de passe admin par défaut! Définissez CONFIG_ADMIN_PASSWORD")

# Tokens en mémoire (en prod, utiliser Redis)
TOKENS: dict[str, float] = {}

# Catalogues autorisés
ALLOWED_CATALOGS = {
    "cameras": "cameras.csv",
    "nvrs": "nvrs.csv",
    "hdds": "hdds.csv",
    "switches": "switches.csv",
    "accessories": "accessories.csv",
    "screens": "screens.csv",
    "enclosures": "enclosures.csv",
    "signage": "signage.csv",
}

# Base KPI
KPI_DB = os.path.join(APP_ROOT, "kpi.sqlite3")

# ============================================================
# DATABASE KPI
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

# Init DB au démarrage
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

# Middleware Gzip : compresse automatiquement les réponses > 500 bytes
app.add_middleware(GZipMiddleware, minimum_size=500)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# HELPERS
# ============================================================

def require_auth(auth: str | None):
    """Vérifie le token d'authentification."""
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth.split(" ", 1)[1].strip()
    exp = TOKENS.get(token)
    if not exp or exp < time.time():
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _csv_path(kind: str) -> str:
    """Retourne le chemin du fichier CSV."""
    fn = ALLOWED_CATALOGS.get(kind)
    if not fn:
        raise HTTPException(status_code=404, detail="Unknown catalog")
    p = os.path.abspath(os.path.join(DATA_DIR, fn))
    if not p.startswith(os.path.abspath(DATA_DIR)):
        raise HTTPException(status_code=400, detail="Bad path")
    return p


def _read_csv(path: str):
    """Lit un fichier CSV et retourne colonnes + lignes."""
    if not os.path.exists(path):
        return [], []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def _write_csv(path: str, columns: list[str], rows: list[dict]):
    """Écrit un fichier CSV."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: str(r.get(c) or "") for c in columns})


def cached_response(content: bytes, media_type: str, max_age: int = 3600) -> Response:
    """Retourne une réponse avec headers de cache."""
    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": f"public, max-age={max_age}"}
    )

# ============================================================
# ROUTES API
# ============================================================

@app.get("/health")
def health():
    """Health check pour les load balancers."""
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


# --- Auth ---

class LoginIn(BaseModel):
    password: str = Field(..., min_length=1)

@app.post("/api/login")
def login(data: LoginIn):
    if data.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Bad password")
    token = secrets.token_urlsafe(24)
    TOKENS[token] = time.time() + 24 * 3600  # 24h
    return {"token": token, "expires_in": 86400}


# --- Catalog CRUD ---

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
    cols, rows = _read_csv(path)
    return {"kind": kind, "filename": os.path.basename(path), "columns": cols, "rows": rows}

@app.put("/api/admin/catalog/{kind}")
def put_catalog(kind: str, data: CatalogIn, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    path = _csv_path(kind)
    cols = [c.strip() for c in data.columns if c.strip()]
    if not cols:
        raise HTTPException(status_code=400, detail="Empty columns")
    _write_csv(path, cols, data.rows)
    return {"ok": True, "rows": len(data.rows)}


# --- KPI ---

class KpiIn(BaseModel):
    session_id: str | None = None
    event: str = Field(..., min_length=1, max_length=80)
    payload: dict = Field(default_factory=dict)

@app.post("/api/kpi/collect")
async def kpi_collect(data: KpiIn, request: Request):
    ts = datetime.now(timezone.utc).isoformat()
    con = _db()
    con.execute(
        "INSERT INTO kpi_events(ts_utc, session_id, event, payload_json, path, ua, ip) VALUES(?,?,?,?,?,?,?)",
        (ts, data.session_id, data.event, json.dumps(data.payload, ensure_ascii=False),
         request.headers.get("referer", ""), request.headers.get("user-agent", ""),
         request.client.host if request.client else "")
    )
    con.commit()
    con.close()
    return {"ok": True}

@app.post("/api/kpi/event")
async def kpi_event(data: KpiIn, request: Request):
    return await kpi_collect(data, request)

@app.get("/api/kpi/summary")
def kpi_summary(authorization: str | None = Header(default=None)):
    require_auth(authorization)
    con = _db()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) FROM kpi_events")
    total = cur.fetchone()[0]
    cur.execute("SELECT event, COUNT(*) c FROM kpi_events GROUP BY event ORDER BY c DESC LIMIT 20")
    top = [{"event": e, "count": c} for e, c in cur.fetchall()]
    cur.execute("SELECT substr(ts_utc,1,10) d, COUNT(*) c FROM kpi_events GROUP BY d ORDER BY d DESC LIMIT 90")
    by_day = [{"date": d, "count": c} for d, c in cur.fetchall()][::-1]
    con.close()
    return {"total": total, "top": top, "by_day": by_day}

@app.get("/api/kpi/events")
def kpi_events(limit: int = 200, event: str = None, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    limit = max(1, min(limit, 5000))
    con = _db()
    cur = con.cursor()
    if event:
        cur.execute("SELECT ts_utc, session_id, event, payload_json, path, ip FROM kpi_events WHERE event=? ORDER BY id DESC LIMIT ?", (event, limit))
    else:
        cur.execute("SELECT ts_utc, session_id, event, payload_json, path, ip FROM kpi_events ORDER BY id DESC LIMIT ?", (limit,))
    rows = [{"ts_utc": r[0], "session_id": r[1], "event": r[2], "payload": json.loads(r[3]) if r[3] else {}, "path": r[4], "ip": r[5]} for r in cur.fetchall()]
    con.close()
    return {"rows": rows}

@app.get("/api/kpi/export.csv")
def kpi_export(authorization: str | None = Header(default=None)):
    require_auth(authorization)
    con = _db()
    cur = con.cursor()
    cur.execute("SELECT ts_utc, session_id, event, payload_json, path, ua, ip FROM kpi_events ORDER BY id DESC")
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow(["ts_utc", "session_id", "event", "payload_json", "path", "ua", "ip"])
    w.writerows(cur.fetchall())
    con.close()
    return Response(
        content=out.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="kpi_export.csv"'}
    )

class ResetMonthIn(BaseModel):
    month: str = Field(..., min_length=7, max_length=7)

@app.delete("/api/kpi/reset-month")
def kpi_reset_month(data: ResetMonthIn, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    try:
        year, month = map(int, data.month.split("-"))
        assert 2020 <= year <= 2100 and 1 <= month <= 12
    except:
        raise HTTPException(400, "Format: YYYY-MM")
    start = f"{year}-{month:02d}-01"
    end = f"{year}-{month+1:02d}-01" if month < 12 else f"{year+1}-01-01"
    con = _db()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) FROM kpi_events WHERE ts_utc >= ? AND ts_utc < ?", (start, end))
    count = cur.fetchone()[0]
    cur.execute("DELETE FROM kpi_events WHERE ts_utc >= ? AND ts_utc < ?", (start, end))
    con.commit()
    con.close()
    return {"success": True, "deleted": count}


# --- Export ZIP ---

class ExportZipIn(BaseModel):
    pdf_base64: str
    product_ids: list[str] = []
    zip_name: str = "export.zip"

@app.post("/export/localzip")
async def export_zip(data: ExportZipIn):
    try:
        pdf = base64.b64decode(data.pdf_base64)
    except:
        raise HTTPException(400, "Invalid PDF")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("rapport.pdf", pdf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{data.zip_name}"'}
    )

@app.get("/export/test")
def export_test():
    return {"ok": True, "frontend": FRONTEND_DIST, "data": DATA_DIR}


# ============================================================
# STATIC FILES
# ============================================================

# Data CSV avec cache
if os.path.isdir(DATA_DIR):
    app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")
    print(f"✅ /data -> {DATA_DIR}")

# Frontend
if os.path.isdir(FRONTEND_DIST):
    assets = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets):
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
        print(f"✅ /assets -> {assets}")

    @app.get("/admin")
    async def admin():
        for p in [os.path.join(FRONTEND_DIST, "admin.html"), os.path.join(BASE_DIR, "frontend", "public", "admin.html")]:
            if os.path.isfile(p):
                return FileResponse(p)
        raise HTTPException(404, "admin.html not found")

    @app.get("/")
    async def root():
        index = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        raise HTTPException(404, "index.html not found")

    @app.get("/{path:path}")
    async def spa(path: str):
        if path.startswith(("api/", "data/", "export/", "health", "assets/")):
            raise HTTPException(404)
        file = os.path.join(FRONTEND_DIST, path)
        if os.path.isfile(file):
            return FileResponse(file)
        index = os.path.join(FRONTEND_DIST, "index.html")
        return FileResponse(index) if os.path.isfile(index) else HTTPException(404)

    print(f"✅ Frontend -> {FRONTEND_DIST}")
else:
    @app.get("/")
    def no_frontend():
        return {"error": "Frontend not found", "expected": FRONTEND_DIST}

# ============================================================
# STARTUP
# ============================================================

print(f"""
╔══════════════════════════════════════════════════════════╗
║  🚀 Configurateur Comelit - Ready                        ║
╠══════════════════════════════════════════════════════════╣
║  Frontend: {str(os.path.isdir(FRONTEND_DIST)):5} | Data: {str(os.path.isdir(DATA_DIR)):5}              ║
║  Gzip: ON | Cache: ON                                    ║
╚══════════════════════════════════════════════════════════╝
""")