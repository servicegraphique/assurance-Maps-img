/**
 * ui.js — Rendu de l'interface (DOM uniquement, aucune requête réseau).
 *
 * Responsabilité : construire et mettre à jour les vues (résultats, fiche,
 * images, paramètres, historique, toasts, modales, lightbox) à partir des
 * données fournies par app.js, et renvoyer les intentions utilisateur via
 * des callbacks. Toute donnée externe est injectée en textContent.
 */

import config from './config.js';
import {
  el, icon, clear, escapeHtml, formatSiren, formatSiret, formatDateFr, formatDateTimeFr,
  formatCoords, formatNumberFr, safeUrl, truncate,
} from './utils.js';
import { nafLabel, nafWithLabel, departementLabel, regionLabel, natureJuridiqueLabel, effectifLabel } from './labels.js';
import { precisionLabel } from './geocoding.js';
import { addressText } from './export.js';
import { osmLink, ignTimeLink } from './map.js';
import { frameAttributes, describeImmersion } from './streetview.js';
import { CONTACT_FIELDS, CONTACT_LIMITS, contactChannels } from './contact.js';

/* ==================================================================== */
/* 1. Notifications                                                      */
/* ==================================================================== */

export function toast(message, type = 'info', duration = 3800) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const icons = { success: 'check', error: 'alert', warning: 'alert', info: 'info' };
  const node = el('div', { class: `toast toast-${type}`, role: 'status' }, [icon(icons[type] || 'info'), el('span', { text: message })]);
  host.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, duration);
}

/* ==================================================================== */
/* 2. Briques réutilisables                                              */
/* ==================================================================== */

export function statusBadge(etablissement) {
  if (etablissement.etatAdministratif === 'A') return el('span', { class: 'badge badge-success', text: 'Actif' });
  if (etablissement.etatAdministratif === 'C') return el('span', { class: 'badge badge-danger', text: 'Fermé' });
  return el('span', { class: 'badge badge-neutral', text: 'État inconnu' });
}

function copyButton(value, label, onCopy) {
  return el('button', {
    type: 'button',
    class: 'copy-btn',
    title: `Copier ${label}`,
    'aria-label': `Copier ${label}`,
    onclick: (event) => { event.stopPropagation(); onCopy?.(value, label); },
  }, [icon('copy')]);
}

function infoItem(label, value, options = {}) {
  const { source = '', copy = null, mono = false, wide = false, onCopy = null } = options;
  const item = el('div', { class: `info-item${wide ? ' is-wide' : ''}` });
  item.append(el('p', { class: 'info-label', text: label }));
  const valueNode = el('p', { class: 'info-value' });
  valueNode.append(el('span', { class: mono ? 'mono' : '', text: value || '—' }));
  if (copy && value) valueNode.append(copyButton(copy, label, onCopy));
  item.append(valueNode);
  if (source) item.append(el('p', { class: 'info-source', text: `Source : ${source}` }));
  return item;
}

/** État vide de la liste de résultats (élément de liste, pour rester valide). */
export function emptyState({ title, message, iconName = 'info', action = null }) {
  return el('li', { class: 'empty-state' }, [
    icon(iconName),
    el('h3', { text: title }),
    el('p', { text: message }),
    action,
  ]);
}

function mediaEmpty({ title, message, iconName = 'image', action = null }) {
  return el('div', { class: 'media-empty' }, [
    icon(iconName),
    el('h4', { text: title }),
    el('p', { text: message }),
    action,
  ]);
}

function sectionTitle(text, iconName) {
  return el('h3', {}, [icon(iconName), text]);
}

function externalLink(href, label, iconName = 'external') {
  const url = safeUrl(href);
  if (!url) return el('span', { class: 'muted-xs', text: `${label} (indisponible)` });
  return el('a', {
    class: 'btn btn-sm btn-outline', href: url, target: '_blank', rel: 'noopener noreferrer',
  }, [icon(iconName), label]);
}

/* ==================================================================== */
/* 3. Résultats                                                          */
/* ==================================================================== */

