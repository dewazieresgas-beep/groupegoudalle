/**
 * INTRANET GOUDALLE - APP.JS
 * Gestion auth, storage, utils, KPI
 * Prototype 100% statique avec localStorage
 */

// ============================================
// CONSTANTS
// ============================================
const STORAGE_KEYS = {
  SESSION: 'intranet_session_v1',
  USERS: 'intranet_users_v1',
  KPI_WEEKLY: 'kpi_gm_weekly_v1',
  KPI_HISTORY: 'kpi_gm_history_v1',
  KPI_THRESHOLDS: 'kpi_gm_thresholds_v1',
  INITIALIZED: 'intranet_initialized_v1'
};

// ============================================
// ISO WEEK UTILITIES
// ============================================
const WeekUtils = {
  /**
   * Retourne la semaine ISO 8601 pour une date donnée
   * @param {Date} date 
   * @returns {{ year: number, week: number }}
   */
  getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
  },

  /**
   * Retourne la semaine passée (semaine ISO précédente)
   * @returns {{ year: number, week: number }}
   */
  getPreviousWeek() {
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);
    return this.getISOWeek(lastWeek);
  },

  /**
   * Retourne la semaine courante
   * @returns {{ year: number, week: number }}
   */
  getCurrentWeek() {
    return this.getISOWeek(new Date());
  },

  /**
   * Formate un numéro de semaine avec un zéro devant si < 10
   * @param {number} week 
   * @returns {string}
   */
  formatWeekNumber(week) {
    return String(week).padStart(2, '0');
  },

  /**
   * Retourne les N dernières semaines publiées
   * @param {number} count 
   * @param {Array} kpiData 
   * @returns {Array}
   */
  getLastNPublishedWeeks(count, kpiData) {
    return kpiData
      .filter(k => k.status === 'published')
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.week - a.week;
      })
      .slice(0, count)
      .reverse();
  }
};

// ============================================
// KPI CALCULATIONS
// ============================================
const KPICalculator = {
  /**
   * Calcule h/m³
   * @param {number} hours 
   * @param {number} m3 
   * @returns {number|null}
   */
  calculateRatio(hours, m3) {
    if (m3 === 0 || m3 === null || m3 === undefined) return null;
    return parseFloat((hours / m3).toFixed(2));
  },

  /**
   * Retourne le smiley selon le ratio et les seuils
   * @param {number|null} ratio 
   * @param {object} thresholds 
   * @returns {string} 'green'|'orange'|'red'|'none'
   */
  getSmiley(ratio, thresholds) {
    if (ratio === null) return 'none';
    if (ratio < thresholds.greenMax) return 'green';
    if (ratio <= thresholds.orangeMax) return 'orange';
    return 'red';
  },

  /**
   * Calcule la moyenne h/m³ pour une liste de KPI
   * @param {Array} kpiList 
   * @returns {number|null}
   */
  calculateAverageRatio(kpiList) {
    const validRatios = kpiList
      .filter(k => k.m3 > 0)
      .map(k => this.calculateRatio(k.hours, k.m3))
      .filter(r => r !== null);
    
    if (validRatios.length === 0) return null;
    const sum = validRatios.reduce((acc, r) => acc + r, 0);
    return parseFloat((sum / validRatios.length).toFixed(2));
  }
};

