/**
 * ui.js — Rendu visuel des composants de la Fiche Entreprise CRM
 * (icônes météo, jauge financière, histogramme électrique, commentaires, modales, notifications).
 */

import { escapeHtml, safeUrl } from './utils.js';
import { formatIntFr, formatEuroFr, MONTH_LETTERS } from './enrichment.js';

/* ==================================================================== */
/* 1. Icônes météo SVG                                                   */
/* ==================================================================== */

export function weatherSvg(kind = 'partly-cloudy') {
  switch (kind) {
    case 'sunny':
      return `<svg viewBox="0 0 60 50" width="54" height="45">
        <circle cx="30" cy="25" r="11" fill="#f7b731"/>
        <g stroke="#f7b731" stroke-width="2.6" stroke-linecap="round">
          <line x1="30" y1="6" x2="30" y2="10"/><line x1="30" y1="40" x2="30" y2="44"/>
          <line x1="11" y1="25" x2="15" y2="25"/><line x1="45" y1="25" x2="49" y2="25"/>
          <line x1="16.5" y1="11.5" x2="19.5" y2="14.5"/><line x1="40.5" y1="35.5" x2="43.5" y2="38.5"/>
          <line x1="43.5" y1="11.5" x2="40.5" y2="14.5"/><line x1="19.5" y1="35.5" x2="16.5" y2="38.5"/>
        </g>
      </svg>`;

    case 'clear-night':
      return `<svg viewBox="0 0 60 50" width="54" height="45">
        <path d="M36 10a15 15 0 1010 24A13 13 0 0136 10z" fill="#f59e0b"/>
      </svg>`;

    case 'cloudy':
      return `<svg viewBox="0 0 60 50" width="56" height="46">
        <path d="M18 39h25a9.5 9.5 0 001.2-18.9A13 13 0 0019 17.5 10.5 10.5 0 0018 39z"
              fill="#eef0f3" stroke="#cfd4dc" stroke-width="3.2" stroke-linejoin="round"/>
      </svg>`;

    case 'fog':
      return `<svg viewBox="0 0 60 50" width="56" height="46">
        <path d="M16 30h27a8 8 0 001-15.9A11 11 0 0020 12a9 9 0 00-4 18z"
              fill="#eef0f3" stroke="#cfd4dc" stroke-width="2.8"/>
        <g stroke="#b8c0cc" stroke-width="2.4" stroke-linecap="round">
          <line x1="12" y1="36" x2="48" y2="36"/><line x1="16" y1="42" x2="44" y2="42"/>
        </g>
      </svg>`;

    case 'rain':
      return `<svg viewBox="0 0 60 50" width="56" height="46">
        <path d="M16 32h27a8.5 8.5 0 001-16.9A11.5 11.5 0 0019 13a9.2 9.2 0 00-3 19z"
              fill="#eef0f3" stroke="#cbd2dc" stroke-width="2.8"/>
        <g stroke="#3b82f6" stroke-width="2.4" stroke-linecap="round">
          <line x1="20" y1="37" x2="17.5" y2="43"/><line x1="30" y1="37" x2="27.5" y2="43"/>
          <line x1="40" y1="37" x2="37.5" y2="43"/>
        </g>
      </svg>`;

    case 'snow':
      return `<svg viewBox="0 0 60 50" width="56" height="46">
        <path d="M16 32h27a8.5 8.5 0 001-16.9A11.5 11.5 0 0019 13a9.2 9.2 0 00-3 19z"
              fill="#eef0f3" stroke="#cbd2dc" stroke-width="2.8"/>
        <g fill="#60a5fa">
          <circle cx="20" cy="40" r="2.2"/><circle cx="30" cy="42" r="2.2"/><circle cx="40" cy="40" r="2.2"/>
        </g>
      </svg>`;

    case 'storm':
      return `<svg viewBox="0 0 60 50" width="56" height="46">
        <path d="M16 31h27a8.5 8.5 0 001-16.9A11.5 11.5 0 0019 12a9.2 9.2 0 00-3 19z"
              fill="#e2e8f0" stroke="#94a3b8" stroke-width="2.8"/>
        <path d="M31 30l-5 9h5l-2 8 9-10h-5l3-7z" fill="#f59e0b"/>
      </svg>`;

    case 'partly-cloudy':
    default:
      return `<svg viewBox="0 0 62 50" width="58" height="47">
        <g stroke="#f7b731" stroke-width="2.3" stroke-linecap="round">
          <line x1="41" y1="5" x2="41" y2="8.5"/>
          <line x1="51.5" y1="9.5" x2="49" y2="12"/>
          <line x1="56" y1="20" x2="52.5" y2="20"/>
          <line x1="51.5" y1="30.5" x2="49" y2="28"/>
          <line x1="30.5" y1="9.5" x2="33" y2="12"/>
        </g>
        <circle cx="41" cy="20" r="8.2" fill="#f7b731"/>
        <path d="M15 40h24.5a8.5 8.5 0 001-16.9A11.5 11.5 0 0018 20.5 9.8 9.8 0 0015 40z"
              fill="#ffffff" stroke="#d5d8de" stroke-width="3.6" stroke-linejoin="round"/>
      </svg>`;
  }
}

