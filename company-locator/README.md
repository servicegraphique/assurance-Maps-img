# Company Locator France — Fiche de qualification & localisation (v2.0)

Application web autonome (HTML, CSS, JavaScript ES Modules, serveur Node.js sans dépendance) affichant la **fiche complète d'un établissement français** à partir de son SIRET, SIREN, nom ou code postal :

- **Coordonnées Acheteurs** : logo de société, raison sociale, nom commercial / enseigne, adresse, statut SIRENE (`Entreprise active` / `Entreprise cessée`), SIRET copiable, N° tél standard, code NAF et libellé INSEE, date de création, tranche d'effectif, type d'entité, site web, historique de commentaires extensible (`Voir plus`), et bloc **Acheteur** (civilité, prénom, nom, fonction, e-mail, ligne directe, création d'une nouvelle fiche sur cette société ou une autre, historique des qualifications).
- **Demande de devis** : référence, date, catégorie, critères, historique de la demande, origine (`Demande Hellodevis`), filière (`FSI Installateurs`), conseiller + écoute / mémo audio, renvoi des coordonnées fournisseurs et suivi Lead indicateur BIMP.
- **Localisation & Vue satellite** : carte interactive (Plan IGN V2 / OpenStreetMap) ouvrant en **premier aperçu sur la carte de France entière** avec l'épingle du site (zoom ensuite à la molette / double-clic ou via l'agrandissement), adresse formatée, coordonnées GPS et altitude (IGN RGE ALTI / Open-Meteo), plus orthophotographie aérienne haute résolution (IGN BD ORTHO HR) avec bouton **Ouvrir dans Google Earth**.
- **Météo actuelle** : température, état du ciel, vent (vitesse + direction cardinale), humidité, précipitations et horodatage via Open-Meteo.
- **Note financière (estimée)** : jauge sur 100, niveau de risque, solvabilité, tendance, dernier bilan, sources (SIRENE / INPI) et modale de détail financier.
- **Consommation d'électricité (estimée)** : estimation mensuelle et annuelle (kWh), histogramme sur 12 mois (`J` à `D`) et modale de détail par usage.
- **Vue de la rue** : photographie de façade réelle (Google Street View si configuré, Panoramax, Mapillary) avec navigation et bouton **Ouvrir dans Google Street View**.
- **5 indicateurs de site** : `Surface bâtiment` (emprise IGN BD TOPO), `Potentiel solaire`, `Population` (nombre d'habitants de la commune via l'API Géo France), `Département` et `Région` (codes et libellés INSEE, repli local hors-ligne).
- **Suivi commercial** : sections dépliables `RAC`, `Prelead`, `Génération de lead` et bloc `Mise en relation` (`Faire une mise en relation`).

Toutes les saisies CRM sont enregistrées localement par SIRET dans le navigateur (`localStorage`). La barre de recherche en haut peut être masquée en un clic (`Masquer`) pour afficher uniquement la fiche plein écran (et réaffichée via le bouton discret en haut à droite ou le raccourci `/`).

## Démarrage

Prérequis : **Node.js 18+** (aucun `npm install` requis pour lancer l'application).

```bash
cd company-locator
node server.js
```

Puis ouvrir `http://localhost:8080/` (ou double-cliquer sur `Lancer-Company-Locator.bat` sous Windows).

### Paramètres d'URL

- `/?siret=88329230200014` ou `/#siret=88329230200014` : ouvre directement la fiche de l'établissement.
- `/?nom=Abiotech&cp=13340` : lance la recherche au chargement.
- `/?empty=1` : ouvre une fiche vierge prête pour une nouvelle recherche.
- `/?embed=1&nom=...&cp=...` : mode intégré pour le formulaire `assurance-tns-pro-v2-adw`.

### Configuration optionnelle (Mapillary / Google Street View)

Copier `server.config.example.json` en `server.config.json` (ignoré par Git) :

```bash
node server.js --set-mapillary-token "MLY|..."
node server.js --check-mapillary
```

## Tests

```bash
npm test              # 126 tests unitaires (sans dépendance externe)
npm run test:server   # 13 tests du serveur et des relais HTTP
npm run test:all      # Suite complète (inclut CSS, boot, DOM et mode intégré avec jsdom)
```