// ============================================
// STORAGE MANAGER
// ============================================
const StorageManager = {
  /**
   * Initialise les données depuis seed.json si nécessaire
   */
  async initialize() {
    if (localStorage.getItem(STORAGE_KEYS.INITIALIZED)) {
      return; // Déjà initialisé
    }

    try {
      const response = await fetch('./data/seed.json');
      const seedData = await response.json();

      // Importer les utilisateurs
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(seedData.users));
      
      // Importer les KPI
      localStorage.setItem(STORAGE_KEYS.KPI_WEEKLY, JSON.stringify(seedData.kpi_gm_weekly));
      
      // Importer l'historique
      localStorage.setItem(STORAGE_KEYS.KPI_HISTORY, JSON.stringify(seedData.kpi_gm_history));
      
      // Importer les seuils
      localStorage.setItem(STORAGE_KEYS.KPI_THRESHOLDS, JSON.stringify(seedData.kpi_gm_thresholds));
      
      // Marquer comme initialisé
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
      
      console.log('✅ Données initialisées depuis seed.json');
    } catch (error) {
      console.error('❌ Erreur lors de l\'initialisation:', error);
    }
  },

  /**
   * Récupère tous les utilisateurs
   * @returns {Array}
   */
  getUsers() {
    const data = localStorage.getItem(STORAGE_KEYS.USERS);
    return data ? JSON.parse(data) : [];
  },

  /**
   * Récupère tous les KPI hebdomadaires
   * @returns {Array}
   */
  getKPIWeekly() {
    const data = localStorage.getItem(STORAGE_KEYS.KPI_WEEKLY);
    return data ? JSON.parse(data) : [];
  },

  /**
   * Sauvegarde les KPI hebdomadaires
   * @param {Array} kpiData 
   */
  saveKPIWeekly(kpiData) {
    localStorage.setItem(STORAGE_KEYS.KPI_WEEKLY, JSON.stringify(kpiData));
  },

  /**
   * Récupère l'historique
   * @returns {Array}
   */
  getHistory() {
    const data = localStorage.getItem(STORAGE_KEYS.KPI_HISTORY);
    return data ? JSON.parse(data) : [];
  },

  /**
   * Ajoute une entrée dans l'historique
   * @param {object} entry 
   */
  addHistory(entry) {
    const history = this.getHistory();
    history.push(entry);
    localStorage.setItem(STORAGE_KEYS.KPI_HISTORY, JSON.stringify(history));
  },

  /**
   * Récupère les seuils
   * @returns {object}
   */
  getThresholds() {
    const data = localStorage.getItem(STORAGE_KEYS.KPI_THRESHOLDS);
    return data ? JSON.parse(data) : { greenMax: 4.5, orangeMax: 5.5 };
  },

  /**
   * Sauvegarde les seuils
   * @param {object} thresholds 
   */
  saveThresholds(thresholds) {
    localStorage.setItem(STORAGE_KEYS.KPI_THRESHOLDS, JSON.stringify(thresholds));
  },

  /**
   * Récupère un KPI par ID
   * @param {string} id 
   * @returns {object|null}
   */
  getKPIById(id) {
    const kpiData = this.getKPIWeekly();
    return kpiData.find(k => k.id === id) || null;
  },

  /**
   * Crée ou met à jour un KPI
   * @param {object} kpi 
   * @param {string} username 
   */
  saveKPI(kpi, username) {
    const kpiData = this.getKPIWeekly();
    const existingIndex = kpiData.findIndex(k => k.id === kpi.id);

    if (existingIndex >= 0) {
      // Sauvegarde de l'ancien état dans l'historique
      const oldKPI = kpiData[existingIndex];
      this.addHistory({
        id: `hist_${Date.now()}`,
        kpiId: kpi.id,
        changedAt: new Date().toISOString(),
        changedBy: username,
        oldValue: {
          m3: oldKPI.m3,
          hours: oldKPI.hours,
          comment: oldKPI.comment,
          status: oldKPI.status
        },
        newValue: {
          m3: kpi.m3,
          hours: kpi.hours,
          comment: kpi.comment,
          status: kpi.status
        }
      });

      // Mise à jour
      kpiData[existingIndex] = {
        ...kpi,
        updatedAt: new Date().toISOString(),
        updatedBy: username
      };
    } else {
      // Création
      kpiData.push({
        ...kpi,
        createdAt: new Date().toISOString(),
        createdBy: username,
        updatedAt: new Date().toISOString(),
        updatedBy: username
      });
    }

    this.saveKPIWeekly(kpiData);
  },

  /**
   * Publie un KPI (passe de draft à published)
   * @param {string} id 
   * @param {string} username 
   */
  publishKPI(id, username) {
    const kpi = this.getKPIById(id);
    if (!kpi) return;

    kpi.status = 'published';
    this.saveKPI(kpi, username);
  }
};

// ============================================
// AUTHENTICATION
// ============================================
const Auth = {
  /**
   * Connexion utilisateur
   * @param {string} username 
   * @param {string} password 
   * @returns {boolean}
   */
  login(username, password) {
    const users = StorageManager.getUsers();
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
      const session = {
        username: user.username,
        role: user.role,
        access: user.access,
        displayName: user.displayName,
        loginAt: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      return true;
    }
    return false;
  },

  /**
   * Déconnexion
   */
  logout() {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
  },

  /**
   * Récupère la session courante
   * @returns {object|null}
   */
  getSession() {
    const data = localStorage.getItem(STORAGE_KEYS.SESSION);
    return data ? JSON.parse(data) : null;
  },

  /**
   * Vérifie si l'utilisateur est connecté
   * @returns {boolean}
   */
  isAuthenticated() {
    return this.getSession() !== null;
  },

  /**
   * Redirige vers login si non authentifié
   */
  requireAuth() {
    if (!this.isAuthenticated()) {
      window.location.href = './pages/login.html';
    }
  },

  /**
   * Vérifie si l'utilisateur a accès à GM
   * @returns {boolean}
   */
  hasGMAccess() {
    const session = this.getSession();
    if (!session) return false;
    return session.access.includes('all') || session.access.includes('gm');
  },

  /**
   * Vérifie si l'utilisateur est référent GM ou direction
   * @returns {boolean}
   */
  canEditGM() {
    const session = this.getSession();
    if (!session) return false;
    return session.role === 'direction' || session.role === 'gm_referent';
  },

  /**
   * Vérifie si l'utilisateur est en lecture seule
   * @returns {boolean}
   */
  isReadOnly() {
    const session = this.getSession();
    if (!session) return true;
    return session.role === 'gm_lecture';
  }
};

