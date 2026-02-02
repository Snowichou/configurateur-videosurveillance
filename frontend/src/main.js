import "./style.css";
import html2pdf from "html2pdf.js";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

window.html2pdf = html2pdf;
window.html2canvas = html2canvas;
window.jspdf = { jsPDF };
window.jsPDF = jsPDF;




// 1) On injecte ton "ancien" HTML dans #app
document.querySelector("#app").innerHTML = `
  <header class="appHeader appHeaderCentered">
    <div class="brandCenter" aria-label="COMELIT">
      <img class="brandLogoImg" src="/assets/logo.png" alt="COMELIT">
      <div class="brandTitle">Configurateur Vidéosurveillance</div>
      <div class="brandTagline">With you always</div>
    </div>

    <div class="progressWrap" id="progressWrap" aria-label="Progression">
      <div class="progressOuter" id="progressBarOuter">
        <div class="progressBar" id="progressBar"></div>
      </div>
      <div class="progressText" id="progressText"></div>
    </div>

    <div class="headerActions">
      <!-- ✅ SUPPRIMÉ: Bouton Admin (page séparée sur /admin) -->

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
          <div class="cardSubtitle">Visible à la fin (ou via "Afficher résultats").</div>
        </div>

        <div class="resultsBody">
          <div class="exportRow">
            <button id="btnExportPdf" class="btn" type="button">Export PDF</button>
</div>

          <div id="resultsEmpty" class="emptyState">
            <div class="emptyTitle">Pas encore finalisé</div>
            <div class="muted">Avance jusqu'à la dernière étape, puis "Finaliser".</div>
          </div>

          <div id="results" class="hidden">
            <div id="primaryReco"></div>
            <ul id="alerts" class="alerts"></ul>
          </div>
        </div>
      </aside>
    </div>
  </main>

  <!-- ✅ SUPPRIMÉ: Modal Admin complet (admin séparé sur /admin) -->
`;

// 2) IMPORTANT : on charge ton app.js APRÈS que le DOM soit en place.
// Sinon ton DOM cache (#steps, #btnCompute, etc.) sera null au moment du chargement.
import("./app.js");
