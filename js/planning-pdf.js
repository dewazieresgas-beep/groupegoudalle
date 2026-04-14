/**
 * Planning PDF Viewer - Gestion de l'affichage du PDF de planning usine
 * Fonctionnalités: zoom, pan, plein écran, adaptation à la page
 */

// Configuration PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let currentPage = 1;
let zoomLevel = 1;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panOffsetX = 0;
let panOffsetY = 0;
let baseScale = 1;

// Wrapper pour le canvas pour gérer le pan
let canvasWrapper = null;

// Éléments DOM
const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('pdfContainer');
const loadingSpinner = document.getElementById('loadingSpinner');
const noPdfMessage = document.getElementById('noPdfMessage');
const pdfControls = document.getElementById('pdfControls');
const zoomValue = document.getElementById('zoomValue');

/**
 * Initialiser le viewer de PDF
 */
async function initPlanningViewer() {
  try {
    // Créer le wrapper pour le canvas
    canvasWrapper = document.createElement('div');
    canvasWrapper.style.cssText = 'display: inline-block; position: relative; cursor: grab;';
    canvas.parentNode.insertBefore(canvasWrapper, canvas);
    canvasWrapper.appendChild(canvas);

    // Charger le PDF depuis le serveur
    const response = await fetch(SERVER_URL + '/planning-pdf-get', { cache: 'no-store' });
    const data = await response.json();

    if (!data.success || !data.pdfUrl) {
      showNoPDF();
      return;
    }

    loadingSpinner.style.display = 'block';
    pdfControls.style.display = 'none';

    // Charger le document PDF
    pdfDoc = await pdfjsLib.getDocument(data.pdfUrl).promise;
    
    // Afficher la première page
    await renderPage(1);
    
    pdfControls.style.display = 'flex';
    loadingSpinner.style.display = 'none';

    // Adapter au conteneur
    fitPage();

    // Ajouter les event listeners
    setupEventListeners();
  } catch (error) {
    console.error('Erreur chargement PDF:', error);
    showNoPDF();
  }
}

/**
 * Afficher le message "Aucun PDF"
 */
function showNoPDF() {
  noPdfMessage.style.display = 'block';
  pdfControls.style.display = 'none';
  loadingSpinner.style.display = 'none';
  canvas.style.display = 'none';
}

/**
 * Rendre une page du PDF
 */
async function renderPage(pageNum) {
  if (!pdfDoc) return;

  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: baseScale * zoomLevel });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = 'block';

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
      background: '#ffffff'
    };

    await page.render(renderContext).promise;
    currentPage = pageNum;
    updateZoomDisplay();

    // Réinitialiser les styles de transformation
    resetCanvasTransform();
  } catch (error) {
    console.error('Erreur rendu page:', error);
  }
}

/**
 * Réinitialiser la transformation du canvas
 */
function resetCanvasTransform() {
  if (canvasWrapper) {
    canvasWrapper.style.transform = `translate(0px, 0px)`;
    panOffsetX = 0;
    panOffsetY = 0;
  }
}

/**
 * Mettre à jour l'affichage du zoom
 */
function updateZoomDisplay() {
  zoomValue.textContent = Math.round(zoomLevel * 100) + '%';
}

/**
 * Zoom avant
 */
async function zoomIn() {
  const oldZoom = zoomLevel;
  zoomLevel = Math.min(zoomLevel + 0.1, 3);
  
  if (oldZoom !== zoomLevel) {
    await renderPage(currentPage);
  }
}

/**
 * Zoom arrière
 */
async function zoomOut() {
  const oldZoom = zoomLevel;
  zoomLevel = Math.max(zoomLevel - 0.1, 0.5);
  
  if (oldZoom !== zoomLevel) {
    await renderPage(currentPage);
  }
}

/**
 * Adapter la page au conteneur
 */
