/**
 * Système de rappels par email pour la saisie des indicateurs
 * Utilise EmailJS (https://www.emailjs.com/) pour l'envoi depuis le frontend
 *
 * Fonctionnement :
 * - Vérifie automatiquement au chargement du dashboard (direction uniquement)
 * - Indicateurs hebdomadaires (ex: GM) : 1er rappel le lundi suivant + relance 2 jours après
 * - Indicateurs mensuels (ex: CBCO) : 1er rappel le 1er du mois suivant + relance 2 jours après
 * - Chaque indicateur a sa récurrence configurable (hebdomadaire ou mensuel)
 */

const Reminders = {
  STORAGE_KEY_CONFIG: 'goudalle_reminder_config',
  STORAGE_KEY_SENT: 'goudalle_reminders_sent',

  MOIS_FR: ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
            'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],

  // Définition des indicateurs disponibles
  INDICATORS: {
    gm: {
      id: 'gm',
      label: 'Goudalle Maçonnerie (GM)',
      referentRole: 'referent',
      saisiePage: 'gm-saisie.html'
    },
    cbco: {
      id: 'cbco',
      label: 'CBCO (Chiffre d\'Affaires)',
      referentRole: 'referent_cbco',
      saisiePage: 'cbco-saisie.html'
    }
  },

  // ============ CONFIGURATION ============

  getDefaultConfig() {
    return {
      enabled: false,
      siteUrl: '',
      emailjsServiceId: '',
      emailjsTemplateId: '',
      emailjsPublicKey: '',
      // Récurrence par indicateur : 'hebdomadaire' ou 'mensuel'
      indicators: {
        gm: { recurrence: 'hebdomadaire' },
        cbco: { recurrence: 'mensuel' }
      }
    };
  },

  getConfig() {
    const stored = localStorage.getItem(this.STORAGE_KEY_CONFIG);
    if (!stored) return this.getDefaultConfig();
    const parsed = JSON.parse(stored);
    const defaults = this.getDefaultConfig();
    // Fusionner en préservant les indicateurs
    return {
      ...defaults,
      ...parsed,
      indicators: {
        ...defaults.indicators,
        ...(parsed.indicators || {})
      }
    };
  },

  saveConfig(config) {
    localStorage.setItem(this.STORAGE_KEY_CONFIG, JSON.stringify(config));
  },

  // ============ HISTORIQUE DES ENVOIS ============

  getSentReminders() {
    const stored = localStorage.getItem(this.STORAGE_KEY_SENT);
    return stored ? JSON.parse(stored) : [];
  },

  recordSentReminder(entry) {
    const sent = this.getSentReminders();
    sent.push({ ...entry, sentAt: new Date().toISOString() });
    if (sent.length > 500) sent.splice(0, sent.length - 500);
    localStorage.setItem(this.STORAGE_KEY_SENT, JSON.stringify(sent));
  },

  wasAlreadySent(type, period, year, username) {
    return this.getSentReminders().some(r =>
      r.type === type && r.period === period && r.year === year && r.sentTo === username
    );
  },

  // ============ VÉRIFICATION DES DONNÉES ============

  hasGMData(week, year) {
    const kpis = getKPIs();
    return kpis.some(k => k.week === week && k.year === year);
  },

  hasCBCOData(month, year) {
    const data = getCBCOData();
    return data.some(d => d.month === month && d.year === year &&
      (d.montantChantiersCours > 0 || d.montantChantiersTermines > 0));
  },

  /**
   * Vérifie si les données existent pour un indicateur donné et une période
   */
  hasData(indicatorId, period, year) {
    if (indicatorId === 'gm') return this.hasGMData(period, year);
    if (indicatorId === 'cbco') return this.hasCBCOData(period, year);
    return true;
  },

  // ============ ENVOI D'EMAIL ============

  async sendEmail(config, toEmail, toName, subject, message) {
    if (!window.emailjs) {
      console.warn('EmailJS SDK non chargé');
      return false;
    }
    try {
      await emailjs.send(config.emailjsServiceId, config.emailjsTemplateId, {
        to_email: toEmail,
        to_name: toName,
        subject: subject,
        message: message
      }, config.emailjsPublicKey);
      return true;
    } catch (err) {
      console.error('Erreur EmailJS:', err);
      return false;
    }
  },

  // ============ LOGIQUE DE RAPPELS ============

  /**
   * Pour un indicateur hebdomadaire :
   * - 1er rappel : lundi de la semaine suivante (la semaine à vérifier = semaine précédente)
   * - Relance : mercredi (2 jours après) si toujours pas rempli
   *
   * Pour un indicateur mensuel :
   * - 1er rappel : le 1er du mois suivant (le mois à vérifier = mois précédent)
   * - Relance : le 3 du mois (2 jours après) si toujours pas rempli
   */
  async checkAndSendReminders() {
    const config = this.getConfig();
    if (!config.enabled) return [];
    if (!config.emailjsServiceId || !config.emailjsTemplateId || !config.emailjsPublicKey) return [];

    const today = new Date();
    const todayDay = today.getDay(); // 0=Dim..6=Sam
    const todayDate = today.getDate();
    const results = [];
    const users = Auth.getAllUsers();
    const baseUrl = (config.siteUrl || '').replace(/\/+$/, '');

    // Parcourir chaque indicateur configuré
    for (const [indId, indConfig] of Object.entries(config.indicators)) {
      const indicator = this.INDICATORS[indId];
      if (!indicator) continue;

      const recurrence = indConfig.recurrence;
      const saisieLink = baseUrl ? `${baseUrl}/pages/${indicator.saisiePage}` : '';

      if (recurrence === 'hebdomadaire') {
        // 1er rappel = lundi (jour 1), relance = mercredi (jour 3)
        const isRappel = todayDay === 1;
        const isRelance = todayDay === 3;

        if (isRappel || isRelance) {
          const week = getCurrentWeek();
          const year = getCurrentYear();
          // Vérifier la semaine précédente
          const checkWeek = week === 1 ? 52 : week - 1;
          const checkYear = week === 1 ? year - 1 : year;
          const type = isRappel ? `${indId}_rappel` : `${indId}_relance`;

          if (!this.hasData(indId, checkWeek, checkYear)) {
            const referents = Object.values(users).filter(u =>
              u.isActive && u.role === indicator.referentRole && u.email
            );
            const linkHtml = saisieLink ? `\n\n👉 Saisir maintenant : ${saisieLink}` : '';
            const sLabel = `S${String(checkWeek).padStart(2, '0')}/${checkYear}`;

            for (const user of referents) {
              if (this.wasAlreadySent(type, checkWeek, checkYear, user.username)) continue;

              const subject = isRappel
                ? `⏰ Rappel : Saisie ${indicator.label} – ${sLabel}`
                : `🚨 Relance : ${indicator.label} non saisi – ${sLabel}`;

              const message = isRappel
                ? `Bonjour ${user.displayName},\n\nLes données ${indicator.label} de la semaine ${checkWeek} (${checkYear}) n'ont pas encore été saisies.\n\nMerci de vous connecter pour effectuer la saisie.${linkHtml}\n\nCordialement,\nIntranet Goudalle`
                : `Bonjour ${user.displayName},\n\n⚠️ Les données ${indicator.label} de la semaine ${checkWeek} (${checkYear}) n'ont toujours pas été saisies.\n\nMerci de régulariser la situation dès que possible.${linkHtml}\n\nCordialement,\nIntranet Goudalle`;

              const sent = await this.sendEmail(config, user.email, user.displayName, subject, message);
              if (sent) {
                this.recordSentReminder({ type, period: checkWeek, year: checkYear, sentTo: user.username });
                Auth.audit('REMINDER_SENT', `${type} → ${user.displayName} (${user.email}) – ${sLabel}`);
                results.push({ type, user: user.displayName, indicator: indicator.label });
              }
            }
          }
        }

      } else if (recurrence === 'mensuel') {
        // 1er rappel = le 1er du mois, relance = le 3 du mois
        const isRappel = todayDate === 1;
        const isRelance = todayDate === 3;

        if (isRappel || isRelance) {
          const type = isRappel ? `${indId}_rappel` : `${indId}_relance`;
          // Vérifier le mois précédent
          const prevMonth = today.getMonth() === 0 ? 12 : today.getMonth();
          const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

          if (!this.hasData(indId, prevMonth, prevYear)) {
            const referents = Object.values(users).filter(u =>
              u.isActive && u.role === indicator.referentRole && u.email
            );
            const prevMonthName = this.MOIS_FR[prevMonth];
            const linkHtml = saisieLink ? `\n\n👉 Saisir maintenant : ${saisieLink}` : '';
            const periodLabel = `${prevMonthName} ${prevYear}`;

            for (const user of referents) {
              if (this.wasAlreadySent(type, prevMonth, prevYear, user.username)) continue;

              const subject = isRappel
                ? `⏰ Rappel : Saisie ${indicator.label} – ${periodLabel}`
                : `🚨 Relance : ${indicator.label} non saisi – ${periodLabel}`;

              const message = isRappel
                ? `Bonjour ${user.displayName},\n\nLes données ${indicator.label} pour ${periodLabel} n'ont pas encore été saisies.\n\nMerci de vous connecter pour effectuer la saisie.${linkHtml}\n\nCordialement,\nIntranet Goudalle`
                : `Bonjour ${user.displayName},\n\n⚠️ Les données ${indicator.label} pour ${periodLabel} n'ont toujours pas été saisies.\n\nMerci de régulariser la situation dès que possible.${linkHtml}\n\nCordialement,\nIntranet Goudalle`;

              const sent = await this.sendEmail(config, user.email, user.displayName, subject, message);
              if (sent) {
                this.recordSentReminder({ type, period: prevMonth, year: prevYear, sentTo: user.username });
                Auth.audit('REMINDER_SENT', `${type} → ${user.displayName} (${user.email}) – ${periodLabel}`);
                results.push({ type, user: user.displayName, indicator: indicator.label });
              }
            }
          }
        }
      }
    }

    return results;
  },

  // ============ TEST ============

  async sendTestEmail() {
    const config = this.getConfig();
    if (!config.emailjsServiceId || !config.emailjsTemplateId || !config.emailjsPublicKey) {
      return { success: false, message: '❌ Configuration EmailJS incomplète' };
    }

    const session = Auth.getSession();
    if (!session || !session.email) {
      return { success: false, message: '❌ Aucun email associé à votre compte' };
    }

    const baseUrl = (config.siteUrl || '').replace(/\/+$/, '');
    const links = Object.values(this.INDICATORS).map(ind =>
      baseUrl ? `\n👉 ${ind.label} : ${baseUrl}/pages/${ind.saisiePage}` : ''
    ).join('');

    const sent = await this.sendEmail(
      config,
      session.email,
      session.displayName,
      '✅ Test Rappels – Intranet Goudalle',
      `Bonjour ${session.displayName},\n\nCeci est un email de test du système de rappels de l'Intranet Goudalle.\n\nSi vous recevez cet email, la configuration est correcte !${links}\n\nCordialement,\nIntranet Goudalle`
    );

    return sent
      ? { success: true, message: `✅ Email de test envoyé à ${session.email}` }
      : { success: false, message: '❌ Erreur lors de l\'envoi. Vérifiez la configuration EmailJS.' };
  },

  async sendTestToAll() {
    const config = this.getConfig();
    if (!config.emailjsServiceId || !config.emailjsTemplateId || !config.emailjsPublicKey) {
      return { success: false, message: '❌ Configuration EmailJS incomplète' };
    }

    const users = Auth.getAllUsers();
    const baseUrl = (config.siteUrl || '').replace(/\/+$/, '');
    const allRoles = new Set(Object.values(this.INDICATORS).map(i => i.referentRole));
    const referents = Object.values(users).filter(u =>
      u.isActive && allRoles.has(u.role) && u.email
    );

    if (referents.length === 0) {
      return { success: false, message: '❌ Aucun référent actif avec email trouvé' };
    }

    let sent = 0;
    let failed = 0;
    const details = [];

    for (const user of referents) {
      const userIndicator = Object.values(this.INDICATORS).find(i => i.referentRole === user.role);
      const link = baseUrl && userIndicator
        ? `\n\n👉 Accéder à la saisie : ${baseUrl}/pages/${userIndicator.saisiePage}`
        : '';

      const ok = await this.sendEmail(
        config,
        user.email,
        user.displayName,
        '✅ Test Rappels – Intranet Goudalle',
        `Bonjour ${user.displayName},\n\nCeci est un email de test du système de rappels.\n\nVous recevrez des rappels pour la saisie de vos indicateurs ${userIndicator ? userIndicator.label : ''}.${link}\n\nCordialement,\nIntranet Goudalle`
      );

      if (ok) {
        sent++;
        details.push(`✅ ${user.displayName}`);
      } else {
        failed++;
        details.push(`❌ ${user.displayName}`);
      }
    }

    const message = `${sent} envoyé(s), ${failed} échec(s) sur ${referents.length} référent(s) :\n${details.join('\n')}`;
    return { success: failed === 0, message };
  },

  // ============ STATUS ============

  getReminderStatus() {
    const today = new Date();
    const week = getCurrentWeek();
    const year = getCurrentYear();
    const users = Auth.getAllUsers();
    const config = this.getConfig();

    const prevMonth = today.getMonth() === 0 ? 12 : today.getMonth();
    const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

    const status = {};

    for (const [indId, indDef] of Object.entries(this.INDICATORS)) {
      const recurrence = (config.indicators[indId] || {}).recurrence || 'hebdomadaire';
      const referents = Object.values(users).filter(u => u.isActive && u.role === indDef.referentRole);

      let period, periodLabel, missing = 0, missingUsers = [];

      if (recurrence === 'hebdomadaire') {
        period = week;
        periodLabel = `S${String(week).padStart(2, '0')}/${year}`;
        if (!this.hasData(indId, week, year)) {
          missing = referents.length;
          missingUsers = referents.map(u => u.displayName);
        }
      } else {
        period = prevMonth;
        periodLabel = `${this.MOIS_FR[prevMonth]} ${prevYear}`;
        if (!this.hasData(indId, prevMonth, prevYear)) {
          missing = referents.length;
          missingUsers = referents.map(u => u.displayName);
        }
      }

      status[indId] = {
        label: indDef.label,
        recurrence,
        periodLabel,
        total: referents.length,
        missing,
        users: missingUsers
      };
    }

    return status;
  }
};