/* ==================================================================== */
/* 2. Histogramme mensuel d'électricité (J..D)                           */
/* ==================================================================== */

export function renderElectricityChart(container, series = []) {
  if (!container) return;
  const items = series.length === 12
    ? series
    : MONTH_LETTERS.map((letter) => ({ letter, month: letter, kwh: 0, heightPct: 20 }));

  container.innerHTML = items.map((item) => {
    const title = item.kwh ? `${item.month} : ${formatIntFr(item.kwh)} kWh (estimé)` : item.letter;
    const height = Math.max(12, Math.min(100, Number(item.heightPct) || 20));
    return `<div class="elec-bar-col" title="${escapeHtml(title)}">
      <div class="elec-bar-track">
        <span class="elec-bar" style="height:${height}%"></span>
      </div>
      <span class="elec-bar-lbl">${escapeHtml(item.letter)}</span>
    </div>`;
  }).join('');
}

/* ==================================================================== */
/* 3. Logo société & commentaires CRM                                    */
/* ==================================================================== */

export function renderCompanyLogo({ imgEl, fallbackEl, name = '', logoUrl = '' }) {
  const cleanLogo = safeUrl(logoUrl);
  const root = String(name || '')
    .trim()
    .split(/[\s\-_/.,]+/)[0]
    .toLowerCase()
    .slice(0, 10);

  const showFallback = () => {
    if (imgEl) { imgEl.hidden = true; imgEl.removeAttribute('src'); }
    if (fallbackEl) {
      fallbackEl.hidden = false;
      fallbackEl.innerHTML = root
        ? `<span class="co-logo-dot"></span><span>${escapeHtml(root)}</span>`
        : '—';
    }
  };

  if (!cleanLogo || !imgEl) {
    showFallback();
    return;
  }

  imgEl.onerror = showFallback;
  imgEl.onload = () => {
    if (fallbackEl) fallbackEl.hidden = true;
    imgEl.hidden = false;
  };
  imgEl.alt = `Logo ${name}`;
  imgEl.src = cleanLogo;
}

/** Formate un ISO en « 29/07/2026 11:52 ». */
export function formatDateTimeCrm(iso, { withA = false } = {}) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  const d = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  const t = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withA ? `${d} à ${t}` : `${d} ${t}`;
}

export function renderCommentsBox(container, comments = [], { expanded = false } = {}) {
  if (!container) return;
  if (!Array.isArray(comments) || !comments.length) {
    container.innerHTML = '<p class="comment-empty">Aucun commentaire — cliquez sur « Historique commentaires » pour ajouter une note.</p>';
    return;
  }
  const visible = expanded ? comments : comments.slice(0, 1);
  container.innerHTML = visible.map((c) => `
    <div class="comment-item">
      <p class="comment-head"><span class="comment-chevron">›</span>${escapeHtml(formatDateTimeCrm(c.at))} - ${escapeHtml(c.author || 'hellodevis_28')}</p>
      <p class="comment-text">${escapeHtml(c.text || '')}</p>
    </div>
  `).join('');
}

/* ==================================================================== */
/* 4. Liste déroulante des résultats de recherche                        */
/* ==================================================================== */

