# Rapport de vérification

**Projet** : Company Locator France · **Version** : 1.0.0 · **Date** : 4 novembre 2026

Ce document distingue honnêtement **ce qui a été exécuté et vérifié** de **ce qui doit être confirmé sur une machine disposant d'un accès Internet non restreint**.

---

## 1. Résultats des tests exécutés

### 1.1 Tests unitaires — `npm test`

```
# tests 126
# pass  126
# fail  0
```

| Fichier | Périmètre |
|---|---|
| `tests/unit/utils.test.mjs` | Luhn SIREN/SIRET (cas réels + dérogation La Poste), codes postaux (Corse, DROM, invalides), départements, haversine, emprise France, similarité de chaînes, `RateLimiter`, `TtlCache`, retry/backoff, gestion 429 et `Retry-After`, erreurs typées, échappement HTML, neutralisation d'URL |
| `tests/unit/entreprise-api.test.mjs` | Construction des paramètres, normalisation du schéma officiel, reconstitution des champs masqués, dédoublonnage par SIRET, siège en tête, non-diffusibles, pagination, cache |
| `tests/unit/search.test.mjs` | Validation des critères (aucun appel réseau si invalide), recherche exacte, replis successifs signalés, filtres d'état, tris, score de pertinence, résumé |
| `tests/unit/geocoding.test.mjs` | **Toute l'arbre de décision GPS** : BAN numéro de voie prioritaire, confirmation par `geo_id`, repli SIRENE, précision voie/commune, divergence > 300 m, coordonnées aberrantes, absence de position, non-diffusible, géocodage inverse |
| `tests/unit/export-storage.test.mjs` | CSV (BOM, `;`, CRLF, anti-injection de formule), 23 colonnes, GeoJSON EPSG:4326, export de fiche, paramètres, **historique opt-in**, favoris, photos sourcées, purge, indisponibilité du `localStorage` |
| `tests/unit/images.test.mjs` | Détection du mode Mapillary (proxy / direct / aucun), Panoramax `place_position` + repli `bbox`, filtrage par rayon, tri par distance, dédoublonnage, normalisation des dates/licences, statut par fournisseur, photos complémentaires (source obligatoire), **vue de rue de la carte** (`streetPhotoView` : image, crédit, compteur borné, badge 360° vs photographie plate, refus d'URL non sûre) |
| `tests/unit/streetview.test.mjs` | Vues immersives : URL Panoramax/Mapillary/Google, cap normalisé et borné, classement sphérique avant plat, disponibilité par source, **refus des coordonnées absentes** (`Number(null) === 0`), aucune clé dans les URL, durcissement du cadre |
| `tests/unit/transport.test.mjs` | Correspondance URL publique ↔ relais local pour les trois services, **refus des origines non déclarées**, comportement hors navigateur, propagation des erreurs HTTP métier |

### 1.2 Cascade CSS — `npm run test:css`

```
16/16 vérifications CSS réussies.
```

Ce suite rejoue la **cascade réelle** de la propriété `display` (origine auteur
`!important` > auteur normale > navigateur, puis spécificité, puis ordre), parce que
jsdom n'applique pas `!important` et laisserait passer la régression. Elle vérifie
qu'**aucun élément porteur de `hidden` ne reste visible**, que retirer `hidden`
réaffiche bien les modales, et que les règles d'impression restent correctes.

**Test par mutation effectué** : en retirant la règle `[hidden] { display: none !important; }`,
7 vérifications échouent (9/16). La suite détecte donc bien le défaut d'origine.

### 1.3 Garde de démarrage — `npm run test:boot`

```
14/14 vérifications de démarrage réussies.
```

Reproduit le cas réel `file:///C:/Users/…/company-locator/index.html` : bandeau
d'aide affiché, cause expliquée, lanceur proposé, commande `cd` exacte déduite de
l'URL, adresse `http://localhost:8080/` indiquée. Vérifie aussi le chien de garde
(module jamais exécuté, démarrage réussi, erreur déjà affichée non écrasée) et le
cas du navigateur sans support des modules.

### 1.4 Intégration DOM — `npm run test:dom`

```
55/55 vérifications réussies.
Parcours complet validé sans erreur.
```

Environnement : **jsdom** + **Leaflet 1.9.4 réel** (chargé depuis `vendor/`), modules applicatifs réels importés tels quels, `fetch` routé vers des fixtures **synthétiques**.

Parcours couvert :

1. Démarrage de l'application, initialisation de la carte, chargement des référentiels INSEE.
2. Sonde de santé des **5 services** et affichage du panneau d'état.
3. Détection du serveur local et **choix du chemin réseau** (relais pour l'API entreprises, direct pour Géoplateforme et Panoramax).
4. Recherche `nom + code postal` → 3 établissements actifs, **1 établissement fermé correctement filtré**, **1 doublon de siège supprimé**.
5. Marqueurs Leaflet créés et positionnés.
6. Ouverture de fiche : SIREN et SIRET **formatés et valides**, NAF `47.11D — Supermarchés`, forme juridique, région **Île-de-France**, département **75 — Paris**.
7. Coordonnées GPS affichées avec **niveau de précision** et **score de géocodage**.
8. Lien OpenStreetMap correctement construit.
9. Lien profond `#/etablissement/{siret}` restauré au chargement.
10. Onglet Images : **couche BD ORTHO® réellement ajoutée** à la carte aérienne, **3 photographies de rue** sourcées et datées.
11. Lightbox : ouverture, compteur `1/3`, navigation `2/3`, fermeture par `Échap`.
11 bis. **Vue immersive** : les trois sources sont proposées, Google est grisé avec sa vraie raison, **aucun iframe avant le clic**, chargement de Panoramax au clic dans un cadre `sandbox` + `no-referrer`, orientation par pas de 45° et points cardinaux répercutée dans l'URL, fermeture qui retire l'iframe, **aucune clé ni jeton dans l'URL du cadre**.
12. Bascule fond de carte ↔ photographie aérienne, **4e bouton Street View** (image de rue de l'établissement affichée sans iframe, crédit, flèches entre les photographies, retour au plan qui referme la vue), plein écran.
13. Exports : CSV résultats, GeoJSON, CSV fiche — noms de fichiers et contenus vérifiés.
14. Enregistrement d'une fiche en favori.
15. Paramètres : état du stockage, mode Mapillary, chemin réseau.
16. Historique **opt-in** : rien avant activation, puis recherches, fiches consultées et fiches enregistrées dans les trois onglets.
17. Recherche sans résultat → message explicite.
18. Code postal invalide → refus **avant tout appel réseau**.
19. **0 erreur JavaScript** sur l'ensemble du parcours.
20. **0 appel à un service payant ou non déclaré.**
21. **0 jeton secret** dans les requêtes émises par le navigateur.

### 1.5 Serveur local — vérifications HTTP réelles

Exécutées contre `node server.js` en fonctionnement :

| Vérification | Résultat |
|---|---|
| **63 ressources locales** (HTML, CSS, JS, SVG, JSON, PNG, polices Leaflet) | **toutes en HTTP 200**, aucune référence cassée |
| Types MIME (`text/html`, `text/javascript`, `text/css`, `image/svg+xml`, `application/json`, `image/png`) | conformes |
| `GET /api/health` | `{"ok":true,"app":"Company Locator France",…}` |
| `GET /api/mapillary/status` sans jeton | `{"configured":false,"mode":"none",…}` — message d'aide |
| `GET /api/mapillary/images` sans jeton | HTTP 501 explicite, **aucun appel anonyme** |
| Chargement d'un jeton via `server.config.json` + `/api/reload-token` | `configured:true`, **jeton absent de toutes les réponses** |
| `GET /server.config.json` | **HTTP 403** — le secret n'est jamais téléchargeable |
| `GET /api/proxy/entreprises/admin` | **HTTP 403** — chemin hors liste blanche |
| `GET /api/proxy/inconnu/search` | **HTTP 404** — relais inconnu refusé |
| Traversée de répertoire (`/%2e%2e/…`) | bloquée |
| Répertoire sans index | HTTP 404, **aucun listing** |
| Relais public injoignable | HTTP 502 avec message de diagnostic en français |
| Port 8080 déjà occupé | Bascule automatique sur 8081, vérifiée par une seconde instance (`/api/health` → 200 sur 8081) |
| `js/boot.js` servi | HTTP 200, `text/javascript` |
| `GET /api/streetview/status` sans clé | `configured:false` + message expliquant Panoramax comme alternative sans clé |
| `GET /api/streetview/embed` sans clé | HTTP 501 explicite, **aucun appel à Google** |
| `GET /api/streetview/embed` avec clé | **HTTP 302** vers Google, clé ajoutée côté serveur, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` |
| Clé Google dans les réponses | **absente** du statut, de `index.html`, de `js/streetview.js` ; `server.config.json` → **403** |
| Coordonnées absentes ou vides | **HTTP 400** (et non 0,0) ; `lat=0&lon=0` reste accepté comme valeur légitime |
| Paramètres hors bornes | `fov` ramené à 10–100, `pitch` à −90–90, `radius` à 1–1000 |

---

## 2. Vérifications documentaires (sources officielles)

| Élément | Source consultée | Conclusion |
|---|---|---|
| Schéma de réponse de l'API entreprises | Code source officiel `annuaire-entreprises-data-gouv-fr/search-api` : `app/models/unite_legale.py`, `response.py`, `formatters/etablissements.py` | Champs et types confirmés ; `latitude`/`longitude` sont des **chaînes** |
| Paramètres acceptés | `search_params_model.py`, `search_params_builder.py`, `field_validation.py` | Noms, mapping interne et regex de validation confirmés |
| **Absence de CORS** sur l'API entreprises | `app/main.py` du dépôt officiel | Aucun `CORSMiddleware` → **relais local nécessaire** |
| Limite de débit 7 req/s | Documentation publique de l'API | Limiteur réglé à ≈ 4,5 req/s |
| Référentiels INSEE | `app/labels/*.json` du dépôt officiel | Copiés localement avec mention de provenance |
| Décommissionnement de `api-adresse.data.gouv.fr` | Annonces Géoplateforme / BAN | Remplacé par `data.geopf.fr/geocodage` (31/01/2026) |
| Couches WMTS IGN sans clé | Documentation Géoplateforme | `HR.ORTHOIMAGERY.ORTHOPHOTOS`, `ORTHOIMAGERY.ORTHOPHOTOS`, `PLANIGNV2` |
| Panoramax lisible sans jeton | `docs.panoramax.fr/backend/api/api/` | Authentification requise **pour l'écriture seulement** |
| Mapillary exige un jeton | Documentation Graph API v4 | Aucun appel anonyme possible → proxy + Panoramax en solution par défaut |
| **Embed Mapillary sans jeton** | Documentation API Mapillary, section « Embed images » | `www.mapillary.com/embed?image_key=…` ne demande pas de jeton, contrairement à l'API Graph |
| **Viewer Panoramax intégrable** | `docs.panoramax.fr/web-viewer/03_URL_settings/` | `#focus=pic&pic=…&xyz=cap/inclinaison/zoom`, utilisé en iframe par uMap et d'autres applications |
| **Google Maps Embed gratuit** | `developers.google.com/maps/documentation/embed/quickstart` et `usage-and-billing` | Gratuit, **illimité**, sans limite QPS ni journalière — **mais** projet Cloud avec facturation activée obligatoire |
| Viewer Panoramax trop lourd à embarquer | `registry.npmjs.org/@panoramax/web-viewer` | 2,8 Mo + MapLibre + Lit → **iframe officiel retenu** plutôt qu'un nouveau framework |
| Licence Leaflet 1.9.4 | `registry.npmjs.org/leaflet/1.9.4` | BSD-2-Clause, fichier `LICENSE` inclus |

---

## 3. Ce qui n'a **pas** pu être vérifié ici

> **L'environnement de développement restreint les sorties réseau** à quelques domaines (`github.com`, `registry.npmjs.org`, `pypi.org`). Les domaines `recherche-entreprises.api.gouv.fr`, `data.geopf.fr`, `api.panoramax.xyz`, `tile.openstreetmap.org` et `graph.mapillary.com` y sont **injoignables**. Aucun navigateur graphique n'y est disponible non plus.

Par conséquent, **n'ont pas été exécutés depuis cet environnement** :

- les appels HTTP réels aux API publiques ;
- le rendu visuel dans un navigateur réel (captures d'écran, mise en page effective sur mobile) ;
- la réception réelle des tuiles IGN et des photographies Panoramax.

Le script `tests/live-smoke.mjs` a bien été exécuté : il rapporte **0/13** avec `fetch failed` pour chaque service, ce qui **confirme la restriction réseau de l'environnement** et non un défaut de l'application. Il est fourni précisément pour que vous puissiez lever ce doute en une commande sur votre poste.

**Aucune donnée de démonstration n'est présentée comme réelle** : les fixtures ne servent qu'aux tests automatisés, ne sont jamais importées par `js/app.js`, et il n'existe aucun « mode démo ».

---

## 4. Protocole de vérification sur votre poste (5 minutes)

### Étape 1 — connectivité réelle des API

```powershell
cd company-locator
node tests/live-smoke.mjs
```

Attendu : `13/13 tests réseau réussis` (ou 12/13 si une couche IGN optionnelle est momentanément indisponible). Le script affiche, pour chaque cas, le **SIRET**, les **coordonnées réelles** et le **score de géocodage**.

### Étape 2 — application

```powershell
node server.js
# http://localhost:8080/
```

### Étape 3 — parcours de recette

| # | Action | Résultat attendu |
|---|---|---|
| 1 | Cliquer l'exemple **Allianz · 75015** | Résultats réels, SIRET à 14 chiffres, adresses de Paris 15e |
| 2 | Cliquer l'exemple **AXA · 69002** | Établissements lyonnais |
| 3 | Cliquer l'exemple **Renault · 59000** | Établissements lillois |
| 4 | Vider le nom, garder un code postal (`33000`) | Liste paginée d'établissements bordelais |
| 5 | Saisir `13002526500013` dans *SIREN / SIRET* | DINUM, 20 avenue de Ségur, Paris 7e |
| 6 | Ouvrir une fiche → onglet **Fiche** | Coordonnées + **niveau de précision** + lien OSM |
| 7 | Cliquer **Vérifier l'adresse à ce point** | Adresse retournée par le géocodage inverse |
| 8 | Onglet **Images** | Orthophotographie IGN du bâtiment ; photos de rue si la zone est couverte |
| 9 | Zoomer la vue aérienne | Netteté jusqu'au niveau 19, bâtiments identifiables |
| 10 | Basculer **Aérien** sur la carte principale | Le fond devient une photographie, le libellé l'indique |
| 11 | **Copier les coordonnées**, coller dans OpenStreetMap | Le point tombe sur le bâtiment |
| 12 | **Exporter CSV**, ouvrir dans Excel | Colonnes séparées, accents corrects |
| 13 | Réduire la fenêtre à 400 px de large | Bascule en vue mobile à onglets, aucun débordement |
| 14 | Panneau d'état (pastille de l'en-tête) | 5 services testés avec latence |
| 15 | Couper le Wi-Fi puis rechercher | Message « pas de connexion », aucune donnée inventée |

### Étape 4 — Mapillary (optionnel)

Configurer `server.config.json`, relancer, puis `node tests/live-smoke.mjs` : la ligne Mapillary doit passer au vert, et les photos Mapillary apparaître à côté de celles de Panoramax dans l'onglet Images.

---

## 5. Synthèse

| Domaine | Statut |
|---|---|
| Logique métier (recherche, normalisation, GPS, exports, stockage, images) | ✅ **126 tests unitaires exécutés et verts** |
| Cascade CSS et éléments masqués | ✅ **16 vérifications exécutées et vertes** (test par mutation validé) |
| Garde de démarrage (`file://`, chien de garde) | ✅ **14 vérifications exécutées et vertes** |
| Interface et parcours complet | ✅ **52 vérifications DOM exécutées et vertes**, 0 erreur JS |
| Serveur local, ressources, sécurité | ✅ **vérifié par requêtes HTTP réelles** |
| Contrats des API (URL, paramètres, champs, quotas, licences) | ✅ **vérifiés sur les sources officielles** |
| Appels réseau réels aux API publiques | ⏳ **à exécuter sur votre poste** — `node tests/live-smoke.mjs` |
| Rendu visuel navigateur réel | ⏳ **à confirmer visuellement** — recette en 15 points ci-dessus |


---

## 6. Anomalie remontée après livraison, et correctif

### Symptôme signalé

Page sombre au chargement, modale « Historique & fiches enregistrées » visible
spontanément, trois boutons gris flottant au centre, interface inerte. Adresse
relevée dans la barre du navigateur : `C:/Users/…/Desktop/company-locator/index.html`.

### Deux causes distinctes

**1. Bug CSS réel, présent dans tous les environnements.**
`.modal { display: flex }` et `.lightbox { display: flex }` sont des déclarations
d'**origine auteur** : elles battent le `[hidden] { display: none }` de la feuille de
style du **navigateur**, quelle que soit la spécificité. Les deux modales et la
lightbox étaient donc affichées en permanence — le voile sombre était le fond de
la lightbox (`z-index: 1400`) et les trois carrés gris ses boutons de navigation.
Le JavaScript basculait correctement `element.hidden`, mais sans effet visuel.

*Correctif* : règle globale `[hidden] { display: none !important; }` dans `css/style.css`.
La règle d'impression `.tab-panel[hidden] { display: block !important; }` reste plus
spécifique et continue de fonctionner.

*Non-détection initiale* : les 42 vérifications DOM testaient la **propriété**
`element.hidden`, pas le style calculé — et jsdom n'applique pas `!important`.
La suite `tests/css.test.mjs` rejoue désormais la cascade complète et aurait
attrapé le défaut (vérifié par mutation).

**2. Ouverture en `file://`.**
Les modules ES étant bloqués dans ce mode, `js/app.js` ne s'exécutait jamais :
aucun message ne pouvait s'afficher, puisque le message venait du module.

*Correctifs* :
- `js/boot.js`, script **classique**, affiche la procédure complète avec le chemin
  exact du dossier de l'utilisateur, même quand les modules sont bloqués ;
- chien de garde de 8 s si le module ne démarre pas pour une autre raison ;
- lanceurs double-clic `Lancer-Company-Locator.bat` et `lancer.sh` ;
- `node server.js --open` ouvre le navigateur, et le serveur essaie les 9 ports
  suivants si le port demandé est occupé.


---

## 7. Évolution : vue immersive « Street View » 360°

### Choix technique

Le viewer officiel `@panoramax/web-viewer` (MIT) a été écarté : il embarque Lit, MapLibre, FontAwesome et Photo Sphere Viewer, soit **2,8 Mo** de bundle — incompatible avec l'architecture Vanilla sans framework lourd. L'**iframe officielle** Panoramax, documentée et déjà utilisée par uMap, fournit la même expérience immersive sans ajouter une seule dépendance.

### Trois sources, deux sans clé

| Source | Clé | Statut par défaut |
|---|---|---|
| Panoramax 360° | aucune | **active** |
| Mapillary Embed | aucune pour l'affichage | active si des photos Mapillary ont été trouvées |
| Google Street View | clé gratuite, facturation Cloud requise | **désactivée** |

### Confidentialité

Aucun cadre tiers n'est instancié avant un clic explicite : pas de requête, pas de cookie, pas de contexte de navigation chez le fournisseur. Le cadre est ensuite durci (`sandbox`, `referrerpolicy="no-referrer"`, `loading="lazy"`). Cette conception suit la recommandation communautaire de « click-to-load » pour les iframes Panoramax.

### Défaut trouvé et corrigé pendant le développement

`Number(null)` valant `0`, un paramètre `lat` ou `lon` **absent** était accepté et produisait une vue à `(0, 0)`, dans le golfe de Guinée. Corrigé côté serveur **et** côté client, avec test unitaire dédié et vérification HTTP réelle (`400` pour absent/vide, `302` pour `0,0` légitime).

### Vérification réseau restante

`node tests/live-smoke.mjs` teste désormais **16 points**, dont l'intégrabilité du viewer Panoramax (en-têtes `X-Frame-Options` / `frame-ancestors`), l'accessibilité de l'embed Mapillary sans jeton, et Google Street View si une clé est configurée. Comme pour le reste, ces appels réels n'ont pas pu être exécutés depuis l'environnement de développement restreint.
