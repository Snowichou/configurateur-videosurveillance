from fastapi import FastAPI, HTTPException, Header, Body
from fastapi.responses import PlainTextResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import os, secrets, time

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(APP_ROOT, ".."))  # C:\AI\Configurateur

FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DATA_DIR = os.path.join(BASE_DIR, "data")    # C:\AI\Configurateur\data

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
TOKENS = {}

ALLOWED = {
    "cameras": "cameras.csv",
    "nvrs": "nvrs.csv",
    "hdds": "hdds.csv",
    "switches": "switches.csv",
    "accessories": "accessories.csv",
}

def require_auth(auth: str | None):
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = auth.split(" ", 1)[1].strip()
    exp = TOKENS.get(token)
    if not exp or exp < time.time():
        TOKENS.pop(token, None)
        raise HTTPException(status_code=401, detail="Invalid/expired token")
    return token

app = FastAPI()

# ---------------------------
# DEBUG (optionnel mais ultra utile)
# ---------------------------
print("BASE_DIR      =", BASE_DIR)
print("FRONTEND_DIR  =", FRONTEND_DIR)
print("DATA_DIR      =", DATA_DIR)
print("index exists? =", os.path.isfile(os.path.join(FRONTEND_DIR, "index.html")))
print("app.js exists?=", os.path.isfile(os.path.join(FRONTEND_DIR, "app.js")))
print("DATA exists?  =", os.path.isdir(DATA_DIR))
if os.path.isdir(DATA_DIR):
    print("DATA files    =", os.listdir(DATA_DIR))

# ---------------------------
# ROUTE HOME EXPLICITE ✅ (corrige le 404 sur /)
# ---------------------------
@app.get("/")
def home():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if not os.path.isfile(index_path):
        raise HTTPException(status_code=500, detail=f"index.html introuvable: {index_path}")
    return FileResponse(index_path)

# ---------------------------
# API D'ABORD (IMPORTANT)
# ---------------------------
@app.post("/api/login")
def login(payload: dict = Body(...)):
    pwd = (payload.get("password") or "").strip()
    if pwd != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Bad password")
    token = secrets.token_urlsafe(32)
    TOKENS[token] = time.time() + 60 * 60  # 1h
    return {"token": token, "expires_in": 3600}

@app.get("/api/csv/{name}", response_class=PlainTextResponse)
def read_csv(name: str):
    if name not in ALLOWED:
        raise HTTPException(status_code=404, detail="Unknown CSV")

    path = os.path.join(DATA_DIR, ALLOWED[name])
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File missing: {path}")

    with open(path, "r", encoding="utf-8") as f:
        return f.read()

@app.post("/api/csv/{name}", response_class=PlainTextResponse)
def write_csv(
    name: str,
    content: str = Body(..., embed=True),
    authorization: str | None = Header(default=None),
):
    require_auth(authorization)

    if name not in ALLOWED:
        raise HTTPException(status_code=404, detail="Unknown CSV")

    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, ALLOWED[name])

    # backup
    if os.path.isfile(path):
        bak = path + ".bak"
        try:
            with open(path, "r", encoding="utf-8") as f:
                old = f.read()
            with open(bak, "w", encoding="utf-8") as f:
                f.write(old)
        except:
            pass

    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content.strip() + "\n")

    return "OK"

# ---------------------------
# STATIC ENSUITE
# ---------------------------
# d'abord /data
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")

# ensuite le frontend (sert app.js, css, etc.)
# (le GET "/" est déjà géré par home() ci-dessus)
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