export function renderResultsSkeleton(container, count = 5) {
  clear(container);
  const wrap = el('div', { class: 'skeleton', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i += 1) wrap.append(el('div', { class: 'skeleton-row' }));
  container.append(el('li', {}, [wrap]));
}

export function renderResults(container, { rows, selectedSiret, onSelect, handlers }) {
  clear(container);
  rows.forEach((row, index) => {
    const { etablissement, entreprise } = row;
    const item = el('li', {
      class: `result-item${etablissement.siret === selectedSiret ? ' is-selected' : ''}`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${etablissement.nomAffiche}, ${etablissement.commune || 'commune inconnue'}`,
      dataset: { siret: etablissement.siret },
      onclick: () => onSelect(etablissement.siret),
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(etablissement.siret);
        }
      },
    });

    const top = el('div', { class: 'result-top' });
    const titles = el('div', {});
    titles.append(el('p', { class: 'result-name', text: etablissement.nomAffiche }));
    if (entreprise.raisonSociale && entreprise.raisonSociale !== etablissement.nomAffiche) {
      titles.append(el('p', { class: 'result-company', text: `Société : ${entreprise.raisonSociale}` }));
    }
    top.append(titles);
    top.append(el('span', { class: 'badge badge-neutral', text: String(index + 1) }));
    item.append(top);

    item.append(el('p', { class: 'result-addr' }, [
      icon('pin'),
      el('span', { text: etablissement.adresse || `${etablissement.codePostal} ${etablissement.commune}`.trim() || 'Adresse non publiée' }),
    ]));

    const meta = el('div', { class: 'result-meta' });
    meta.append(statusBadge(etablissement));
    if (etablissement.estSiege) meta.append(el('span', { class: 'badge badge-accent', text: 'Siège' }));
    else meta.append(el('span', { class: 'badge badge-neutral', text: 'Établissement' }));
    if (etablissement.naf) meta.append(el('span', { class: 'badge badge-primary', text: etablissement.naf, title: nafLabel(etablissement.naf) }));
    if (entreprise.nombreEtablissements > 1) {
      meta.append(el('span', {
        class: 'badge badge-neutral',
        text: `${formatNumberFr(entreprise.nombreEtablissements)} sites`,
        title: 'Nombre d\'établissements de cette société',
      }));
    }
    meta.append(el('span', { class: 'mono', text: `SIRET ${formatSiret(etablissement.siret)}` }));
    item.append(meta);

    const actions = el('div', { class: 'result-actions' });
    actions.append(el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline',
      onclick: (event) => { event.stopPropagation(); onSelect(etablissement.siret); },
    }, [icon('file'), 'Consulter la fiche']));
    if (Number.isFinite(etablissement.latitude)) {
      actions.append(el('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        title: 'Copier les coordonnées SIRENE',
        onclick: (event) => {
          event.stopPropagation();
          handlers?.onCopy?.(formatCoords(etablissement.latitude, etablissement.longitude), 'les coordonnées GPS');
        },
      }, [icon('copy'), 'GPS']));
    }
    item.append(actions);
    container.append(item);
  });
}

export function renderNotices(container, notices) {
  clear(container);
  if (!notices?.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const wrap = el('div', {});
  notices.forEach((notice) => {
    wrap.append(el('div', { class: `notice notice-${notice.type}`, style: 'margin:0 0 8px' }, [
      icon(notice.type === 'error' ? 'alert' : (notice.type === 'warning' ? 'alert' : 'info')),
      el('span', { text: notice.text }),
    ]));
  });
  container.append(wrap);
}

export function renderPagination(container, { page, totalPages, onPage }) {
  clear(container);
  if (!totalPages || totalPages <= 1) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.append(el('button', {
    type: 'button', class: 'btn btn-sm btn-outline', disabled: page <= 1,
    onclick: () => onPage(page - 1),
  }, [icon('chevron-left'), 'Précédent']));
  container.append(el('span', { class: 'page-info', text: `Page ${page} sur ${totalPages}` }));
  container.append(el('button', {
    type: 'button', class: 'btn btn-sm btn-outline', disabled: page >= totalPages,
    onclick: () => onPage(page + 1),
  }, ['Suivant', icon('chevron-right')]));
}

/* ==================================================================== */
/* 4. Fiche détaillée                                                    */
/* ==================================================================== */

/** Références vers les zones mises à jour dynamiquement. */
export const detailRefs = {};

const TABS = [
  { key: 'fiche', label: 'Informations', icon: 'building' },
  { key: 'images', label: 'Images', icon: 'camera' },
  { key: 'etablissements', label: 'Établissements', icon: 'list' },
  { key: 'sources', label: 'Sources', icon: 'link' },
];

export function renderDetail(container, fiche, handlers) {
  const { etablissement: e, entreprise: c } = fiche.row;
  clear(container);
  container.hidden = false;

  /* --- En-tête ------------------------------------------------------- */
  const head = el('div', { class: 'detail-head' });
  const titleRow = el('div', { class: 'detail-title-row' });
  const titleBlock = el('div', {});
  titleBlock.append(el('h2', { class: 'detail-title', id: 'titre-fiche', text: e.nomAffiche }));
  titleBlock.append(el('p', {
    class: 'detail-sub',
    text: [c.raisonSociale !== e.nomAffiche ? c.raisonSociale : '', `SIREN ${formatSiren(c.siren)}`, e.estSiege ? 'Siège social' : 'Établissement']
      .filter(Boolean).join(' · '),
  }));
  titleRow.append(titleBlock);
  titleRow.append(el('button', {
    type: 'button',
    class: `icon-btn${fiche.isFavorite ? ' is-active' : ''}`,
    title: fiche.isFavorite ? 'Retirer des fiches enregistrées' : 'Enregistrer cette fiche',
    'aria-label': fiche.isFavorite ? 'Retirer des fiches enregistrées' : 'Enregistrer cette fiche',
    onclick: () => handlers.onToggleFavorite?.(),
  }, [icon('star')]));
  head.append(titleRow);

  const badges = el('div', { class: 'detail-badges' });
  badges.append(statusBadge(e));
  if (e.estSiege) badges.append(el('span', { class: 'badge badge-accent', text: 'Siège social' }));
  if (e.naf) badges.append(el('span', { class: 'badge badge-primary', text: truncate(nafWithLabel(e.naf), 70) }));
  if (e.commune) badges.append(el('span', { class: 'badge badge-neutral', text: `${e.codePostal} ${e.commune}` }));
  if (c.categorie) badges.append(el('span', { class: 'badge badge-neutral', text: c.categorie }));
  if (e.nonDiffusible) badges.append(el('span', { class: 'badge badge-warning', text: 'Non diffusible' }));
  head.append(badges);

  const actions = el('div', { class: 'detail-actions' });
  actions.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onCopyAddress?.() }, [icon('copy'), 'Copier l\'adresse']));
  actions.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onCopySiret?.() }, [icon('copy'), 'Copier le SIRET']));
  actions.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onExportFiche?.() }, [icon('download'), 'Exporter la fiche']));
  const osmSlot = el('span', { id: 'detail-osm-slot' });
  actions.append(osmSlot);
  actions.append(externalLink(e.sourceUrl, 'Fiche officielle', 'external'));
  head.append(actions);
  container.append(head);

  /* --- Onglets ------------------------------------------------------- */
  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  TABS.forEach((tab) => {
    tabs.append(el('button', {
      type: 'button',
      class: `tab-btn${tab.key === (fiche.activeTab || 'fiche') ? ' is-active' : ''}`,
      role: 'tab',
      'aria-selected': String(tab.key === (fiche.activeTab || 'fiche')),
      dataset: { tab: tab.key },
      onclick: () => handlers.onTabChange?.(tab.key),
    }, [icon(tab.icon), tab.label]));
  });
  container.append(tabs);

  const panels = {};
  TABS.forEach((tab) => {
    const panel = el('div', {
      class: 'tab-panel', role: 'tabpanel', dataset: { panel: tab.key },
      hidden: tab.key !== (fiche.activeTab || 'fiche'),
    });
    panels[tab.key] = panel;
    container.append(panel);
  });

  /* --- Panneau 1 : informations -------------------------------------- */
  const info = panels.fiche;

  const admin = el('div', { class: 'info-section' }, [sectionTitle('Informations administratives', 'building')]);
  const adminGrid = el('div', { class: 'info-grid' });
  adminGrid.append(infoItem('Raison sociale', c.raisonSociale || c.nomComplet, { source: 'API Recherche d\'entreprises', wide: true }));
  if (c.sigle) adminGrid.append(infoItem('Sigle', c.sigle, { source: 'API Recherche d\'entreprises' }));
  adminGrid.append(infoItem('Nom commercial', e.nomCommercial || '—', { source: 'SIRENE' }));
  adminGrid.append(infoItem('Enseignes', e.enseignes.join(' · ') || '—', { source: 'SIRENE' }));
  adminGrid.append(infoItem('SIREN', formatSiren(c.siren), { source: 'INSEE / SIRENE', mono: true, copy: c.siren, onCopy: handlers.onCopyValue }));
  adminGrid.append(infoItem('SIRET', formatSiret(e.siret), { source: 'INSEE / SIRENE', mono: true, copy: e.siret, onCopy: handlers.onCopyValue }));
  adminGrid.append(infoItem('État administratif de l\'établissement', e.estActif ? 'Actif' : (e.etatAdministratif === 'C' ? 'Fermé' : 'Inconnu'), { source: 'SIRENE' }));
  adminGrid.append(infoItem('État de l\'unité légale', c.estActif ? 'Active' : (c.etatAdministratif === 'C' ? 'Cessée' : 'Inconnu'), { source: 'SIRENE' }));
  adminGrid.append(infoItem('Code NAF/APE', e.naf || '—', { source: 'INSEE', mono: true }));
  adminGrid.append(infoItem('Activité', nafLabel(e.naf) || '—', { source: 'Nomenclature NAF rév. 2', wide: true }));
  adminGrid.append(infoItem('Forme juridique', natureJuridiqueLabel(c.natureJuridique) || c.natureJuridique || '—', { source: 'INSEE, catégories juridiques' }));
  adminGrid.append(infoItem('Date de création (établissement)', formatDateFr(e.dateCreation) || '—', { source: 'SIRENE' }));
  if (e.dateFermeture) adminGrid.append(infoItem('Date de fermeture', formatDateFr(e.dateFermeture), { source: 'SIRENE' }));
  adminGrid.append(infoItem('Effectif de la société', effectifLabel(c.trancheEffectif) || '—', { source: `SIRENE${c.anneeEffectif ? ` (${c.anneeEffectif})` : ''}` }));
  adminGrid.append(infoItem('Établissements de la société', `${formatNumberFr(c.nombreEtablissements)} dont ${formatNumberFr(c.nombreEtablissementsOuverts)} ouvert(s)`, { source: 'API Recherche d\'entreprises' }));
  admin.append(adminGrid);
  info.append(admin);

  const geo = el('div', { class: 'info-section' }, [sectionTitle('Informations géographiques', 'pin')]);
  const geoGrid = el('div', { class: 'info-grid' });
  geoGrid.append(infoItem('Adresse complète', e.adresse || 'Non publiée', { source: 'SIRENE', wide: true, copy: addressText(e), onCopy: handlers.onCopyValue }));
  geoGrid.append(infoItem('Numéro et voie', e.voie || '—', { source: 'SIRENE' }));
  geoGrid.append(infoItem('Complément / distribution', e.complementAdresse || e.distributionSpeciale || '—', { source: 'SIRENE' }));
  geoGrid.append(infoItem('Code postal', e.codePostal || '—', { source: 'SIRENE', mono: true }));
  geoGrid.append(infoItem('Ville', e.commune || '—', { source: 'SIRENE' }));
  geoGrid.append(infoItem('Code commune INSEE', e.codeCommune || '—', { source: 'COG / INSEE', mono: true }));
  geoGrid.append(infoItem('Département', e.departement ? `${e.departement} — ${departementLabel(e.departement) || '—'}` : '—', { source: 'COG / INSEE' }));
  geoGrid.append(infoItem('Région', regionLabel(e.region) || '—', { source: 'COG / INSEE' }));
  geoGrid.append(infoItem('Pays', e.pays || 'France', { source: 'SIRENE' }));
  geo.append(geoGrid);
  info.append(geo);

  const contactsSection = el('div', { class: 'info-section', id: 'contacts-section' });
  info.append(contactsSection);

  const gpsSection = el('div', { class: 'info-section', id: 'gps-section' });
  info.append(gpsSection);
  detailRefs.gpsSection = gpsSection;
  detailRefs.contactsSection = contactsSection;
  detailRefs.osmSlot = osmSlot;
  detailRefs.panels = panels;
  detailRefs.container = container;
  detailRefs.tabs = tabs;

  /* --- Panneau 2 : images -------------------------------------------- */
  const images = panels.images;

  const aerial = el('div', { class: 'media-block' });
  aerial.append(el('div', { class: 'media-head' }, [
    el('h3', {}, [icon('satellite'), 'A. Vue aérienne — photographie IGN BD ORTHO®']),
    el('span', { class: 'media-note', text: 'Orthophotographie réelle, pas un plan.' }),
  ]));
  const aerialHost = el('div', { id: 'aerial-host' });
  aerial.append(aerialHost);
  images.append(aerial);
  detailRefs.aerialHost = aerialHost;

  const street = el('div', { class: 'media-block' });
  street.append(el('div', { class: 'media-head' }, [
    el('h3', {}, [icon('camera'), 'B. Photographies de rue']),
    el('div', { class: 'aerial-actions', id: 'street-actions' }),
  ]));
  const streetHost = el('div', { id: 'street-host' });
  street.append(streetHost);
  images.append(street);
  detailRefs.streetHost = streetHost;
  detailRefs.streetActions = street.querySelector('#street-actions');

  const complementary = el('div', { class: 'media-block' });
  complementary.append(el('div', { class: 'media-head' }, [
    el('h3', {}, [icon('image'), 'C. Photographies complémentaires']),
    el('span', { class: 'media-note', text: 'Uniquement des images dont la source est identifiée.' }),
  ]));
  const complementaryHost = el('div', { id: 'complementary-host' });
  complementary.append(complementaryHost);
  images.append(complementary);
  detailRefs.complementaryHost = complementaryHost;

  const immersive = el('div', { class: 'media-block' });
  immersive.append(el('div', { class: 'media-head' }, [
    el('h3', {}, [icon('expand'), 'D. Vue immersive — Street View 360°']),
    el('span', { class: 'media-note', text: 'Chargée uniquement à votre demande.' }),
  ]));
  const streetviewHost = el('div', { id: 'streetview-host' });
  immersive.append(streetviewHost);
  images.append(immersive);
  detailRefs.streetviewHost = streetviewHost;

  /* --- Panneau 3 : établissements ------------------------------------ */
  const etabPanel = panels.etablissements;
  etabPanel.append(el('div', { class: 'media-head' }, [
    el('h3', {}, [icon('list'), `Établissements de ${c.raisonSociale || c.nomComplet}`]),
    el('span', { class: 'media-note', text: `${formatNumberFr(c.nombreEtablissements)} site(s) déclaré(s), dont ${formatNumberFr(c.nombreEtablissementsOuverts)} ouvert(s).` }),
  ]));
  const etabHost = el('div', { id: 'etab-host' });
  etabPanel.append(etabHost);
  detailRefs.etabHost = etabHost;

  /* --- Panneau 4 : sources ------------------------------------------- */
  panels.sources.append(renderSources(fiche));

  updateOsmSlot(fiche.position);
  return detailRefs;
}

export function updateOsmSlot(position) {
  if (!detailRefs.osmSlot) return;
  clear(detailRefs.osmSlot);
  detailRefs.osmSlot.append(position
    ? externalLink(osmLink(position.lat, position.lon), 'Ouvrir dans OpenStreetMap', 'pin')
    : el('span', { class: 'btn btn-sm btn-outline', style: 'opacity:.5', title: 'Coordonnées indisponibles' }, [icon('pin'), 'OpenStreetMap']));
}

export function setActiveTab(container, key) {
  container.querySelectorAll('.tab-btn').forEach((button) => {
    const active = button.dataset.tab === key;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  container.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== key;
  });
}

/* ---------------------------- 4a. Bloc GPS -------------------------- */

export function renderGpsSection(fiche, handlers) {
  const host = detailRefs.gpsSection;
  if (!host) return;
  clear(host);
  host.append(sectionTitle('Coordonnées GPS et fiabilité', 'target'));

  if (fiche.positionLoading) {
    host.append(el('p', { class: 'muted', text: 'Géocodage de l\'adresse en cours…' }));
    return;
  }

  if (fiche.positionError) {
    host.append(mediaEmpty({
      iconName: 'alert',
      title: 'Coordonnées GPS indisponibles',
      message: fiche.positionError,
    }));
    return;
  }

  const p = fiche.position;
  if (!p) {
    host.append(mediaEmpty({ iconName: 'pin', title: 'Aucune position', message: 'Sélectionnez un établissement pour calculer sa position.' }));
    return;
  }

  const box = el('div', { class: 'gps-box' });
  box.append(el('div', {}, [
    el('p', { class: 'gps-coords', text: formatCoords(p.lat, p.lon) }),
    el('p', { class: 'gps-meta', text: `Latitude ${p.lat.toFixed(6)} · Longitude ${p.lon.toFixed(6)} (WGS84 / EPSG:4326)` }),
  ]));
  const boxActions = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-left:auto' });
  boxActions.append(el('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => handlers.onCopyGps?.() }, [icon('copy'), 'Copier les coordonnées']));
  boxActions.append(externalLink(osmLink(p.lat, p.lon), 'OpenStreetMap', 'pin'));
  boxActions.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onReverseGeocode?.() }, [icon('target'), 'Vérifier l\'adresse à ce point']));
  box.append(boxActions);
  host.append(box);

  const precisionBadgeClass = p.precision === 'adresse' ? 'badge-success' : (p.precision === 'commune' ? 'badge-danger' : 'badge-warning');
  const line = el('div', { class: 'precision-bar' });
  line.append(el('span', { class: `badge ${precisionBadgeClass}`, text: precisionLabel(p.precision) }));
  line.append(el('span', { class: `badge badge-neutral`, text: `Confiance ${p.confidence}` }));
  if (Number.isFinite(p.score)) line.append(el('span', { class: 'badge badge-neutral', text: `Score BAN ${p.score.toFixed(2)}` }));
  if (p.divergenceM != null) line.append(el('span', { class: 'badge badge-neutral', text: `Écart SIRENE/BAN ${p.divergenceM} m` }));
  host.append(line);

  host.append(el('p', { class: 'muted-xs', style: 'margin-top:8px', text: `${p.note} Source : ${p.source}.` }));
  if (p.label) host.append(el('p', { class: 'muted-xs', text: `Adresse géocodée : ${p.label}` }));

  (p.warnings || []).forEach((warning) => {
    host.append(el('div', { class: 'notice notice-warning', style: 'margin:10px 0 0' }, [icon('alert'), el('span', { text: warning })]));
  });
  if (p.banError) {
    host.append(el('div', { class: 'notice notice-warning', style: 'margin:10px 0 0' }, [icon('alert'), el('span', { text: `Géocodage BAN : ${p.banError}` })]));
  }

  const reverseHost = el('div', { id: 'reverse-host', style: 'margin-top:12px' });
  host.append(reverseHost);
  detailRefs.reverseHost = reverseHost;
}

export function renderReverseResult(result) {
  const host = detailRefs.reverseHost;
  if (!host) return;
  clear(host);
  if (!result) {
    host.append(el('p', { class: 'muted-xs', text: 'Géocodage inverse : aucune adresse trouvée à ces coordonnées.' }));
    return;
  }
  host.append(el('div', { class: 'notice notice-info', style: 'margin:0' }, [
    icon('info'),
    el('span', { text: `Géocodage inverse (BAN) : ${result.label} — type « ${result.type} », score ${result.score.toFixed(2)}.` }),
  ]));
}

/* --------------------------- 4b. Images ----------------------------- */

export function renderAerialPlaceholder(fiche, handlers) {
  const host = detailRefs.aerialHost;
  if (!host) return;
  clear(host);
  if (!fiche.position) {
    host.append(mediaEmpty({
      iconName: 'satellite',
      title: 'Photographie aérienne indisponible',
      message: fiche.positionError || 'Aucune coordonnée exploitable : impossible de centrer une orthophotographie sur cet établissement.',
    }));
    return;
  }

  const wrap = el('div', { class: 'aerial-wrap' });
  wrap.append(el('span', { class: 'aerial-badge' }, [icon('satellite'), 'IGN BD ORTHO®']));
  wrap.append(el('span', { class: 'aerial-scale-note', id: 'aerial-zoom-note', text: `Zoom ${config.imagery.aerialZoom}` }));
  const mapNode = el('div', { class: 'aerial-map', id: 'aerial-map', role: 'application', 'aria-label': 'Photographie aérienne IGN de l\'établissement' });
  wrap.append(mapNode);

  const toolbar = el('div', { class: 'aerial-toolbar' });
  toolbar.append(el('span', { text: `${formatCoords(fiche.position.lat, fiche.position.lon)} · ${precisionLabel(fiche.position.precision)}` }));
  const actions = el('div', { class: 'aerial-actions' });
  actions.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onAerialZoom?.(-1) }, ['− Dézoomer']));
  actions.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onAerialZoom?.(1) }, ['+ Zoomer']));
  actions.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onAerialRecenter?.() }, [icon('target'), 'Recentrer']));
  actions.append(externalLink(ignTimeLink(fiche.position.lat, fiche.position.lon), 'Comparer les millésimes IGN', 'external'));
  toolbar.append(actions);
  wrap.append(toolbar);
  host.append(wrap);
  detailRefs.aerialMapNode = mapNode;
  detailRefs.aerialZoomNote = wrap.querySelector('#aerial-zoom-note');
  return mapNode;
}

export function renderAerialError(message) {
  const host = detailRefs.aerialHost;
  if (!host) return;
  clear(host);
  host.append(mediaEmpty({
    iconName: 'alert',
    title: 'Photographie aérienne indisponible',
    message: `${message} Aucune image de substitution n'est affichée : vous pouvez utiliser le fond de plan ou réessayer plus tard.`,
  }));
}

function photoCard(photo, { onOpen, onRemove = null }) {
  const card = el('div', { class: 'photo-card' });
  const button = el('button', {
    type: 'button', class: 'photo-thumb', title: 'Agrandir la photographie',
    onclick: () => onOpen?.(photo),
  });
  const image = el('img', {
    src: photo.thumbUrl, alt: `Photographie de rue à proximité — ${photo.providerName}`, loading: 'lazy', decoding: 'async',
  });
  image.addEventListener('error', () => {
    button.replaceChildren(el('span', { class: 'muted-xs', style: 'display:grid;place-items:center;height:100%', text: 'Image indisponible' }));
    button.disabled = true;
  });
  button.append(image);
  if (photo.isPano) button.append(el('span', { class: 'photo-tag', text: '360°' }));
  else if (photo.distanceM != null) button.append(el('span', { class: 'photo-tag', text: `${photo.distanceM} m` }));
  card.append(button);

  const meta = el('div', { class: 'photo-meta' });
  meta.append(el('strong', { text: photo.providerName }));
  meta.append(el('span', { text: photo.capturedAt ? `Prise de vue : ${formatDateFr(photo.capturedAt)}` : 'Date de prise de vue inconnue' }));
  meta.append(el('span', { text: `Auteur : ${truncate(photo.author || 'inconnu', 40)}` }));
  meta.append(el('span', { text: `Licence : ${truncate(photo.licence || 'non renseignée', 40)}` }));
  const links = el('span', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
  if (safeUrl(photo.pageUrl)) {
    links.append(el('a', { href: safeUrl(photo.pageUrl), target: '_blank', rel: 'noopener noreferrer', text: 'Voir la source ↗' }));
  }
  if (onRemove) {
    links.append(el('button', {
      type: 'button', class: 'btn btn-sm btn-ghost', style: 'padding:0;font-size:12px',
      onclick: () => onRemove(photo),
    }, 'Retirer'));
  }
  meta.append(links);
  card.append(meta);
  return card;
}

export function renderStreetPhotos({ loading, photos, sources, radiusM, error }, handlers) {
  const host = detailRefs.streetHost;
  const actions = detailRefs.streetActions;
  if (!host) return;
  clear(host);
  if (actions) {
    clear(actions);
    const select = el('select', {
      class: 'select-sm', title: 'Rayon de recherche des photographies',
      onchange: (event) => handlers.onRadiusChange?.(Number(event.target.value)),
    });
    config.imagery.streetRadiusOptions.forEach((value) => {
      select.append(el('option', { value: String(value), selected: value === radiusM, text: `Rayon ${value} m` }));
    });
    actions.append(select);
    actions.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onReloadPhotos?.() }, [icon('reset'), 'Actualiser']));
  }

  if (loading) {
    host.append(el('p', { class: 'muted', text: 'Recherche de photographies géolocalisées à proximité…' }));
    return;
  }

  if (error) {
    host.append(mediaEmpty({ iconName: 'alert', title: 'Recherche impossible', message: error }));
    return;
  }

  if (sources?.length) {
    const list = el('div', { class: 'coverage-legend', style: 'margin-bottom:12px' });
    sources.forEach((source) => {
      const cls = source.status === 'ok' ? 'badge-success' : (source.status === 'error' ? 'badge-danger' : 'badge-neutral');
      list.append(el('span', { class: `badge ${cls}`, title: source.message, text: `${source.name} : ${source.count}` }));
    });
    host.append(list);
  }

  if (photos?.length) {
    const grid = el('div', { class: 'photo-grid' });
    photos.forEach((photo) => grid.append(photoCard(photo, { onOpen: handlers.onOpenPhoto })));
    host.append(grid);
    host.append(el('p', { class: 'muted-xs', style: 'margin-top:10px', text: `Photographies géolocalisées dans un rayon de ${radiusM} m autour des coordonnées affichées. Elles montrent l'environnement de l'adresse, pas nécessairement l'intérieur ni l'enseigne de l'entreprise.` }));
  } else {
    host.append(mediaEmpty({
      iconName: 'camera',
      title: 'Aucune photographie de rue disponible',
      message: `Aucun contributeur n'a publié d'image dans un rayon de ${radiusM} m. Augmentez le rayon ou consultez la vue aérienne. Aucune image générique n'est affichée à la place.`,
    }));
  }

  (sources || []).filter((source) => source.status !== 'ok').forEach((source) => {
    host.append(el('div', { class: `notice notice-${source.status === 'error' ? 'error' : 'info'}`, style: 'margin:10px 0 0' }, [
      icon(source.status === 'error' ? 'alert' : 'info'),
      el('span', { text: `${source.name} — ${source.message}` }),
    ]));
  });
}

