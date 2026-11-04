/**
 * boot.js — Garde de démarrage de l'interface.
 *
 * RESPONSABILITÉ UNIQUE : détecter que l'application n'a pas pu démarrer et
 * expliquer quoi faire. Ce fichier est volontairement un script CLASSIQUE
 * (aucun `import`/`export`) : il s'exécute même lorsque le navigateur refuse
 * les modules ES, c'est-à-dire quand index.html est ouvert en double-cliquant
 * (`file://`). Dans ce cas précis, js/app.js ne s'exécute jamais et l'écran
 * resterait vide sans message : c'est ce garde-fou qui parle à l'utilisateur.
 *
 * Il ne contient aucune logique métier et n'appelle aucune API.
 */
(function () {
  'use strict';

  var READY_FLAG = '__companyLocatorReady';
  var WATCHDOG_MS = 8000;

  /** Chemin du dossier déduit de l'URL courante (jamais de chemin codé en dur). */
  function currentFolder() {
    var pathname = '';
    try { pathname = decodeURIComponent(window.location.pathname || ''); } catch (e) { pathname = window.location.pathname || ''; }
    var folder = pathname.replace(/\/[^/]*$/, '');
    if (/^\/[A-Za-z]:/.test(folder)) folder = folder.slice(1);
    if (/^[A-Za-z]:/.test(folder)) folder = folder.replace(/\//g, '\\');
    return folder || '.';
  }

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  /** Construit le bandeau d'aide. Aucune donnée externe n'y est injectée. */
  function renderHelp(title, intro, steps, commands, footer) {
    var banner = document.getElementById('boot-error');
    if (!banner) return;
    banner.textContent = '';
    banner.hidden = false;
    banner.setAttribute('role', 'alert');

    banner.appendChild(node('strong', 'boot-help-title', title));
    banner.appendChild(node('p', 'boot-help-intro', intro));

    if (steps && steps.length) {
      var list = node('ol', 'boot-help-steps');
      steps.forEach(function (step) {
        var item = node('li');
        item.appendChild(node('span', null, step));
        list.appendChild(item);
      });
      banner.appendChild(list);
    }

    if (commands && commands.length) {
      var pre = node('pre', 'boot-help-commands');
      pre.appendChild(node('code', null, commands.join('\n')));
      banner.appendChild(pre);
    }

    if (footer) banner.appendChild(node('p', 'boot-help-footer', footer));
  }

  function modulesUnsupported() {
    return !('noModule' in document.createElement('script'));
  }

  function explainFileProtocol() {
    renderHelp(
      'L\'application ne peut pas démarrer : le fichier est ouvert directement.',
      'L\'adresse commence par « file:// ». Dans ce mode, le navigateur bloque les modules JavaScript '
        + 'et les requêtes réseau : aucune recherche ne peut aboutir. Il faut servir ce dossier avec le '
        + 'petit serveur local fourni (gratuit, aucune installation de dépendance).',
      [
        'Le plus simple : double-cliquez sur « Lancer-Company-Locator.bat » (Windows) ou « lancer.sh » (macOS / Linux) dans ce dossier. Le serveur démarre et le navigateur s\'ouvre tout seul.',
        'Ou ouvrez un terminal dans ce dossier et tapez les commandes ci-dessous.',
        'Ouvrez ensuite http://localhost:8080/ — et non plus le fichier index.html.',
      ],
      ['cd "' + currentFolder() + '"', 'node server.js'],
      'Node.js est gratuit : https://nodejs.org — Déjà installé ? Fermez cette page et utilisez le lanceur. '
        + 'Détails et dépannage : README.md, section « Installation et lancement ».'
    );
  }

  function explainWatchdog() {
    var banner = document.getElementById('boot-error');
    // app.js a déjà affiché une erreur précise : ne pas la remplacer.
    if (banner && !banner.hidden) return;
    renderHelp(
      'L\'application n\'a pas démarré.',
      'L\'interface est chargée mais le module js/app.js ne s\'est pas exécuté.',
      [
        'Vérifiez que la page est servie par « node server.js » sur http://localhost:8080/ (et non ouverte en file://).',
        'Vérifiez que JavaScript est autorisé et qu\'aucune extension ne bloque les scripts de ce site.',
        'Ouvrez la console du navigateur (touche F12) pour lire l\'erreur exacte, puis rechargez la page.',
      ],
      ['cd "' + currentFolder() + '"', 'node server.js'],
      'Si le port 8080 est occupé, le serveur en choisit automatiquement un autre : utilisez l\'adresse affichée dans le terminal.'
    );
  }

  function start() {
    if (window.location.protocol === 'file:') {
      explainFileProtocol();
      return;
    }
    // Le diagnostic « navigateur trop ancien » n'est posé qu'après le délai,
    // et seulement si l'application n'a réellement pas démarré : une détection
    // de fonctionnalité seule pourrait produire un faux positif.
    window.setTimeout(function () {
      if (window[READY_FLAG]) return;
      if (modulesUnsupported()) {
        renderHelp(
          'Navigateur trop ancien.',
          'Ce navigateur ne prend pas en charge les modules JavaScript ES, dont l\'application a besoin. '
            + 'Utilisez une version récente de Chrome, Edge, Firefox ou Safari.',
          null, null, 'Aucune installation payante n\'est nécessaire : ces navigateurs sont gratuits.'
        );
        return;
      }
      explainWatchdog();
    }, WATCHDOG_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
