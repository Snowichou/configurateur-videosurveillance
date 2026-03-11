import "./style.css";
import "./optimisations.css";
import "./i18n.js";
import html2pdf from "html2pdf.js";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

window.html2pdf = html2pdf;
window.html2canvas = html2canvas;
window.jspdf = { jsPDF };
window.jsPDF = jsPDF;

// Favicon + viewport + PWA
(function setupPageMeta() {
  // Viewport pour mobile
  if (!document.querySelector('meta[name="viewport"]')) {
    const vp = document.createElement('meta');
    vp.name = 'viewport';
    vp.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    document.head.appendChild(vp);
  }
  
  // Theme color (barre de statut mobile)
  if (!document.querySelector('meta[name="theme-color"]')) {
    const tc = document.createElement('meta');
    tc.name = 'theme-color';
    tc.content = '#00BC70';
    document.head.appendChild(tc);
  }

  // Apple mobile web app
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const awc = document.createElement('meta');
    awc.name = 'apple-mobile-web-app-capable';
    awc.content = 'yes';
    document.head.appendChild(awc);
    const aws = document.createElement('meta');
    aws.name = 'apple-mobile-web-app-status-bar-style';
    aws.content = 'black-translucent';
    document.head.appendChild(aws);
  }

  // Manifest PWA
  if (!document.querySelector('link[rel="manifest"]')) {
    const mf = document.createElement('link');
    mf.rel = 'manifest';
    mf.href = '/manifest.json';
    document.head.appendChild(mf);
  }

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
      <div class="brandTitle" id="brandTitle">Configurateur Vidéosurveillance</div>
    </div>
    <div id="langSelectorWrap" style="position:absolute;top:12px;right:16px"></div>
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
          <div class="stepperLabel">Fixations</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="3">
          <div class="stepperDot"><span>4</span></div>
          <div class="stepperLabel">Stockage</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="4">
          <div class="stepperDot"><span>5</span></div>
          <div class="stepperLabel">Enregistreur</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="5">
          <div class="stepperDot"><span>6</span></div>
          <div class="stepperLabel">Options</div>
        </div>
        <div class="stepperLine"></div>
        <div class="stepperStep" data-step="6">
          <div class="stepperDot"><span>7</span></div>
          <div class="stepperLabel">Récapitulatif</div>
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

import("./app.js").then(() => {
  import("./optimisations.js");
  // i18n : injecter le sélecteur de langue + appliquer la langue détectée
  const langWrap = document.getElementById("langSelectorWrap");
  if (langWrap && typeof getLangSelectorHtml === "function") {
    langWrap.innerHTML = getLangSelectorHtml();
    langWrap.querySelector("#langSelector")?.addEventListener("change", (e) => {
      setLang(e.target.value);
    });
  }
  if (typeof updateStepperLabels === "function") updateStepperLabels();
  if (typeof updateNavButtons === "function") updateNavButtons();
  // i18n: mettre à jour le titre de l'app
  const brandEl = document.getElementById("brandTitle");
  if (brandEl && typeof T === "function") brandEl.textContent = T("app_title");
  if (typeof T === "function") document.title = T("app_title") + " - Comelit";
});

// PWA — Enregistrer le Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('[PWA] Service Worker registered:', reg.scope))
      .catch((err) => console.warn('[PWA] SW registration failed:', err.message));
  });
}