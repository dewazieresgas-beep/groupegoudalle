/**
 * Planning PDF Viewer - Gestion de l'affichage du PDF de planning usine
 * Fonctionnalités: zoom haute qualité, pan, plein écran, adaptation à la page
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

// Wrapper pour le canvas pour gérer le pan
let canvasWrapper = null;
let initialScale = 1;

// Éléments DOM
const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const container = document.getElementById('pdfContainer');
const loadingSpinner = document.getElementById('loadingSpinner');
const noPdfMessage = document.getElementById('noPdfMessage');
const pdfControls = document.getElementById('pdfControls');
const zoomValue = document.getElementById('zoomValue');

// Rapport pixel réel pour une meilleure qualité
const PIXEL_RATIO = window.devicePixelRatio || 1;
const QUALITY_SCALE = 1.5; // Scale additionnel pour la qualité (1.5x plus de pixels)

/**
 * Initialiser le viewer de PDF
 */
async function initPlanningViewer() {
  try {
    console.log('[Planning PDF Viewer] Initialisation...');
    
    // Créer le wrapper pour le canvas
    canvasWrapper = document.createElement('div');
    canvasWrapper.style.cssText = 'display: inline-block; position: relative; cursor: grab; transform-origin: center;';
    canvas.parentNode.insertBefore(canvasWrapper, canvas);
    canvasWrapper.appendChild(canvas);

    // Charger le PDF depuis le serveur
    console.log('[Planning PDF Viewer] Récupération du PDF depuis:', SERVER_URL + '/planning-pdf-get');
    const response = await fetch(SERVER_URL + '/planning-pdf-get', { cache: 'no-store' });
    const data = await response.json();

    console.log('[Planning PDF Viewer] Réponse:', data);

    if (!data.success || !data.pdfUrl) {
      console.warn('[Planning PDF Viewer] Aucun PDF à afficher');
      showNoPDF();
      return;
    }

    loadingSpinner.style.display = 'block';
    pdfControls.style.display = 'none';
    console.log('[Planning PDF Viewer] Chargement du PDF depuis:', data.pdfUrl);

    // Charger le document PDF
    try {
      pdfDoc = await pdfjsLib.getDocument(data.pdfUrl).promise;
      console.log('[Planning PDF Viewer] PDF chargé, pages:', pdfDoc.numPages);
    } catch (pdfError) {
      console.error('[Planning PDF Viewer] Erreur chargement PDF.js:', pdfError);
      showMessage('Erreur lors du chargement du PDF: ' + pdfError.message);
      showNoPDF();
      return;
    }
    
    // Afficher la première page
    await renderPage(1);
    
    pdfControls.style.display = 'flex';
    loadingSpinner.style.display = 'none';

    // Adapter au conteneur
    fitPage();

    // Ajouter les event listeners
    setupEventListeners();
    
    console.log('[Planning PDF Viewer] ✓ Initialisé avec succès');
  } catch (error) {
    console.error('[Planning PDF Viewer] Erreur initialisation:', error);
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
 * Rendre une page du PDF avec haute qualité
 */
async function renderPage(pageNum) {
  if (!pdfDoc) return;

  try {
    const page = await pdfDoc.getPage(pageNum);
    
    // Calculer l'échelle avec qualité élevée
    const scale = initialScale * zoomLevel * PIXEL_RATIO * QUALITY_SCALE;
    const viewport = page.getViewport({ scale });

    // Configurer le canvas avec les vraies dimensions (haute résolution)
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = (viewport.width / PIXEL_RATIO / QUALITY_SCALE) + 'px';
    canvas.style.height = (viewport.height / PIXEL_RATIO / QUALITY_SCALE) + 'px';
    canvas.style.display = 'block';

    // Rendre le PDF
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
      background: '#ffffff'
    };

    await page.render(renderContext).promise;
    currentPage = pageNum;
    updateZoomDisplay();
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
  zoomLevel = Math.min(zoomLevel + 0.2, 5);
  
  if (oldZoom !== zoomLevel) {
    await renderPage(currentPage);
  }
}

/**
 * Zoom arrière
 */
async function zoomOut() {
  const oldZoom = zoomLevel;
  zoomLevel = Math.max(zoomLevel - 0.2, 0.5);
  
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
  const containerHeight = container.clientHeight - 80; // Pour les contrôles
  const viewport = page.getViewport({ scale: 1 });

  const scaleX = containerWidth / (viewport.width / PIXEL_RATIO / QUALITY_SCALE);
  const scaleY = containerHeight / (viewport.height / PIXEL_RATIO / QUALITY_SCALE);
  
  initialScale = Math.min(scaleX, scaleY, 1);
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
document.addEventListener('fullscreenchange', async () => {
  const btn = document.getElementById('fullscreenBtn');
  if (document.fullscreenElement) {
    btn.textContent = '⛶ Quitter plein écran';
  } else {
    btn.textContent = '⛶ Plein écran';
    // Ré-adapter après sortie plein écran
    setTimeout(() => fitPage(), 100);
  }
});

/**
 * Configurer les event listeners pour le pan et zoom
 */
function setupEventListeners() {
  canvas.addEventListener('mousedown', startPan);
  canvas.addEventListener('mousemove', updatePan);
  canvas.addEventListener('mouseup', endPan);
  canvas.addEventListener('mouseleave', endPan);

  // Wheel zoom avec Ctrl
  canvas.addEventListener('wheel', handleWheel, { passive: false });

  // Redimensionnement de fenêtre
  window.addEventListener('resize', () => {
    if (pdfDoc && zoomLevel === 1) {
      setTimeout(() => fitPage(), 100);
    }
  });
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
 * Appliquer le décalage de pan
 */
function applyPanOffset() {
  if (!canvasWrapper) return;

  // Limiter le pan pour ne pas aller trop loin
  const maxOffsetX = Math.max(0, (canvasWrapper.offsetWidth - container.clientWidth) / 2);
  const maxOffsetY = Math.max(0, (canvasWrapper.offsetHeight - container.clientHeight) / 2);

  panOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, panOffsetX));
  panOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, panOffsetY));

  canvasWrapper.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px)`;
}

/**
 * Gérer le zoom à la molette (Ctrl+Molette)
 */
async function handleWheel(e) {
  // Zoom seulement avec Ctrl
  if (!e.ctrlKey) return;
  
  e.preventDefault();

  const delta = e.deltaY > 0 ? -0.2 : 0.2;
  const oldZoom = zoomLevel;
  zoomLevel = Math.max(0.5, Math.min(zoomLevel + delta, 5));

  if (oldZoom !== zoomLevel) {
    await renderPage(currentPage);
  }
}
