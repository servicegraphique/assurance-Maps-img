# Rapport de vérification

**Projet** : Company Locator France · **Version** : 1.0.0 · **Date** : 5 novembre 2026

Ce document distingue honnêtement **ce qui a été exécuté et vérifié** de **ce qui doit être confirmé sur une machine disposant d'un accès Internet non restreint**.

---

## 1. Résultats des tests exécutés

### 1.1 Tests unitaires — `npm test`

```
# tests 149
# pass  149
# fail  0
```

| Fichier | Périmètre |
|---|---|
| `tests/unit/utils.test.mjs` | Luhn SIREN/SIRET (cas réels + dérogation La Poste), codes postaux (Corse, DROM, invalides), départements, haversine, emprise France, similarité de chaînes, `RateLimiter`, `TtlCache`, retry/backoff, gestion 429 et `Retry-After`, erreurs typées, échappement HTML, neutralisation d'URL |
| `tests/unit/entreprise-api.test.mjs` | Construction des paramètres, normalisation du schéma officiel, reconstitution des champs masqués, dédoublonnage par SIRET, siège en tête, non-diffusibles, pagination, cache |
| `tests/unit/search.test.mjs` | Validation des critères (aucun appel réseau si invalide), recherche exacte, replis successifs signalés, filtres d'état, tris, score de pertinence, résumé |
| `tests/unit/geocoding.test.mjs` | **Toute l'arbre de décision GPS** : BAN numéro de voie prioritaire, confirmation par `geo_id`, repli SIRENE, précision voie/commune, divergence > 300 m, coordonnées aberrantes, absence de position, non-diffusible, géocodage inverse |
| `tests/unit/export-storage.test.mjs` | CSV (BOM, `;`, CRLF, anti-injection de formule), 23 colonnes, GeoJSON EPSG:4326, export de fiche, paramètres, **historique opt-in**, favoris, photos sourcées, purge, indisponibilité du `localStorage` |
| `tests/unit/images.test.mjs` | Détection du mode Mapillary (proxy / direct / aucun), Panoramax `place_position` + repli `bbox`, filtrage par rayon, tri par distance, dédoublonnage, normalisation des dates/licences, statut par fournisseur, photos complémentaires (source obligatoire), **vue de rue de la carte** (`streetPhotoView` : image, crédit, compteur borné, badge 360° vs photographie plate, refus d'URL non sûre), **cadrage orienté vers l'immeuble** (`bearingDeg`, `panoFrame` : panorama recadré face au bâtiment, décalage borné, centrage par défaut, photographie plate non recadrée) et **choix de la photographie** (`pickStreetPhotoIndex` : façade proche prioritaire, photo plate regardant ailleurs pénalisée, panorama recentrable) |
| `tests/unit/streetview.test.mjs` | Vues immersives : URL Panoramax/Mapillary/Google, cap normalisé et borné, classement sphérique avant plat, disponibilité par source, **refus des coordonnées absentes** (`Number(null) === 0`), aucune clé dans les URL, durcissement du cadre |
| `tests/unit/contact.test.mjs` | **Coordonnées de contact saisies** (l'API officielle ne les publie pas) : normalisation des numéros français (`+33`, `0033`, séparateurs), refus des numéros incomplets, détection fixe/mobile (`0[1-589]` vs `0[67]`), affichage `01 23 45 67 89`, liens `tel:+33…`/`mailto:` jamais fabriqués depuis une saisie invalide, validation croisée (un mobile dans le champ fixe est signalé), enregistrement local par SIRET, purge, présence dans l'export de fiche et dans la charge utile transmise au formulaire |
| `tests/unit/mapillary-config.test.mjs` | **Diagnostic du jeton Mapillary** : nettoyage des valeurs copiées-collées (`Bearer`, guillemets, espaces), distinction Client Token (`MLY|id|secret`) / Client ID (nombre) / secret seul / forme inconnue, composition du jeton à partir de `mapillaryClientId` + `mapillaryClientSecret`, messages actionnables, et **absence de tout fragment de secret dans la charge utile `/api/mapillary/status`** |
| `tests/embed.test.mjs` | **Mode intégré** (`?embed=1`) : lecture des paramètres `nom`/`cp`, charge utile transmise au formulaire, protocole `postMessage` (prêt, résultats, erreur, sélection), recherche demandée par le parent, messages d'une autre origine ignorés, inactivité hors mode intégré |
| `tests/unit/transport.test.mjs` | Correspondance URL publique ↔ relais local pour les trois services, **refus des origines non déclarées**, comportement hors navigateur, propagation des erreurs HTTP métier |

### 1.1 bis Serveur local et jeton Mapillary — `npm run test:server`

```
# tests 11
# pass  11
# fail  0
```

Ce test **démarre le vrai `server.js`** (processus séparé, port dédié, requêtes HTTP
réelles) dans quatre configurations de jeton, puis vérifie :

1. **Client ID seul** → `mapillaryState: "incomplete"`, `/api/mapillary/images` répond
   **501** avec une consigne (« est le Client ID, pas un jeton ») et **aucun appel amont**
   n'est tenté ; ni le secret ni le Client ID n'apparaissent dans les réponses.
2. **Client ID + Client Secret** → jeton `MLY|…` **composé côté serveur**, état `ready`,
   `tokenLength > 0`, et le JSON de statut ne contient **aucun fragment** du secret.
   La bannière de démarrage annonce le jeton sans l'imprimer.
3. **Client Token complet** → état `ready`, secret absent des réponses.
4. **Jeton mal formé** (`MLY|pas-complet`) → état `invalid` et message explicite.
5. **`node server.js --check-mapillary`** → verdict en ligne de commande, **code de sortie
   1** sans jeton utilisable, secret jamais imprimé.
6. **Configuration par fichier** (`CLF_CONFIG_FILE`) : un `server.config.json` réduit au
   Client ID donne `incomplete` ; avec le Client Secret en plus, `ready` — secret absent
   de la réponse.
7. **Priorité des sources** : un jeton explicite (variable d'environnement) est évalué
   seul, il n'est jamais « réparé » par un Client ID resté dans le fichier.
8. **Fichier absent** : `--check-mapillary` affiche le **chemin attendu** (« Fichier :
   introuvable ») et la commande pour le créer, au lieu d'un simple « missing ».
9. **`--set-mapillary-token`** : enregistre le jeton validé (fichier en mode **600**),
   **préserve les autres clés**, ne l'imprime jamais, et le serveur le relit aussitôt
   (`État : ready`).
10. **Jeton refusé** : un Client ID passé à `--set-mapillary-token` sort en **code 1**
    avec l'explication, et **aucun fichier n'est créé** ; appel sans valeur → message
    d'usage.
11. **Fichier avec BOM UTF-8** (Bloc-notes, `Set-Content -Encoding UTF8` sous
    PowerShell 5.1) : le fichier reste lisible (`État : ready`) et la réécriture
    supprime le BOM.

> Les tests pointent `CLF_CONFIG_FILE` vers un fichier temporaire : ils ne dépendent
> jamais du `server.config.json` de la machine (qui contient le vrai jeton).

> Aucune requête ne part réellement vers Mapillary dans ces tests : seuls les cas
> `ready` vérifient l'état local. Le verdict « ✔ Jeton accepté » de `--check-mapillary`
> doit être confirmé sur votre poste (`graph.mapillary.com` est inaccessible ici).

### 1.2 Cascade CSS — `npm run test:css`

```
17/17 vérifications CSS réussies.
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

### 1.4 Intégration DOM du mode intégré — `npm run test:embed`

```
5/5 vérifications réussies.
```

`index.html` est ouvert avec `?embed=1&nom=Allianz&cp=75015` (comme depuis le
formulaire d'assurance) : classe `is-embed` posée, recherche lancée
automatiquement, messages `locator:ready` / `locator:results` reçus par un
parent simulé, puis sélection d'un établissement et envoi de
`locator:selected` (SIRET, adresse, GPS) après clic sur « Utiliser cette
entreprise ».

### 1.5 Intégration DOM — `npm run test:dom`

```
59/59 vérifications réussies.
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
8 bis. **Coordonnées de contact** : bloc présent dans l'onglet Informations avec la mention « Non renseignées » et l'avertissement sur l'API officielle ; saisie (fixe, mobile, e-mail, personne à joindre, note) → numéros normalisés et formatés, liens `tel:`/`mailto:` corrects, badge « Saisie manuelle », enregistrement local par SIRET ; un mobile saisi dans le champ « fixe » est **refusé avec un message** et n'écrase pas la valeur enregistrée ; les coordonnées **survivent au re-rendu** de la fiche (bascule favori).
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
| `GET /api/mapillary/status` sans jeton | `{"configured":false,"mode":"none","state":"missing",…}` — message d'aide |
| `GET /api/mapillary/status` avec un **Client ID seul** | `state:"incomplete"`, message « est le Client ID, pas un jeton », `tokenLength:0` — **aucun appel amont** |
| `GET /api/mapillary/images` avec un Client ID seul | **HTTP 501** « Configuration Mapillary incomplète », aucune requête vers Mapillary |
| `GET /api/mapillary/status` avec Client ID + Secret | `configured:true`, `state:"ready"`, `tokenLength>0`, **ni l'ID ni le secret dans la réponse** |
| `GET /api/health` | expose `mapillaryConfigured` **et** `mapillaryState` (`ready`/`incomplete`/`invalid`/`missing`) |
| `node server.js --check-mapillary` sans jeton utilisable | verdict lisible, **code de sortie 1**, secret jamais imprimé ; le **chemin du fichier** est indiqué (`Fichier : …` / `introuvable`) |
| `node server.js --set-mapillary-token "MLY|…"` | jeton validé puis écrit dans `server.config.json` en **mode 600**, autres clés préservées, jeton jamais imprimé |
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
| **Forme du jeton Mapillary** | Tableau de bord Mapillary, documentation API v4 et retours de la communauté (forum Mapillary, connecteurs) | Le jeton utilisable est le **Client Token** `MLY|<client_id>|<client_secret>` ; le **Client ID** seul (nombre) ne permet aucun appel. Vérifié et encodé dans `js/mapillary-config.js` |
| **Aucune coordonnée de contact dans l'API** | Schéma officiel `search-api` (`app/models/unite_legale.py`, `formatters/etablissements.py`) et réponses réelles du service | Ni téléphone, ni e-mail, ni personne à joindre : le champ `contact` du service porte l'**adresse de contact** de l'INSEE, pas un numéro. D'où la saisie manuelle, stockée localement et signalée comme telle |

---

## 3. Ce qui n'a **pas** pu être vérifié ici

> **L'environnement de développement restreint les sorties réseau** à quelques domaines (`github.com`, `registry.npmjs.org`, `pypi.org`). Les domaines `recherche-entreprises.api.gouv.fr`, `data.geopf.fr`, `api.panoramax.xyz`, `tile.openstreetmap.org` et `graph.mapillary.com` y sont **injoignables**. Aucun navigateur graphique n'y est disponible non plus.

Par conséquent, **n'ont pas été exécutés depuis cet environnement** :

- les appels HTTP réels aux API publiques, dont **Mapillary** (`graph.mapillary.com`)
  — d'où le test d'intégration local du serveur, et la commande `--check-mapillary`
  prévue pour votre poste ;
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

1. Dans <https://www.mapillary.com/dashboard/developers>, ouvrez votre application
   (« View ») et copiez le **Client Token** complet — `MLY|<client_id>|<client_secret>`.
   Le **Client ID** seul (un nombre) ne suffit pas.
2. Collez-le dans `company-locator/server.config.json`, soit dans `mapillaryToken`,
   soit en séparant `mapillaryClientId` + `mapillaryClientSecret`.
3. `cd company-locator && node server.js --check-mapillary` → attendu :
   `✔ Jeton accepté par Mapillary (HTTP 200)`.
4. `node server.js`, puis ouvrir les paramètres de l'application : le panneau
   « Mapillary » doit afficher **« proxy local sécurisé »**. Dans le panneau d'état des
   services, la ligne Mapillary passe au vert, et les photos Mapillary apparaissent à
   côté de celles de Panoramax dans l'onglet Images.
5. `node tests/live-smoke.mjs` : la ligne Mapillary doit également passer au vert.

---

## 5. Synthèse

| Domaine | Statut |
|---|---|
| Logique métier (recherche, normalisation, GPS, exports, stockage, images, contacts, jeton Mapillary) | ✅ **149 tests unitaires exécutés et verts** |
| Serveur local et configuration du jeton Mapillary | ✅ **11 tests d'intégration exécutés et verts** (processus réel, HTTP réel) |
| Cascade CSS et éléments masqués | ✅ **17 vérifications exécutées et vertes** (test par mutation validé) |
| Garde de démarrage (`file://`, chien de garde) | ✅ **14 vérifications exécutées et vertes** |
| Interface et parcours complet | ✅ **59 vérifications DOM exécutées et vertes**, 0 erreur JS |
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
