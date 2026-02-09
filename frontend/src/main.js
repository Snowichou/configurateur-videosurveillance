import "./style.css";
import html2pdf from "html2pdf.js";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

window.html2pdf = html2pdf;
window.html2canvas = html2canvas;
window.jspdf = { jsPDF };
window.jsPDF = jsPDF;

// Favicon
(function setupPageMeta() {
  const existingFavicon = document.querySelector('link[rel="icon"]');
  if (existingFavicon) {
    existingFavicon.href = '/assets/logosmall.png';
  } else {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = '/assets/logosmall.png';
    document.head.appendChild(link);
  }
  document.title = 'Configurateur Vidéosurveillance - Comelit';
})();

document.querySelector("#app").innerHTML = `
  <!-- HEADER : Logo + Titre uniquement -->
  <header class="appHeader appHeaderCentered">
    <div class="brandCenter" aria-label="COMELIT">
      <img class="brandLogoImg" src="/assets/logo.png" alt="COMELIT">
      <div class="brandTitle">Configurateur Vidéosurveillance</div>
      <div class="brandTagline">With you always</div>
    </div>
  </header>

  <!-- SECTION STEPPER : Titre étape + Stepper + Boutons -->
  <div class="stepperSection">
    <div class="stepperTitle" id="stepperTitle">Configuration</div>
    <div class="stepperSubtitle" id="stepperSubtitle">Nom du projet (optionnel) + contexte.</div>
    
    <div class="stepperWrap" id="stepperWrap" aria-label="Progression">
      <div class="stepper" id="stepper">
        <div class="stepperStep" data-step="0">
          <div class="stepperDot"><span>1</span></div>
          <div class="stepperLabel">Projet</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="1">
          <div class="stepperDot"><span>2</span></div>
          <div class="stepperLabel">Caméras</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="2">
          <div class="stepperDot"><span>3</span></div>
          <div class="stepperLabel">Supports</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="3">
          <div class="stepperDot"><span>4</span></div>
          <div class="stepperLabel">NVR</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="4">
          <div class="stepperDot"><span>5</span></div>
          <div class="stepperLabel">Stockage</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="5">
          <div class="stepperDot"><span>6</span></div>
          <div class="stepperLabel">Résumé</div>
        </div>
      </div>
    </div>

    <!-- Boutons de navigation dans la section stepper -->
    <div class="navActions" id="navActions">
      <button id="btnPrev" class="btn btnSecondary" type="button" title="Revenir à l'étape précédente" style="display:none">
        <span class="btnIcon">←</span>
        <span class="btnLabel">Précédent</span>
      </button>
      <button id="btnReset" class="btn btnGhost" type="button">Réinitialiser</button>
      <button id="btnDemo" class="btn btnGhost" type="button">Démo</button>
      <button id="btnCompute" class="btn primary" type="button">
        <span class="btnLabel">Suivant</span>
        <span class="btnIcon">→</span>
      </button>
    </div>
  </div>

  <main class="appMain">
    <div id="mainGrid" class="appGrid">
      <section class="card cardMain" aria-label="Étapes">
        <div id="steps" class="steps"></div>
      </section>

      <aside id="resultCard" class="card hiddenCard" aria-label="Résultats">
        <div class="cardHeader">
          <div class="cardTitle">Résultats</div>
          <div class="cardSubtitle">Visible à la fin (ou via Afficher résultats).</div>
        </div>

        <div class="resultsBody">
          <div class="exportRow">
            <button id="btnExportPdf" class="btn" type="button">Export PDF</button>
          </div>

          <div id="resultsEmpty" class="emptyState">
            <div class="emptyTitle">Pas encore finalisé</div>
            <div class="muted">Avance jusqu'à la dernière étape, puis Finaliser.</div>
          </div>

          <div id="results" class="hidden">
            <div id="primaryReco"></div>
            <ul id="alerts" class="alerts"></ul>
          </div>
        </div>
      </aside>
    </div>
  </main>

  <!-- Éléments cachés pour compatibilité -->
  <div id="progressBar" style="display:none"></div>
  <div id="progressText" style="display:none"></div>
  <div class="headerActions" style="display:none"></div>
`;

import("./app.js");