/* ------------------------------------------------------------------ */
/* D. Vue immersive « Street View » 360°                               */
/* ------------------------------------------------------------------ */

const COMPASS = [
  { deg: 0, label: 'N' }, { deg: 90, label: 'E' }, { deg: 180, label: 'S' }, { deg: 270, label: 'O' },
];

/**
 * Rend la section immersive. Aucun iframe n'est créé tant que `loaded` est
 * faux : le fournisseur tiers ne reçoit alors aucune requête, ne dépose aucun
 * cookie et n'ouvre aucun contexte de navigation.
 */
export function renderStreetView({ providers = [], selected = null, loaded = false, heading = 0, photoIndex = 0, position = null }, handlers) {
  const host = detailRefs.streetviewHost;
  if (!host) return;
  clear(host);

  /* --- Sélecteur de source ------------------------------------------ */
  const chooser = el('div', { class: 'sv-chooser', role: 'group', 'aria-label': 'Source de la vue immersive' });
  providers.forEach((provider) => {
    const active = selected?.key === provider.key;
    const ready = provider.status === 'ready';
    chooser.append(el('button', {
      type: 'button',
      class: `sv-provider${active ? ' is-active' : ''}${ready ? '' : ' is-disabled'}`,
      disabled: !ready,
      title: ready ? provider.note : provider.reason,
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => ready && handlers.onSelectProvider?.(provider.key),
    }, [
      el('strong', { text: provider.name }),
      el('span', { class: 'sv-provider-note', text: ready ? (provider.needsKey ? 'clé configurée' : 'sans clé') : 'indisponible' }),
    ]));
  });
  host.append(chooser);

  if (!selected || selected.status !== 'ready') {
    host.append(mediaEmpty({
      iconName: 'expand',
      title: 'Aucune vue immersive disponible pour ce point',
      message: 'Aucune photographie sphérique n\'a été trouvée à proximité et Google Street View n\'est pas configuré. '
        + 'Augmentez le rayon de recherche des photographies de rue, ou activez une source. Aucune vue de remplacement n\'est inventée.',
    }));
    const reasons = el('ul', { class: 'sv-reasons' });
    providers.forEach((provider) => {
      reasons.append(el('li', {}, [el('strong', { text: `${provider.name} — ` }), provider.reason]));
    });
    host.append(reasons);
    return;
  }

  const photo = selected.photos?.[photoIndex] || selected.photo || null;
  const immersion = selected.key === 'google' ? selected.immersion : describeImmersion(photo);
  const supportsHeading = selected.key !== 'mapillary';

  /* --- Cadre : affiche AVANT chargement, iframe APRÈS clic ----------- */
  const stage = el('div', { class: 'sv-stage' });
  stage.style.minHeight = `${config.streetView.frameHeight}px`;

  if (!loaded) {
    const poster = el('div', { class: 'sv-poster' });
    if (photo?.thumbUrl) {
      const image = el('img', { src: photo.thumbUrl, alt: '', loading: 'lazy', decoding: 'async', 'aria-hidden': 'true' });
      image.addEventListener('error', () => image.remove());
      poster.append(image);
    }
    poster.append(el('div', { class: 'sv-poster-veil' }));
    poster.append(el('div', { class: 'sv-poster-action' }, [
      el('button', {
        type: 'button', class: 'btn btn-primary sv-launch',
        onclick: () => handlers.onLoadEmbed?.(),
      }, [icon('expand'), `Ouvrir la vue immersive — ${selected.shortName}`]),
      el('p', {
        class: 'sv-consent',
        text: `Aucune requête n'est envoyée à ${selected.shortName} avant votre clic. `
          + 'Le chargement ouvre un cadre externe qui peut déposer ses propres cookies.',
      }),
    ]));
    stage.append(poster);
  } else {
    const url = handlers.resolveUrl?.() || selected.url;
    if (!url) {
      stage.append(mediaEmpty({ iconName: 'alert', title: 'Vue immersive indisponible', message: 'Impossible de construire l\'adresse du viewer pour cette source.' }));
    } else {
      const frame = el('iframe', {
        ...frameAttributes(`Vue immersive ${selected.name} autour de l'adresse`),
        class: 'sv-frame',
        src: url,
      });
      frame.style.height = `${config.streetView.frameHeight}px`;
      stage.append(frame);
    }
  }
  host.append(stage);

  /* --- Barre d'outils ------------------------------------------------ */
  const toolbar = el('div', { class: 'sv-toolbar' });

  if (loaded && supportsHeading) {
    const turn = (delta) => handlers.onHeadingChange?.(heading + delta);
    toolbar.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', title: 'Tourner vers la gauche', onclick: () => turn(-45) }, [icon('chevron-left'), '45°']));
    toolbar.append(el('span', { class: 'sv-heading', text: `Cap ${Math.round(heading)}°` }));
    toolbar.append(el('button', { type: 'button', class: 'btn btn-sm btn-outline', title: 'Tourner vers la droite', onclick: () => turn(45) }, ['45°', icon('chevron-right')]));
    const compass = el('span', { class: 'sv-compass' });
    COMPASS.forEach((point) => compass.append(el('button', {
      type: 'button', class: 'btn btn-sm btn-ghost', title: `Regarder vers ${point.label}`,
      onclick: () => handlers.onHeadingChange?.(point.deg),
    }, point.label)));
    toolbar.append(compass);
  } else if (loaded) {
    toolbar.append(el('span', { class: 'muted-xs', text: 'Orientation pilotée directement dans le viewer Mapillary.' }));
  }

  if (selected.photos?.length > 1) {
    toolbar.append(el('span', { class: 'sv-count', text: `Photo ${photoIndex + 1}/${selected.photos.length}` }));
    toolbar.append(el('button', {
      type: 'button', class: 'btn btn-sm btn-outline', disabled: photoIndex <= 0,
      title: 'Photographie précédente', onclick: () => handlers.onPhotoChange?.(photoIndex - 1),
    }, [icon('chevron-left')]));
    toolbar.append(el('button', {
      type: 'button', class: 'btn btn-sm btn-outline', disabled: photoIndex >= selected.photos.length - 1,
      title: 'Photographie suivante', onclick: () => handlers.onPhotoChange?.(photoIndex + 1),
    }, [icon('chevron-right')]));
  }

  if (loaded) {
    toolbar.append(el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => handlers.onCloseEmbed?.() }, [icon('close'), 'Fermer la vue']));
  }
  if (photo?.pageUrl) {
    toolbar.append(el('a', {
      class: 'btn btn-sm btn-ghost', href: safeUrl(photo.pageUrl), target: '_blank', rel: 'noopener noreferrer',
    }, [icon('external'), `Ouvrir chez ${selected.shortName}`]));
  } else if (selected.key === 'google' && position) {
    toolbar.append(el('a', {
      class: 'btn btn-sm btn-ghost',
      href: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${position.lat},${position.lon}`,
      target: '_blank', rel: 'noopener noreferrer',
    }, [icon('external'), 'Ouvrir dans Google Maps']));
  }
  if (toolbar.childNodes.length) host.append(toolbar);

  /* --- Attribution et qualification honnête -------------------------- */
  const caption = el('div', { class: 'sv-caption' });
  caption.append(el('span', { class: `badge ${immersion.immersive ? 'badge-success' : 'badge-neutral'}`, text: immersion.label }));
  if (photo) {
    caption.append(el('span', { text: photo.capturedAt ? `Prise de vue : ${formatDateFr(photo.capturedAt)}` : 'Date de prise de vue inconnue' }));
    caption.append(el('span', { text: `Auteur : ${truncate(photo.author || 'inconnu', 40)}` }));
    if (photo.distanceM != null) caption.append(el('span', { text: `À ${photo.distanceM} m du point` }));
  } else {
    caption.append(el('span', { text: 'Panoramas Google — la date de prise de vue n\'est pas fournie par l\'API Embed.' }));
  }
  caption.append(el('span', { text: `Licence : ${truncate(photo?.licence || selected.licence, 60)}` }));
  host.append(caption);
  host.append(el('p', { class: 'muted-xs sv-detail', text: immersion.detail }));
}

export function renderComplementaryPhotos(siret, photos, handlers) {
  const host = detailRefs.complementaryHost;
  if (!host) return;
  clear(host);

  if (photos.length) {
    const grid = el('div', { class: 'photo-grid' });
    photos.forEach((photo) => grid.append(photoCard(photo, {
      onOpen: handlers.onOpenPhoto,
      onRemove: (item) => handlers.onRemovePhoto?.(item),
    })));
    host.append(grid);
  } else {
    host.append(mediaEmpty({
      iconName: 'image',
      title: 'Aucune photographie officielle vérifiée',
      message: 'Il n\'existe pas d\'API gratuite permettant d\'associer de façon fiable une photographie officielle à un SIRET. '
        + 'Aucune image n\'est donc affichée par défaut. Si vous disposez d\'une photographie dont vous pouvez garantir la provenance '
        + '(site officiel de l\'entreprise, service public, votre propre cliché), ajoutez-la ci-dessous : elle sera conservée uniquement sur cet appareil.',
    }));
  }

  const form = el('form', {
    class: 'inline-form',
    onsubmit: (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      handlers.onAddPhoto?.({
        url: String(data.get('url') || '').trim(),
        source: String(data.get('source') || '').trim(),
        licence: String(data.get('licence') || '').trim(),
        date: String(data.get('date') || ''),
        note: String(data.get('note') || '').trim(),
      });
      event.target.reset();
    },
  });
  const field = (name, label, placeholder, type = 'text', wide = false, required = false) => el('div', { class: `field${wide ? ' field-wide' : ''}` }, [
    el('label', { for: `photo-${name}`, text: label }),
    el('input', { type, id: `photo-${name}`, name, placeholder, required }),
  ]);
  form.append(field('url', 'URL de la photographie *', 'https://…/photo.jpg', 'url', true, true));
  form.append(field('source', 'Source / auteur *', 'Site officiel de l’entreprise, mairie, auteur…', 'text', false, true));
  form.append(field('licence', 'Licence', 'CC BY 4.0, domaine public, tous droits réservés…'));
  form.append(field('date', 'Date de prise de vue', '', 'date'));
  form.append(field('note', 'Note', 'Façade nord, entrée principale…'));
  form.append(el('div', { class: 'field field-wide' }, [
    el('button', { type: 'submit', class: 'btn btn-sm btn-outline' }, [icon('plus'), 'Ajouter cette photographie vérifiée']),
  ]));
  host.append(form);
}

/* ------------------- 4b bis. Coordonnées de contact ----------------- */

/**
 * Bloc « Coordonnées de contact » du panneau Informations.
 *
 * L'API Recherche d'entreprises ne publie ni téléphone, ni e-mail, ni contact :
 * ces données sont saisies pour l'établissement affiché, stockées sur
 * l'appareil, et toujours présentées comme telles (aucune valeur inventée).
 */
export function renderContacts(fiche, handlers = {}) {
  const host = detailRefs.contactsSection;
  if (!host) return;
  clear(host);

  const etablissement = fiche?.row?.etablissement;
  const contact = fiche?.contacts || null;
  const editing = Boolean(fiche?.contactsEditing);
  const errors = fiche?.contactErrors || {};
  const channels = contactChannels(contact);

  const head = el('div', { class: 'contact-head' }, [
    sectionTitle('Coordonnées de contact', 'phone'),
    el('span', {
      class: `badge ${channels.length ? 'badge-neutral' : 'badge-warning'}`,
      text: channels.length ? 'Saisie manuelle' : 'Non renseignées',
    }),
  ]);
  host.append(head);

  host.append(el('p', {
    class: 'contact-note',
    text: 'L’API officielle Recherche d’entreprises ne publie pas les coordonnées de contact. '
      + 'Celles-ci sont saisies par vos soins pour cet établissement : elles restent sur cet appareil '
      + 'et sont reprises dans les exports et dans la fiche transmise au formulaire.',
  }));

  if (channels.length) {
    const list = el('ul', { class: 'contact-list' });
    channels.forEach((channel) => {
      const valueNode = el('div', { class: 'contact-value' });
      if (channel.href) {
        valueNode.append(el('a', {
          class: 'contact-link',
          href: channel.href,
          text: channel.display,
          title: channel.key === 'email' ? `Écrire à ${channel.display}` : `Appeler ${channel.display}`,
        }));
      } else {
        valueNode.append(el('span', { text: channel.display }));
      }
      valueNode.append(copyButton(channel.value, channel.label, handlers.onCopyValue));
      list.append(el('li', { class: 'contact-item' }, [
        el('span', { class: 'contact-icon' }, [icon(channel.icon)]),
        el('div', { class: 'contact-text' }, [
          el('p', { class: 'contact-label', text: channel.label }),
          valueNode,
        ]),
      ]));
    });
    host.append(list);

    if (contact?.note) host.append(el('p', { class: 'contact-note contact-note--small', text: contact.note }));
    if (contact?.updatedAt) {
      host.append(el('p', {
        class: 'contact-meta',
        text: `Dernière mise à jour : ${formatDateTimeFr(contact.updatedAt)} · stockée uniquement sur cet appareil`,
      }));
    }
  } else if (!editing) {
    host.append(el('p', {
      class: 'contact-empty',
      text: 'Aucune coordonnée pour cet établissement. Ajoutez le téléphone, l’e-mail ou la personne à joindre '
        + 'si vous les connaissez : elles seront conservées localement et exportées avec la fiche.',
    }));
  }

  if (!editing) {
    host.append(el('div', { class: 'contact-actions' }, [
      el('button', {
        type: 'button',
        class: `btn btn-sm ${channels.length ? 'btn-outline' : 'btn-primary'}`,
        onclick: () => handlers.onEditContacts?.(),
      }, [icon(channels.length ? 'settings' : 'plus'), channels.length ? 'Modifier les coordonnées' : 'Ajouter des coordonnées']),
    ]));
    return;
  }

  /* --- Formulaire de saisie ------------------------------------------ */
  const form = el('form', {
    class: 'contact-form',
    novalidate: true,
    onsubmit: (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      handlers.onSaveContacts?.({
        telephone: String(data.get('telephone') || ''),
        mobile: String(data.get('mobile') || ''),
        email: String(data.get('email') || ''),
        contact: String(data.get('contact') || ''),
        note: String(data.get('note') || ''),
      });
    },
  });

  CONTACT_FIELDS.forEach((field) => {
    const inputId = `contact-${field.key}`;
    const message = errors[field.key];
    form.append(el('div', { class: `field${message ? ' has-error' : ''}` }, [
      el('label', { for: inputId }, [
        icon(field.icon),
        field.label,
      ]),
      el('input', {
        type: field.type,
        id: inputId,
        name: field.key,
        maxlength: CONTACT_LIMITS[field.key],
        placeholder: field.placeholder,
        autocomplete: field.key === 'email' ? 'email' : (field.key === 'contact' ? 'name' : 'tel'),
        value: (contact && contact[field.key]) || '',
        'aria-invalid': message ? 'true' : null,
        'aria-describedby': message ? `${inputId}-error` : `${inputId}-help`,
      }),
      el('p', {
        class: message ? 'field-error' : 'field-help',
        id: message ? `${inputId}-error` : `${inputId}-help`,
        text: message || field.help,
      }),
    ]));
  });

  form.append(el('div', { class: 'field field-wide' }, [
    el('label', { for: 'contact-note' }, 'Note (facultatif)'),
    el('input', {
      type: 'text',
      id: 'contact-note',
      name: 'note',
      maxlength: CONTACT_LIMITS.note,
      placeholder: 'Horaires, standard saturé, contact préférentiel…',
      value: (contact && contact.note) || '',
    }),
  ]));

  const buttons = el('div', { class: 'contact-form-actions' }, [
    el('button', { type: 'submit', class: 'btn btn-sm btn-primary' }, [icon('check'), 'Enregistrer']),
    el('button', {
      type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onCancelContacts?.(),
    }, ['Annuler']),
  ]);
  if (contact) {
    buttons.append(el('button', {
      type: 'button',
      class: 'btn btn-sm btn-danger contact-remove',
      onclick: () => handlers.onRemoveContacts?.(),
      title: 'Supprimer les coordonnées enregistrées pour cet établissement',
    }, [icon('trash'), 'Supprimer']));
  }
  form.append(buttons);
  host.append(form);

  if (!etablissement) return;
  form.dataset.siret = etablissement.siret;
}

/* ----------------------- 4c. Établissements ------------------------- */

export function renderEtablissements({ loading, etablissements, currentSiret, error, notice }, handlers) {
  const host = detailRefs.etabHost;
  if (!host) return;
  clear(host);

  const toolbar = el('div', { class: 'media-head' });
  const cpInput = el('input', { type: 'text', id: 'etab-cp', placeholder: 'Filtrer par code postal', maxlength: '5', style: 'max-width:200px' });
  toolbar.append(cpInput);
  toolbar.append(el('button', {
    type: 'button', class: 'btn btn-sm btn-outline',
    onclick: () => handlers.onLoadEtablissements?.(cpInput.value.trim()),
  }, [icon('search'), 'Charger les établissements']));
  host.append(toolbar);

  if (notice) host.append(el('div', { class: 'notice notice-info', style: 'margin:0 0 12px' }, [icon('info'), el('span', { text: notice })]));
  if (loading) { host.append(el('p', { class: 'muted', text: 'Chargement des établissements…' })); return; }
  if (error) { host.append(el('div', { class: 'notice notice-error', style: 'margin:0' }, [icon('alert'), el('span', { text: error })])); return; }
  if (!etablissements?.length) {
    host.append(mediaEmpty({
      iconName: 'list',
      title: 'Liste non chargée',
      message: 'Cliquez sur « Charger les établissements » pour interroger l\'API. Vous pouvez restreindre la recherche à un code postal.',
    }));
    return;
  }

  const list = el('div', { class: 'etab-list' });
  etablissements.forEach((etablissement) => {
    const row = el('div', { class: `etab-row${etablissement.siret === currentSiret ? ' is-current' : ''}` });
    const main = el('div', { class: 'etab-main' });
    main.append(el('p', { style: 'font-weight:600', text: `${etablissement.estSiege ? 'Siège' : 'Établissement'} · ${etablissement.nomAffiche}` }));
    main.append(el('p', { class: 'etab-addr', text: etablissement.adresse || `${etablissement.codePostal} ${etablissement.commune}` }));
    main.append(el('p', { class: 'muted-xs mono', text: `SIRET ${formatSiret(etablissement.siret)}` }));
    row.append(main);
    const side = el('div', { style: 'display:flex;gap:8px;align-items:center' });
    side.append(statusBadge(etablissement));
    if (etablissement.siret !== currentSiret) {
      side.append(el('button', {
        type: 'button', class: 'btn btn-sm btn-outline',
        onclick: () => handlers.onSelectSiret?.(etablissement.siret),
      }, 'Ouvrir'));
    }
    row.append(side);
    list.append(row);
  });
  host.append(list);
}

/* --------------------------- 4d. Sources ---------------------------- */

function renderSources(fiche) {
  const wrap = el('div', {});
  wrap.append(el('p', { class: 'muted', style: 'margin-bottom:16px', text: 'Chaque donnée affichée provient d\'un service public ou ouvert. Voici la provenance exacte et les conditions d\'utilisation.' }));

  const rows = [
    ['Identification, SIREN/SIRET, adresses, état administratif, NAF',
      'API Recherche d\'entreprises — DINUM / Annuaire des Entreprises',
      'https://recherche-entreprises.api.gouv.fr/docs/', 'Licence Ouverte 2.0'],
    ['Géocodage des adresses, coordonnées, géocodage inverse',
      'Base Adresse Nationale via Géoplateforme IGN',
      'https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/', 'Licence Ouverte 2.0'],
    ['Coordonnées de secours',
      'Géolocalisation SIRENE (INSEE) fournie par l\'API entreprises',
      'https://www.insee.fr/fr/information/3591226', 'Licence Ouverte 2.0'],
    ['Fond de plan',
      'OpenStreetMap', 'https://www.openstreetmap.org/copyright', 'ODbL — attribution obligatoire'],
    ['Fond de plan alternatif',
      'Plan IGN — Géoplateforme', 'https://geoservices.ign.fr/', 'IGN, usage libre avec attribution'],
    ['Photographie aérienne',
      'BD ORTHO® — IGN / Géoplateforme', 'https://geoservices.ign.fr/documentation/donnees/ortho/bdortho', 'IGN, attribution obligatoire'],
    ['Photographies de rue (sans jeton)',
      'Panoramax — fédération IGN / OpenStreetMap France', 'https://panoramax.fr/', 'CC BY-SA 4.0 ou Licence Ouverte selon l\'instance'],
    ['Photographies de rue (jeton gratuit)',
      'Mapillary', 'https://www.mapillary.com/', 'CC BY-SA 4.0'],
    ['Vue immersive 360° (sans clé)',
      'Panoramax — viewer officiel intégré', 'https://docs.panoramax.fr/web-viewer/', 'CC BY-SA 4.0 ou Licence Ouverte selon la séquence'],
    ['Vue immersive 360° (embed public)',
      'Mapillary Embed', 'https://www.mapillary.com/developer/api-documentation', 'CC BY-SA 4.0'],
    ['Vue immersive 360° (optionnelle, clé requise)',
      'Google Street View — API Maps Embed', 'https://developers.google.com/maps/documentation/embed/get-started', 'Conditions Google Maps Platform — Embed gratuit et illimité'],
    ['Libellés NAF, départements, régions, catégories juridiques',
      'INSEE — nomenclatures publiques', 'https://www.insee.fr/', 'Licence Ouverte 2.0'],
  ];

  const table = el('table', { class: 'table' });
  table.append(el('thead', {}, [el('tr', {}, [
    el('th', { text: 'Donnée' }), el('th', { text: 'Source' }), el('th', { text: 'Conditions' }),
  ])]));
  const tbody = el('tbody');
  rows.forEach(([donnee, source, url, licence]) => {
    tbody.append(el('tr', {}, [
      el('td', { text: donnee }),
      el('td', {}, [el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: source })]),
      el('td', { text: licence }),
    ]));
  });
  table.append(tbody);
  wrap.append(el('div', { class: 'table-wrap' }, [table]));

  if (fiche.apiUrl) {
    wrap.append(el('p', { class: 'muted-xs', style: 'margin-top:12px' }, [
      'Requête API utilisée pour cette fiche : ',
      el('a', { href: fiche.apiUrl, target: '_blank', rel: 'noopener noreferrer', text: truncate(fiche.apiUrl, 120) }),
    ]));
  }
  wrap.append(el('p', { class: 'muted-xs', style: 'margin-top:8px', text: 'Les photographies de rue montrent l\'environnement de l\'adresse : elles ne constituent pas une preuve de l\'identité de l\'occupant actuel du bâtiment.' }));
  return wrap;
}

/* ==================================================================== */
/* 5. Paramètres                                                         */
/* ==================================================================== */

function settingRow({ name, description, control }) {
  return el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('p', { class: 'setting-name', text: name }),
      el('p', { class: 'setting-desc', text: description }),
    ]),
    control,
  ]);
}

function switchControl(checked, onChange, label) {
  const input = el('input', { type: 'checkbox', checked, 'aria-label': label, onchange: (event) => onChange(event.target.checked) });
  return el('label', { class: 'switch' }, [input, el('span', { class: 'track' })]);
}

function selectControl(options, value, onChange, label) {
  const select = el('select', { 'aria-label': label, onchange: (event) => onChange(event.target.value) });
  options.forEach((option) => select.append(el('option', { value: String(option.value), selected: String(option.value) === String(value), text: option.label })));
  return select;
}

/* ==================================================================== */
/* 8 bis. Vue de rue superposée à la carte (4e bouton « Street View »)   */
/* ==================================================================== */

/**
 * Met à jour la vue de rue affichée par-dessus la carte.
 *
 * @param {HTMLElement} container #map-street
 * @param {{status: 'loading'|'ready'|'empty'|'error', photo: object|null,
 *   message?: string, label?: string}} view
 */
export function renderMapStreet(container, { status = 'loading', photo = null, message = '', label = '' } = {}) {
  if (!container) return;
  const find = (id) => container.querySelector(`#${id}`);
  const img = find('map-street-img');
  const badge = find('map-street-badge');
  const credit = find('map-street-credit');
  const labelNode = find('map-street-label');
  const counter = find('map-street-counter');
  const openLink = find('map-street-open');
  const prev = find('map-street-prev');
  const next = find('map-street-next');
  const stateText = find('map-street-state-text');

  const ready = status === 'ready' && photo;
  container.dataset.state = ready ? 'ready' : status;
  container.setAttribute('aria-busy', String(status === 'loading'));

  if (ready) {
    if (img) {
      const url = safeUrl(photo.url) || '';
      const fallback = safeUrl(photo.thumbUrl) || '';
      // Une URL haute définition peut échouer (instance lente) : on retombe
      // une seule fois sur la vignette, jamais sur une image d'illustration.
      img.onerror = () => {
        if (fallback && img.getAttribute('src') !== fallback) img.setAttribute('src', fallback);
      };
      if (img.getAttribute('src') !== url) img.setAttribute('src', url);
      img.alt = photo.alt || '';
      img.classList.toggle('is-pano', Boolean(photo.isPano));
      if (photo.pano) {
        // Cadrage du panorama : largeur et décalage calculés pour placer
        // l'immeuble au centre de la vue.
        img.style.setProperty('--pano-width', `${photo.pano.widthPct}%`);
        img.style.setProperty('--pano-left', `${photo.pano.leftPct}%`);
      } else {
        img.style.removeProperty('--pano-width');
        img.style.removeProperty('--pano-left');
      }
      img.hidden = false;
    }
    if (badge) badge.textContent = photo.badge || 'Street View';
    if (credit) credit.textContent = photo.credit || '';
    if (counter) {
      counter.textContent = photo.total > 1 ? photo.counter : '';
      counter.hidden = photo.total <= 1;
    }
    const multiple = photo.total > 1;
    if (prev) prev.hidden = !multiple;
    if (next) next.hidden = !multiple;
    if (openLink) {
      const href = safeUrl(photo.pageUrl) || '';
      if (href) {
        openLink.setAttribute('href', href);
        openLink.hidden = false;
      } else {
        openLink.removeAttribute('href');
        openLink.hidden = true;
      }
    }
  } else {
    if (img) {
      img.hidden = true;
      img.removeAttribute('src');
      img.classList.remove('is-pano');
      img.style.removeProperty('--pano-width');
      img.style.removeProperty('--pano-left');
      img.onerror = null;
      img.alt = '';
    }
    if (badge) badge.textContent = 'Street View';
    if (credit) credit.textContent = '';
    if (counter) { counter.textContent = ''; counter.hidden = true; }
    if (prev) prev.hidden = true;
    if (next) next.hidden = true;
    if (openLink) { openLink.removeAttribute('href'); openLink.hidden = true; }
    if (stateText) stateText.textContent = message || 'Recherche d’une image de rue…';
  }

  if (labelNode) {
    labelNode.textContent = label || '';
    labelNode.hidden = !label;
  }
}

export function renderSettings(container, { settings: current, info, mapillaryAccess, transport, googleStreetView }, handlers) {
  clear(container);

  const networkOk = Boolean(transport?.available) && !transport?.relayFailed;
  const network = el('div', { class: 'setting-group' }, [el('h3', { text: 'Connexion aux services' })]);
  network.append(el('div', { class: `notice notice-${networkOk ? 'info' : 'warning'}`, style: 'margin:0' }, [
    icon(networkOk ? 'check' : 'alert'),
    el('span', { text: transport?.label || 'Chemin réseau inconnu.' }),
  ]));
  network.append(el('p', {
    class: 'muted-xs',
    style: 'margin-top:8px',
    text: 'Avec « node server.js », les requêtes sont relayées par le serveur local : aucun blocage CORS possible, '
      + 'et le jeton Mapillary reste côté serveur. Avec un serveur statique simple, les API sont appelées directement '
      + 'depuis le navigateur, ce qui peut être bloqué pour l\'API Recherche d\'entreprises.',
  }));
  container.append(network);

  const privacy = el('div', { class: 'setting-group' }, [el('h3', { text: 'Confidentialité' })]);
  privacy.append(settingRow({
    name: 'Enregistrer l\'historique sur cet appareil',
    description: 'Désactivé par défaut. Si activé, vos recherches et fiches consultées sont conservées dans le navigateur uniquement (jamais envoyées).',
    control: switchControl(current.historyEnabled, (value) => handlers.onSetting('historyEnabled', value), 'Activer l\'historique local'),
  }));
  privacy.append(settingRow({
    name: 'Stockage local',
    description: info.persistent
      ? `${info.entries} entrées · ${info.kilobytes} Ko · ${info.cacheEntries} entrées de cache · ${info.favorites} fiche(s) enregistrée(s).`
      : 'LocalStorage indisponible (navigation privée ?) : les données ne seront pas conservées après fermeture.',
    control: el('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => handlers.onPurgeData() }, [icon('trash'), 'Tout effacer']),
  }));
  privacy.append(settingRow({
    name: 'Cache des API',
    description: 'Évite les appels inutiles : recherches 6 h, géocodage 30 jours, photographies 24 h.',
    control: el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onPurgeCache() }, [icon('reset'), 'Vider le cache']),
  }));
  container.append(privacy);

  const search = el('div', { class: 'setting-group' }, [el('h3', { text: 'Recherche' })]);
  search.append(settingRow({
    name: 'Résultats par page',
    description: 'L\'API plafonne à 25 résultats par page.',
    control: selectControl([{ value: 10, label: '10' }, { value: 25, label: '25' }], current.perPage, (value) => handlers.onSetting('perPage', Number(value)), 'Résultats par page'),
  }));
  search.append(settingRow({
    name: 'Recherche approximative',
    description: 'Si la recherche exacte échoue : nom simplifié, puis élargissement géographique — toujours signalé à l\'écran.',
    control: switchControl(current.fuzzyFallback, (value) => handlers.onSetting('fuzzyFallback', value), 'Recherche approximative'),
  }));
  container.append(search);

  const mapGroup = el('div', { class: 'setting-group' }, [el('h3', { text: 'Carte et imagerie' })]);
  mapGroup.append(settingRow({
    name: 'Fond de carte par défaut',
    description: 'Le fond « Photo aérienne » est une véritable orthophotographie IGN.',
    control: selectControl([
      { value: 'osm', label: 'Plan OpenStreetMap' },
      { value: 'planign', label: 'Plan IGN' },
      { value: 'ortho', label: 'Photo aérienne IGN' },
    ], current.defaultBaseLayer, (value) => handlers.onSetting('defaultBaseLayer', value), 'Fond de carte'),
  }));
  mapGroup.append(settingRow({
    name: 'Ouvrir directement l\'onglet Images',
    description: 'À l\'ouverture d\'une fiche, afficher la vue aérienne et les photos de rue plutôt que les informations administratives.',
    control: switchControl(current.autoOpenAerial, (value) => handlers.onSetting('autoOpenAerial', value), 'Ouvrir l\'onglet images'),
  }));
  mapGroup.append(settingRow({
    name: 'Fournisseurs de photos de rue',
    description: 'Panoramax ne demande aucun jeton. Mapillary nécessite un jeton gratuit.',
    control: selectControl([
      { value: 'both', label: 'Panoramax + Mapillary' },
      { value: 'panoramax', label: 'Panoramax seul' },
      { value: 'mapillary', label: 'Mapillary seul' },
    ], current.streetProviders, (value) => handlers.onSetting('streetProviders', value), 'Fournisseurs de photos'),
  }));
  mapGroup.append(settingRow({
    name: 'Rayon de recherche des photos',
    description: 'Distance maximale entre les coordonnées de l\'établissement et la photographie.',
    control: selectControl(config.imagery.streetRadiusOptions.map((value) => ({ value, label: `${value} m` })), current.streetRadiusM, (value) => handlers.onSetting('streetRadiusM', Number(value)), 'Rayon photos'),
  }));
  container.append(mapGroup);

  const immersive = el('div', { class: 'setting-group' }, [el('h3', { text: 'Vue immersive — Street View 360°' })]);
  immersive.append(settingRow({
    name: 'Source immersive préférée',
    description: 'Panoramax et Mapillary fonctionnent sans aucune clé. Google Street View nécessite une clé Google Cloud.',
    control: selectControl([
      { value: 'panoramax', label: 'Panoramax 360° (sans clé)' },
      { value: 'mapillary', label: 'Mapillary 360° (sans clé)' },
      { value: 'google', label: 'Google Street View (clé requise)' },
    ], current.streetViewProvider, (value) => handlers.onSetting('streetViewProvider', value), 'Source immersive'),
  }));
  const googleReady = Boolean(googleStreetView?.configured);
  immersive.append(el('div', { class: `notice notice-${googleReady ? 'info' : 'warning'}`, style: 'margin:0' }, [
    icon(googleReady ? 'check' : 'info'),
    el('span', {
      text: googleReady
        ? 'Google Street View est actif : la clé est chargée côté serveur et n\'apparaît jamais dans le JavaScript public.'
        : 'Google Street View n\'est pas configuré. L\'API Maps Embed est gratuite et illimitée, mais Google exige un projet Cloud avec facturation activée. '
          + 'Renseignez googleMapsEmbedKey dans server.config.json pour l\'activer. Sans cela, Panoramax fournit la vue immersive sans clé.',
    }),
  ]));
  immersive.append(el('p', {
    class: 'muted-xs',
    style: 'margin-top:8px',
    text: 'Confidentialité : aucun cadre externe n\'est chargé tant que vous n\'avez pas cliqué sur « Ouvrir la vue immersive ». '
      + 'Le fournisseur ne reçoit donc aucune requête, et ne dépose aucun cookie, sans votre action.',
  }));
  container.append(immersive);

  const mapillary = el('div', { class: 'setting-group' }, [el('h3', { text: 'Mapillary (jeton gratuit)' })]);
  const mode = mapillaryAccess?.mode || 'none';
  mapillary.append(el('div', { class: `notice notice-${mode === 'none' ? 'info' : 'warning'}`, style: 'margin:0 0 12px' }, [
    icon(mode === 'none' ? 'info' : 'alert'),
    el('span', { text: `Mode actuel : ${mode === 'proxy' ? 'proxy local sécurisé' : (mode === 'direct' ? 'jeton client exposé' : 'non configuré')}. ${mapillaryAccess?.detail || ''}` }),
  ]));
  mapillary.append(el('p', {
    class: 'muted-xs',
    text: 'Pour activer Mapillary sans exposer de secret : créez server.config.json dans le dossier de l’application, '
      + 'puis lancez node server.js. Deux formes acceptées — « mapillaryToken » : "MLY|<client_id>|<client_secret>" '
      + '(le « Client Token » complet), ou « mapillaryClientId » + « mapillaryClientSecret » : le serveur compose le jeton '
      + 'lui-même. Un Client ID seul ne suffit pas : l’API répondrait 401. Contrôle : node server.js --check-mapillary. '
      + 'Jeton gratuit sur mapillary.com/dashboard/developers.',
  }));
  mapillary.append(el('p', { class: 'muted-xs', style: 'margin-top:8px' }, [
    'Sans jeton, ', el('strong', { text: 'Panoramax' }), ' fournit déjà des photographies de rue libres (IGN et OpenStreetMap France), sans inscription.',
  ]));
  container.append(mapillary);

  const about = el('div', { class: 'setting-group' }, [el('h3', { text: 'À propos' })]);
  about.append(el('p', { class: 'muted-xs', text: `${config.app.name} ${config.app.version} — application locale, HTML/CSS/JavaScript sans framework. Leaflet 1.9.4 est servi localement. Aucune donnée personnelle n'est collectée, aucun compte n'est requis.` }));
  about.append(el('button', {
    type: 'button', class: 'btn btn-sm btn-outline', style: 'margin-top:12px', onclick: () => handlers.onResetSettings(),
  }, [icon('reset'), 'Réinitialiser les paramètres']));
  container.append(about);
}

/* ==================================================================== */
/* 6. Historique                                                         */
/* ==================================================================== */

export function renderHistory(container, { tab, searches, views, favorites: saved, enabled }, handlers) {
  clear(container);

  const tabs = el('div', { class: 'history-tabs' });
  [
    { key: 'searches', label: `Recherches (${searches.length})` },
    { key: 'views', label: `Fiches consultées (${views.length})` },
    { key: 'favorites', label: `Fiches enregistrées (${saved.length})` },
  ].forEach((item) => {
    tabs.append(el('button', {
      type: 'button', class: `chip${tab === item.key ? ' is-active' : ''}`, onclick: () => handlers.onHistoryTab(item.key),
    }, item.label));
  });
  container.append(tabs);

  if (!enabled && tab !== 'favorites') {
    container.append(el('div', { class: 'notice notice-info', style: 'margin:0 0 12px' }, [
      icon('info'),
      el('span', {}, [
        'L\'historique est désactivé : aucune recherche n\'est mémorisée. ',
        el('button', { type: 'button', class: 'btn btn-sm btn-outline', style: 'margin-left:8px', onclick: () => handlers.onEnableHistory() }, 'Activer l\'historique local'),
      ]),
    ]));
  }

  const list = el('div', { class: 'history-list' });

  if (tab === 'searches') {
    if (!searches.length) {
      list.append(mediaEmpty({ iconName: 'history', title: 'Aucune recherche mémorisée', message: enabled ? 'Vos prochaines recherches apparaîtront ici.' : 'Activez l\'historique pour conserver vos recherches sur cet appareil.' }));
    }
    searches.forEach((item) => {
      const label = [item.criteria.nom, item.criteria.codePostal, item.criteria.ville, item.criteria.identifiant].filter(Boolean).join(' · ') || 'Recherche';
      list.append(el('div', { class: 'history-row' }, [
        el('div', { class: 'h-main' }, [
          el('p', { class: 'h-title', text: label }),
          el('p', { class: 'h-sub', text: `${formatDateTimeFr(item.at)} · ${item.totalResults} résultat(s)` }),
        ]),
        el('div', { class: 'h-actions' }, [
          el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onReplaySearch(item) }, [icon('search'), 'Relancer']),
          el('button', { type: 'button', class: 'icon-btn', title: 'Supprimer', onclick: () => handlers.onRemoveSearch(item) }, [icon('trash')]),
        ]),
      ]));
    });
    if (searches.length) {
      list.append(el('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => handlers.onClearHistory('searches') }, [icon('trash'), 'Vider les recherches']));
    }
  }

  if (tab === 'views') {
    if (!views.length) {
      list.append(mediaEmpty({ iconName: 'building', title: 'Aucune fiche consultée', message: enabled ? 'Les fiches ouvertes apparaîtront ici.' : 'Activez l\'historique pour conserver la liste des fiches consultées.' }));
    }
    views.forEach((item) => {
      list.append(el('div', { class: 'history-row' }, [
        el('div', { class: 'h-main' }, [
          el('p', { class: 'h-title', text: item.nom || item.siret }),
          el('p', { class: 'h-sub', text: `${item.codePostal || ''} ${item.commune || ''} · SIRET ${formatSiret(item.siret)} · ${formatDateTimeFr(item.at)}` }),
        ]),
        el('div', { class: 'h-actions' }, [
          el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onSelectSiret(item.siret) }, 'Ouvrir'),
          el('button', { type: 'button', class: 'icon-btn', title: 'Supprimer', onclick: () => handlers.onRemoveView(item) }, [icon('trash')]),
        ]),
      ]));
    });
    if (views.length) {
      list.append(el('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => handlers.onClearHistory('views') }, [icon('trash'), 'Vider les fiches consultées']));
    }
  }

  if (tab === 'favorites') {
    if (!saved.length) {
      list.append(mediaEmpty({ iconName: 'star', title: 'Aucune fiche enregistrée', message: 'Cliquez sur l\'étoile dans une fiche pour la conserver sur cet appareil, même hors ligne.' }));
    }
    saved.forEach((item) => {
      const e = item.etablissement;
      list.append(el('div', { class: 'history-row' }, [
        el('div', { class: 'h-main' }, [
          el('p', { class: 'h-title', text: e.nomAffiche }),
          el('p', { class: 'h-sub', text: `${e.codePostal || ''} ${e.commune || ''} · SIRET ${formatSiret(e.siret)} · enregistrée le ${formatDateFr(item.savedAt)}` }),
        ]),
        el('div', { class: 'h-actions' }, [
          el('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => handlers.onOpenFavorite(item) }, 'Ouvrir'),
          el('button', { type: 'button', class: 'icon-btn', title: 'Supprimer', onclick: () => handlers.onRemoveFavorite(e.siret) }, [icon('trash')]),
        ]),
      ]));
    });
    if (saved.length) {
      list.append(el('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => handlers.onClearHistory('favorites') }, [icon('trash'), 'Supprimer toutes les fiches enregistrées']));
    }
  }

  container.append(list);
}

/* ==================================================================== */
/* 7. État des services                                                  */
/* ==================================================================== */

export function renderStatus(container, statuses) {
  clear(container);
  statuses.forEach((service) => {
    const state = service.state;
    const color = state === 'ok' ? '#22c55e' : (state === 'checking' ? '#2563eb' : (state === 'skipped' ? '#94a3b8' : '#ef4444'));
    const label = state === 'ok' ? 'En ligne' : (state === 'checking' ? 'Test…' : (state === 'skipped' ? 'Non configuré' : 'Indisponible'));
    container.append(el('li', {}, [
      el('span', { class: 'status-dot', style: `background:${color};margin-top:6px` }),
      el('div', {}, [
        el('p', { class: 's-name', text: service.name }),
        el('p', { class: 's-detail', text: service.detail || '' }),
      ]),
      el('span', { class: 's-state', style: `color:${color}`, text: label }),
    ]));
  });
}

/* ==================================================================== */
/* 8. Modales & lightbox                                                 */
/* ==================================================================== */

let lastFocused = null;

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  lastFocused = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  const focusable = modal.querySelector('button, [href], input, select, textarea');
  focusable?.focus();
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  if (!document.querySelector('.modal:not([hidden]), .lightbox:not([hidden])')) document.body.style.overflow = '';
  lastFocused?.focus?.();
}

const lightboxState = { photos: [], index: 0 };

export function openLightbox(photos, index = 0) {
  lightboxState.photos = photos;
  lightboxState.index = index;
  const box = document.getElementById('lightbox');
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  updateLightbox();
  document.getElementById('lightbox-prev')?.focus();
}

export function closeLightbox() {
  const box = document.getElementById('lightbox');
  if (!box || box.hidden) return;
  box.hidden = true;
  const image = document.getElementById('lightbox-img');
  image.src = '';
  if (!document.querySelector('.modal:not([hidden])')) document.body.style.overflow = '';
}

export function moveLightbox(delta) {
  const total = lightboxState.photos.length;
  if (!total) return;
  lightboxState.index = (lightboxState.index + delta + total) % total;
  updateLightbox();
}

function updateLightbox() {
  const photo = lightboxState.photos[lightboxState.index];
  if (!photo) return;
  const image = document.getElementById('lightbox-img');
  image.src = photo.fullUrl || photo.thumbUrl;
  image.alt = `Photographie ${lightboxState.index + 1} sur ${lightboxState.photos.length} — ${photo.providerName}`;
  const caption = document.getElementById('lightbox-caption');
  clear(caption);
  caption.append(el('p', {
    text: `${photo.providerName} · ${photo.capturedAt ? formatDateFr(photo.capturedAt) : 'date inconnue'} · ${photo.author || 'auteur inconnu'} · ${photo.licence || 'licence non renseignée'}${photo.distanceM != null ? ` · à ${photo.distanceM} m` : ''}`,
  }));
  if (safeUrl(photo.pageUrl)) {
    caption.append(el('p', {}, [el('a', { href: safeUrl(photo.pageUrl), target: '_blank', rel: 'noopener noreferrer', text: 'Voir la photographie sur le site source ↗' })]));
  }
  caption.append(el('p', { class: 'muted-xs', text: `${lightboxState.index + 1} / ${lightboxState.photos.length}` }));
  document.getElementById('lightbox-prev').disabled = lightboxState.photos.length < 2;
  document.getElementById('lightbox-next').disabled = lightboxState.photos.length < 2;
}

/** Fermetures globales (backdrops, croix, Échap, flèches du clavier). */
export function initUi() {
  document.addEventListener('click', (event) => {
    const closer = event.target.closest?.('[data-close]');
    if (closer) {
      const id = closer.dataset.close;
      if (id === 'lightbox') closeLightbox();
      else if (id === 'status-panel') {
        document.getElementById('status-panel').hidden = true;
        document.getElementById('btn-status')?.setAttribute('aria-expanded', 'false');
      } else closeModal(id);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!document.getElementById('lightbox').hidden) { closeLightbox(); return; }
      const openModalNode = document.querySelector('.modal:not([hidden])');
      if (openModalNode) { closeModal(openModalNode.id); return; }
      const panel = document.getElementById('status-panel');
      if (panel && !panel.hidden) { panel.hidden = true; return; }
      const fullscreen = document.querySelector('.map-card.is-fullscreen');
      if (fullscreen) document.getElementById('btn-fullscreen')?.click();
    }
    if (!document.getElementById('lightbox').hidden) {
      if (event.key === 'ArrowLeft') moveLightbox(-1);
      if (event.key === 'ArrowRight') moveLightbox(1);
    }
  });

  document.getElementById('lightbox-prev')?.addEventListener('click', () => moveLightbox(-1));
  document.getElementById('lightbox-next')?.addEventListener('click', () => moveLightbox(1));
}