async function fitPage() {
  if (!pdfDoc) return;

  const page = await pdfDoc.getPage(currentPage);
  const containerWidth = container.clientWidth - 40; // Margin
  const containerHeight = container.clientHeight - 60; // Pour les contrôles
  const viewport = page.getViewport({ scale: 1 });

  const scaleX = containerWidth / viewport.width;
  const scaleY = containerHeight / viewport.height;
  
  baseScale = Math.min(scaleX, scaleY, 1);
  zoomLevel = 1;
  panOffsetX = 0;
  panOffsetY = 0;

  resetCanvasTransform();
  await renderPage(currentPage);
}

/**
 * Réinitialiser la vue
 */
async function resetView() {
  zoomLevel = 1;
  panOffsetX = 0;
  panOffsetY = 0;
  isPanning = false;

  await fitPage();
}

/**
 * Basculer le plein écran
 */
function toggleFullscreen() {
  const elem = container;
  const btn = document.getElementById('fullscreenBtn');

  if (!document.fullscreenElement) {
    elem.requestFullscreen().catch(err => {
      console.error('Erreur plein écran:', err);
    });
    btn.textContent = '⛶ Quitter plein écran';
  } else {
    document.exitFullscreen();
    btn.textContent = '⛶ Plein écran';
  }
}

/**
 * Gérer l'événement fullscreenchange
 */
document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('fullscreenBtn');
  if (document.fullscreenElement) {
    btn.textContent = '⛶ Quitter plein écran';
  } else {
    btn.textContent = '⛶ Plein écran';
  }
});

/**
 * Configurer les event listeners pour le pan à la souris
 */
function setupEventListeners() {
  canvas.addEventListener('mousedown', startPan);
  canvas.addEventListener('mousemove', updatePan);
  canvas.addEventListener('mouseup', endPan);
  canvas.addEventListener('mouseleave', endPan);

  // Wheel zoom
  canvas.addEventListener('wheel', handleWheel, { passive: false });
}

/**
 * Démarrer le pan
 */
function startPan(e) {
  // Seulement pan si zoom > 1
  if (zoomLevel <= 1) return;
  
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  canvas.style.cursor = 'grabbing';
}

/**
 * Mettre à jour le pan
 */
function updatePan(e) {
  if (!isPanning || !canvasWrapper) return;

  const deltaX = e.clientX - panStartX;
  const deltaY = e.clientY - panStartY;

  panOffsetX += deltaX;
  panOffsetY += deltaY;

  panStartX = e.clientX;
  panStartY = e.clientY;

  applyPanOffset();
}

/**
 * Terminer le pan
 */
function endPan() {
  isPanning = false;
  canvas.style.cursor = 'grab';
}

/**
 * Appliquer le décalage de pan au canvas wrapper
 */
function applyPanOffset() {
  if (!canvasWrapper) return;

  // Limiter le pan pour ne pas aller trop loin
  const maxOffsetX = Math.max(0, (canvasWrapper.offsetWidth * zoomLevel - container.clientWidth) / 2);
  const maxOffsetY = Math.max(0, (canvasWrapper.offsetHeight * zoomLevel - container.clientHeight) / 2);

  panOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, panOffsetX));
  panOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, panOffsetY));

  canvasWrapper.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px)`;
}

/**
 * Gérer le zoom à la molette
 */
async function handleWheel(e) {
  e.preventDefault();

  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  const oldZoom = zoomLevel;
  zoomLevel = Math.max(0.5, Math.min(zoomLevel + delta, 3));

  if (oldZoom !== zoomLevel) {
    await renderPage(currentPage);
  }
}

/**
 * Gérer le redimensionnement de la fenêtre
 */
window.addEventListener('resize', async () => {
  if (pdfDoc) {
    // Ré-adapter la page si elle était en mode "fit"
    if (zoomLevel === 1 && panOffsetX === 0 && panOffsetY === 0) {
      await fitPage();
    }
  }
});

/**
 * Gérer la sortie du plein écran
 */
document.addEventListener('fullscreenchange', async () => {
  if (!document.fullscreenElement) {
    // Ré-adapter quand on quitte le plein écran
    if (pdfDoc && zoomLevel === 1) {
      setTimeout(() => fitPage(), 100);
    }
  }
});