export function renderResultsDropdown(container, rows = [], selectedSiret = '', onPick = null) {
  if (!container) return;
  container.textContent = '';
  if (!rows.length) {
    container.hidden = true;
    return;
  }

  for (const row of rows) {
    const { etablissement, entreprise } = row;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `result-option${etablissement.siret === selectedSiret ? ' is-selected' : ''}`;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', etablissement.siret === selectedSiret ? 'true' : 'false');

    const title = entreprise.raisonSociale || etablissement.nomAffiche || 'Établissement';
    const statusText = etablissement.estActif ? 'Entreprise active' : 'Fermé';
    const address = [etablissement.voie, [etablissement.codePostal, etablissement.commune].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');

    btn.innerHTML = `
      <span class="result-option-top">
        <span class="result-option-name">${escapeHtml(title)}</span>
        <span class="result-option-badge${etablissement.estActif ? '' : ' is-closed'}">${escapeHtml(statusText)}</span>
      </span>
      <span class="result-option-sub">SIRET ${escapeHtml(etablissement.siret)} · ${escapeHtml(address || 'Adresse non renseignée')}</span>
    `;
    btn.addEventListener('click', () => onPick?.(etablissement.siret));
    container.appendChild(btn);
  }
}

/* ==================================================================== */
/* 5. Contenus de modales (finances, électricité)                        */
/* ==================================================================== */

export function buildFinancialModalHtml(fin, entreprise, etablissement) {
  const financesRows = fin.finances.length
    ? `<table class="modal-table">
        <thead><tr><th>Exercice</th><th>Chiffre d'affaires</th><th>Résultat net</th></tr></thead>
        <tbody>
          ${fin.finances.map((f) => `<tr>
            <td><strong>${escapeHtml(String(f.year))}</strong></td>
            <td>${escapeHtml(f.ca != null ? formatEuroFr(f.ca) : 'Non communiqué')}</td>
            <td>${escapeHtml(f.resultatNet != null ? formatEuroFr(f.resultatNet) : 'Non communiqué')}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="modal-note">Aucun bilan public détaillé n\'est publié par l\'INPI pour cette unité légale (comptes confidentiels ou non déposés).</p>';

  const breakdownRows = fin.breakdown.map((b) => `
    <tr><td>${escapeHtml(b.label)}</td><td>${escapeHtml(b.impact)}</td></tr>
  `).join('');

  const officialLink = safeUrl(etablissement?.sourceUrl || entreprise?.sourceUrl || '');
  return `
    <p><strong>Note estimée : ${fin.score} / 100</strong> — ${escapeHtml(fin.riskLabel)} (Solvabilité : ${escapeHtml(fin.solvency)}, Tendance : ${escapeHtml(fin.trend)} ${escapeHtml(fin.trendArrow)})</p>
    <table class="modal-table">
      <thead><tr><th>Critère analysé</th><th>Évaluation</th></tr></thead>
      <tbody>${breakdownRows}</tbody>
    </table>
    ${financesRows}
    <p class="modal-note">
      Indicateur estimatif calculé à partir des données légales publiques (SIRENE / INPI).
      Il ne remplace pas une cotation officielle Banque de France ou Altares.
      ${officialLink ? `<br><a class="link-blue" href="${escapeHtml(officialLink)}" target="_blank" rel="noopener noreferrer">Consulter la fiche officielle sur l'Annuaire des Entreprises ↗</a>` : ''}
    </p>
  `;
}

export function buildElectricityModalHtml(elec, solar) {
  const rows = elec.monthlySeries.map((m) => `
    <tr>
      <td>${escapeHtml(m.month)}</td>
      <td><strong>${escapeHtml(formatIntFr(m.kwh))} kWh</strong></td>
    </tr>
  `).join('');

  const solarLine = solar?.annualProdKwh
    ? `<p class="modal-note"><strong>Potentiel photovoltaïque associé :</strong> environ <strong>${escapeHtml(formatIntFr(solar.installableKwc))} kWc</strong> installables (~ ${escapeHtml(formatIntFr(solar.annualProdKwh))} kWh/an, gisement ${escapeHtml(formatIntFr(solar.irradiationKwhM2))} kWh/m²/an).</p>`
    : '';

  return `
    <p>
      <strong>${escapeHtml(formatIntFr(elec.monthlyKwh))} kWh / mois</strong>
      (${escapeHtml(formatIntFr(elec.annualKwh))} kWh / an) — secteur <em>${escapeHtml(elec.sectorLabel)}</em>,
      base ~ ${escapeHtml(formatIntFr(elec.surfaceUsedM2))} m² × ${escapeHtml(String(elec.intensityKwhM2))} kWh/m²/an.
    </p>
    <table class="modal-table">
      <thead><tr><th>Mois</th><th>Consommation estimée</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${solarLine}
    <p class="modal-note">Estimation statistique locale : ratio de consommation du secteur (division NAF, kWh/m²/an) × emprise bâtie (IGN BD TOPO, sinon estimée) × profil saisonnier nord/sud — aucune donnée Enedis n'est collectée. À confirmer avec les factures ou le PDL Enedis du client.</p>
  `;
}

/* ==================================================================== */
/* 6. Modale générique & Toasts                                          */
/* ==================================================================== */

let modalCleanup = null;

export function openModal({ title, html = '', wide = false, onMount = null, onClose = null }) {
  const modal = document.getElementById('crm-modal');
  const dialog = document.getElementById('crm-modal-dialog');
  const titleEl = document.getElementById('crm-modal-title');
  const bodyEl = document.getElementById('crm-modal-body');
  if (!modal || !dialog || !titleEl || !bodyEl) return;

  if (modalCleanup) { try { modalCleanup(); } catch { /* ignore */ } modalCleanup = null; }
  titleEl.textContent = title || 'Détail';
  dialog.classList.toggle('is-wide', Boolean(wide));
  bodyEl.innerHTML = html;
  modal.hidden = false;
  modalCleanup = onClose || null;
  onMount?.(bodyEl);
}

export function closeModal() {
  const modal = document.getElementById('crm-modal');
  const bodyEl = document.getElementById('crm-modal-body');
  if (!modal || modal.hidden) return;
  if (modalCleanup) { try { modalCleanup(); } catch { /* ignore */ } modalCleanup = null; }
  modal.hidden = true;
  if (bodyEl) bodyEl.textContent = '';
}

export function toast(message, tone = 'info') {
  const host = document.getElementById('toasts');
  if (!host || !message) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = tone;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => { el.remove(); }, 3200);
}
