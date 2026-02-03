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
  document.title = 'Configurateur Videosurveillance - Comelit';
})();

document.querySelector("#app").innerHTML = `
  <header class="appHeader appHeaderCentered">
    <div class="brandCenter" aria-label="COMELIT">
      <img class="brandLogoImg" src="/assets/logo.png" alt="COMELIT">
      <div class="brandTitle">Configurateur Videosurveillance</div>
      <div class="brandTagline">With you always</div>
    </div>

    <div class="progressWrap" id="progressWrap" aria-label="Progression">
      <div class="progressOuter" id="progressBarOuter">
        <div class="progressBar" id="progressBar"></div>
      </div>
      <div class="progressText" id="progressText"></div>
    </div>

    <div class="headerActions">
      <div class="headerActionsRight actions">
        <button id="btnPrev" class="btn" type="button" title="Revenir a l etape precedente" style="display:none">Precedent</button>
        <button id="btnReset" class="btn" type="button">Reset</button>
        <button id="btnDemo" class="btn" type="button">Demo</button>
        <button id="btnCompute" class="btn primary" type="button">Suivant</button>
      </div>
    </div>
  </header>

  <main class="appMain">
    <div id="mainGrid" class="appGrid">
      <section class="card" aria-label="Etapes">
        <div class="cardHeader">
          <div class="cardTitle">Etapes</div>
          <div class="cardSubtitle">Choisis, valide, avance. Simple.</div>
        </div>
        <div id="steps" class="steps"></div>
      </section>

      <aside id="resultCard" class="card hiddenCard" aria-label="Resultats">
        <div class="cardHeader">
          <div class="cardTitle">Resultats</div>
          <div class="cardSubtitle">Visible a la fin (ou via Afficher resultats).</div>
        </div>

        <div class="resultsBody">
          <div class="exportRow">
            <button id="btnExportPdf" class="btn" type="button">Export PDF</button>
          </div>

          <div id="resultsEmpty" class="emptyState">
            <div class="emptyTitle">Pas encore finalise</div>
            <div class="muted">Avance jusqu a la derniere etape, puis Finaliser.</div>
          </div>

          <div id="results" class="hidden">
            <div id="primaryReco"></div>
            <ul id="alerts" class="alerts"></ul>
          </div>
        </div>
      </aside>
    </div>
  </main>
`;

import("./app.js");
