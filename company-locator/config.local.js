/**
 * config.local.js — Surcharges locales (fichier livré vide, à personnaliser).
 *
 * Ce fichier est chargé par js/config.js et fusionné avec les valeurs par
 * défaut. Il est volontairement livré VIDE : l'application est 100 %
 * fonctionnelle sans lui (recherche, géocodage, carte, photo aérienne IGN,
 * photos de rue Panoramax).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MAPILLARY — deux modes possibles
 * ─────────────────────────────────────────────────────────────────────────
 * 1) RECOMMANDÉ — proxy local (le jeton n'est jamais envoyé au navigateur) :
 *      - créez `server.config.json` à la racine de company-locator/ :
 *          { "mapillaryToken": "MLY|xxxx|yyyy" }
 *        ou définissez la variable d'environnement MAPILLARY_TOKEN ;
 *      - lancez `node server.js`.
 *      Ne mettez alors RIEN dans ce fichier.
 *
 * 2) DÉCONSEILLÉ en site public — jeton client dans le navigateur :
 *      mapillary: { clientToken: 'MLY|xxxx|yyyy' }
 *    Un jeton client Mapillary est visible par tout visiteur : à réserver à
 *    un usage strictement local/personnel. Ne le commitez jamais.
 *
 * Obtention du jeton (gratuit) : https://www.mapillary.com/dashboard/developers
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Exemples de surcharges utiles (décommentez au besoin) :
 *
 * export default {
 *   imagery: { streetRadiusM: 200, streetProviders: 'panoramax' },
 *   search: { perPage: 25 },
 *   map: { defaultBaseLayer: 'ortho' },
 *   storage: { historyEnabled: true },
 *   api: { mapillary: { clientToken: '' } },
 *   app: { debug: true },
 * };
 */

export default {};
