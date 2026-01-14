import "./style.css";

// 1) On injecte ton “ancien” HTML dans #app
document.querySelector("#app").innerHTML = `
  <header class="appHeader">
    <div class="brand">
      <div class="brandTop">
        <div class="brandTitle">Configurateur Vidéosurveillance</div>
        <span class="pill">MVP</span>
      </div>

      <div id="dataStatus" class="statusLine">—</div>

      <div class="progressWrap" id="progressWrap" aria-label="Progression">
        <div class="progressOuter" id="progressBarOuter">
          <div class="progressBar" id="progressBar"></div>
        </div>
        <div class="progressText" id="progressText"></div>
      </div>
    </div>

    <div class="headerActions">
      <div class="headerActionsLeft">
        <button id="btnAdmin" class="btn secondary" type="button">Admin</button>
      </div>

      <div class="headerActionsRight actions">
        <button id="btnReset" class="btn" type="button">Reset</button>
        <button id="btnDemo" class="btn" type="button">Démo</button>
        <button id="btnCompute" class="btn primary" type="button">Suivant</button>
      </div>
    </div>
  </header>

  <main class="appMain">
    <div id="mainGrid" class="appGrid">
      <!-- COL 1 -->
      <section class="card" aria-label="Étapes">
        <div class="cardHeader">
          <div class="cardTitle">Étapes</div>
          <div class="cardSubtitle">Choisis, valide, avance. Simple.</div>
        </div>
        <div id="steps" class="steps"></div>
      </section>

      <!-- COL 2 -->
      <aside id="resultCard" class="card hiddenCard" aria-label="Résultats">
        <div class="cardHeader">
          <div class="cardTitle">Résultats</div>
          <div class="cardSubtitle">Visible à la fin (ou via “Afficher résultats”).</div>
        </div>

        <div class="resultsBody">
          <div class="exportRow">
            <button id="btnExportPdf" class="btn" type="button">Export PDF</button>
            <button id="btnExportXlsx" class="btn" type="button">Export XLSX</button>
          </div>

          <div id="resultsEmpty" class="emptyState">
            <div class="emptyTitle">Pas encore finalisé</div>
            <div class="muted">Avance jusqu’à la dernière étape, puis “Finaliser”.</div>
          </div>

          <div id="results" class="hidden">
            <div id="primaryReco"></div>
            <ul id="alerts" class="alerts"></ul>
          </div>
        </div>
      </aside>
    </div>
  </main>

  <!-- ADMIN MODAL -->
  <div id="adminModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="adminTitle">
    <div class="modalCard">
      <div class="modalHeader">
        <div>
          <div id="adminTitle" class="modalTitle">Admin panel</div>
          <div class="modalSubtitle">Gestion des CSV (lecture/édition/sauvegarde).</div>
        </div>
        <button id="btnAdminClose" class="btn icon" type="button" aria-label="Fermer">✕</button>
      </div>

      <!-- LOGIN -->
      <div id="adminLoginBox" class="adminSection">
        <label class="field">
          <span class="label">Mot de passe admin</span>
          <input id="adminPassword" class="input" type="password" placeholder="••••••••" autocomplete="current-password" />
        </label>

        <button id="btnAdminLogin" class="btn primary full" type="button">Se connecter</button>
        <div id="adminLoginMsg" class="muted"></div>
      </div>

      <!-- EDITOR -->
      <div id="adminEditorBox" class="adminSection hidden">
        <div class="adminToolbar">
          <label class="field inline">
            <span class="label">Fichier</span>
            <select id="adminCsvSelect" class="select">
              <option value="cameras">cameras.csv</option>
              <option value="nvrs">nvrs.csv</option>
              <option value="hdds">hdds.csv</option>
              <option value="switches">switches.csv</option>
              <option value="accessories">accessories.csv</option>
            </select>
          </label>

          <div class="toolbarBtns">
            <button id="btnAdminLoad" class="btn secondary" type="button">Charger</button>
            <button id="btnAdminSave" class="btn primary" type="button">Sauvegarder</button>
            <button id="btnAdminLogout" class="btn secondary" type="button">Déconnexion</button>
          </div>
        </div>

        <div class="adminHint">
          Tips : conserve les headers. Un backup <code>.bak</code> est fait côté serveur.
        </div>

        <!-- ✅ TABLE EDITOR (UI PRO) -->
        <div class="adminGridWrap">
          <div class="adminGridTop">
            <div class="muted" id="adminGridMeta">—</div>

            <div class="adminGridActions">
              <button id="btnAdminAddRow" class="btn secondary" type="button">+ Ajouter</button>
              <button id="btnAdminDupRow" class="btn secondary" type="button">Dupliquer</button>
              <button id="btnAdminDelRow" class="btn secondary" type="button">Supprimer</button>

              <span class="adminGridSep"></span>

              <button id="btnAdminToggleExpert" class="btn" type="button">Mode expert</button>
            </div>
          </div>

          <!-- ✅ La grille se monte ici -->
          <div id="adminTableMount" class="adminTableMount"></div>

          <!-- ✅ EXPERT MODE (CSV brut) -->
          <div id="adminExpertBox" class="adminExpertBox hidden">
            <div class="adminHint">
              Mode expert : CSV brut (attention aux virgules/quotes). Les headers doivent rester identiques.
            </div>

            <textarea
              id="adminCsvText"
              class="textarea mono"
              spellcheck="false"
              placeholder="Le contenu CSV s’affiche ici…"
            ></textarea>
          </div>
        </div>

        <div id="adminMsg" class="muted"></div>
      </div>
    </div>
  </div>
`;

// 2) IMPORTANT : on charge ton app.js APRÈS que le DOM soit en place.
// Sinon ton DOM cache (#steps, #btnCompute, etc.) sera null au moment du chargement.
import("./app.js");
