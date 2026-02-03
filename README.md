# Configurateur Videosurveillance Comelit - Deploiement

## Comment utiliser ce ZIP

### Etape 1 : Copie les fichiers dans ton projet existant

AVANT:
```
C:\AI\Configurateur\
├── backend\
│   └── app.py
├── frontend\
│   ├── src\
│   └── public\
└── data\
```

APRES (copie les fichiers de ce ZIP):
```
C:\AI\Configurateur\
├── Dockerfile          ← COPIE (depuis ce ZIP)
├── railway.json        ← COPIE (depuis ce ZIP)
├── .gitignore          ← COPIE (depuis ce ZIP)
├── .env.example        ← COPIE (depuis ce ZIP)
├── backend\
│   ├── app.py          ← REMPLACE (par celui du ZIP)
│   └── requirements.txt ← COPIE (depuis ce ZIP)
├── frontend\
│   ├── src\            ← GARDE (ton code actuel)
│   ├── dist\           ← SERA CREE par npm run build
│   └── public\
│       └── admin.html  ← REMPLACE (par celui du ZIP)
└── data\               ← GARDE (tes CSV actuels)
```

### Etape 2 : Build le frontend

```bash
cd C:\AI\Configurateur\frontend
npm install
npm run build
```

### Etape 3 : Push sur GitHub

```bash
cd C:\AI\Configurateur
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TON-USER/configurateur.git
git push -u origin main
```

### Etape 4 : Deploie sur Railway

1. Va sur https://railway.app
2. Connecte-toi avec GitHub
3. "New Project" -> "Deploy from GitHub repo"
4. Selectionne ton repo
5. Railway detecte automatiquement le Dockerfile
6. Va dans "Variables" et ajoute:
   CONFIG_ADMIN_PASSWORD = TonMotDePasseSecurise123!
7. Attends le build (~5 min)
8. Clique sur l'URL generee

## Fichiers inclus dans ce ZIP

| Fichier | Ou le mettre | Role |
|---------|--------------|------|
| Dockerfile | RACINE | Build Docker |
| railway.json | RACINE | Config Railway |
| .gitignore | RACINE | Ignore fichiers Git |
| .env.example | RACINE | Template variables |
| backend/app.py | backend/ | API FastAPI prod |
| backend/requirements.txt | backend/ | Dependances Python |
| frontend/public/admin.html | frontend/public/ | Page admin securisee |