// ============================================
// UI HELPERS
// ============================================
const UI = {
  /**
   * Génère le HTML du menu latéral
   * @returns {string}
   */
  generateSidebar() {
    const session = Auth.getSession();
    const canEditGM = Auth.canEditGM();
    
    return `
      <nav class="sidebar">
        <div class="sidebar-header">
          <h1>Intranet GM</h1>
          <div class="user-badge">
            <span class="user-name">${session.displayName}</span>
            <span class="user-role">${this.getRoleLabel(session.role)}</span>
          </div>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/index.html" class="menu-item">
            <span class="icon">🏠</span> Accueil
          </a></li>
          <li><a href="/pages/gm.html" class="menu-item">
            <span class="icon">🏗️</span> Goudalle Maçonnerie
          </a></li>
          ${canEditGM ? `
          <li><a href="/pages/gm-admin.html" class="menu-item">
            <span class="icon">⚙️</span> GM Référent
          </a></li>
          ` : ''}
          <li><a href="/pages/account.html" class="menu-item">
            <span class="icon">👤</span> Mon compte
          </a></li>
          <li><a href="#" onclick="App.logout(); return false;" class="menu-item logout">
            <span class="icon">🚪</span> Déconnexion
          </a></li>
        </ul>
        <div class="sidebar-footer">
          <div class="prototype-badge">⚠️ Prototype (auth simulée)</div>
        </div>
      </nav>
    `;
  },

  /**
   * Retourne le label d'un rôle
   * @param {string} role 
   * @returns {string}
   */
  getRoleLabel(role) {
    const labels = {
      'direction': 'Direction',
      'gm_referent': 'Référent GM',
      'gm_lecture': 'Lecture seule'
    };
    return labels[role] || role;
  },

  /**
   * Retourne l'emoji du smiley
   * @param {string} smiley 
   * @returns {string}
   */
  getSmileyEmoji(smiley) {
    const emojis = {
      'green': '🟢',
      'orange': '🟠',
      'red': '🔴',
      'none': '⚪'
    };
    return emojis[smiley] || '⚪';
  },

  /**
   * Formate un ratio h/m³
   * @param {number|null} ratio 
   * @returns {string}
   */
  formatRatio(ratio) {
    return ratio !== null ? ratio.toFixed(2) : '—';
  },

  /**
   * Formate un nombre avec 2 décimales
   * @param {number} num 
   * @returns {string}
   */
  formatNumber(num) {
    return num.toFixed(2);
  }
};

// ============================================
// MAIN APP
// ============================================
const App = {
  /**
   * Initialise l'application
   */
  async init() {
    await StorageManager.initialize();
    
    // Active le menu item courant
    this.highlightCurrentPage();
  },

  /**
   * Met en surbrillance l'élément de menu actif
   */
  highlightCurrentPage() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.sidebar-menu .menu-item').forEach(item => {
      const href = item.getAttribute('href');
      if (href === currentPath) {
        item.classList.add('active');
      }
    });
  },

  /**
   * Déconnexion
   */
  logout() {
    Auth.logout();
    window.location.href = './pages/login.html';
  },

  /**
   * Gère la soumission du formulaire de connexion
   * @param {Event} event 
   */
  handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');

    if (Auth.login(username, password)) {
      window.location.href = './index.html';
    } else {
      errorDiv.textContent = 'Nom d\'utilisateur ou mot de passe incorrect';
      errorDiv.style.display = 'block';
    }
  }
};

// Exporter pour usage global
window.App = App;
window.Auth = Auth;
window.StorageManager = StorageManager;
window.WeekUtils = WeekUtils;
window.KPICalculator = KPICalculator;
window.UI = UI;
