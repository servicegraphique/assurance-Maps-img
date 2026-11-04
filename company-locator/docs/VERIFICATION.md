# Rapport de vérification

**Projet** : Company Locator France · **Version** : 1.0.0 · **Date** : 4 novembre 2026

Ce document distingue honnêtement **ce qui a été exécuté et vérifié** de **ce qui doit être confirmé sur une machine disposant d'un accès Internet non restreint**.

---

## 1. Résultats des tests exécutés

### 1.1 Tests unitaires — `npm test`

```
# tests 101
# pass  101
# fail  0
```

| Fichier | Périmètre |
|---|---|
| `tests/unit/utils.test.mjs` | Luhn SIREN/SIRET (cas réels + dérogation La Poste), codes postaux (Corse, DROM, invalides), départements, haversine, emprise France, similarité de chaînes, `RateLimiter`, `TtlCache`, retry/backoff, gestion 429 et `Retry-After`, erreurs typées, échappement HTML, neutralisation d'URL |
| `tests/unit/entreprise-api.test.mjs` | Construction des paramètres, normalisation du schéma officiel, reconstitution des champs masqués, dédoublonnage par SIRET, siège en tête, non-diffusibles, pagination, cache |
| `tests/unit/search.test.mjs` | Validation des critères (aucun appel réseau si invalide), recherche exacte, replis successifs signalés, filtres d'état, tris, score de pertinence, résumé |
| `tests/unit/geocoding.test.mjs` | **Toute l'arbre de décision GPS** : BAN numéro de voie prioritaire, confirmation par `geo_id`, repli SIRENE, précision voie/commune, divergence > 300 m, coordonnées aberrantes, absence de position, non-diffusible, géocodage inverse |
| `tests/unit/export-storage.test.mjs` | CSV (BOM, `;`, CRLF, anti-injection de formule), 23 colonnes, GeoJSON EPSG:4326, export de fiche, paramètres, **historique opt-in**, favoris, photos sourcées, purge, indisponibilité du `localStorage` |
| `tests/unit/images.test.mjs` | Détection du mode Mapillary (proxy / direct / aucun), Panoramax `place_position` + repli `bbox`, filtrage par rayon, tri par distance, dédoublonnage, normalisation des dates/licences, statut par fournisseur, photos complémentaires (source obligatoire) |
| `tests/unit/transport.test.mjs` | Correspondance URL publique ↔ relais local pour les trois services, **refus des origines non déclarées**, comportement hors navigateur, propagation des erreurs HTTP métier |

### 1.2 Intégration DOM — `npm run test:dom`

```
42/42 vérifications réussies.
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
12. Bascule fond de carte ↔ photographie aérienne, plein écran.
13. Exports : CSV résultats, GeoJSON, CSV fiche — noms de fichiers et contenus vérifiés.
14. Enregistrement d'une fiche en favori.
15. Paramètres : état du stockage, mode Mapillary, chemin réseau.
16. Historique **opt-in** : rien avant activation, puis recherches, fiches consultées et fiches enregistrées dans les trois onglets.
17. Recherche sans résultat → message explicite.
18. Code postal invalide → refus **avant tout appel réseau**.
19. **0 erreur JavaScript** sur l'ensemble du parcours.
20. **0 appel à un service payant ou non déclaré.**
21. **0 jeton secret** dans les requêtes émises par le navigateur.

### 1.3 Serveur local — vérifications HTTP réelles

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
| Logique métier (recherche, normalisation, GPS, exports, stockage, images) | ✅ **101 tests unitaires exécutés et verts** |
| Interface et parcours complet | ✅ **42 vérifications DOM exécutées et vertes**, 0 erreur JS |
| Serveur local, ressources, sécurité | ✅ **vérifié par requêtes HTTP réelles** |
| Contrats des API (URL, paramètres, champs, quotas, licences) | ✅ **vérifiés sur les sources officielles** |
| Appels réseau réels aux API publiques | ⏳ **à exécuter sur votre poste** — `node tests/live-smoke.mjs` |
| Rendu visuel navigateur réel | ⏳ **à confirmer visuellement** — recette en 15 points ci-dessus |
