# Étape « Localisez votre entreprise » — localisateur intégré

Cette étape remplace l'ancien module de localisation maison
(`localisation.js`, `localisation-core.js`, `localisation.css`, `vendor/leaflet/`),
**supprimés du dossier**. Elle s'appuie désormais sur le **localisateur
d'entreprises** (`../company-locator/`) : recherche officielle par nom + code
postal, carte (OSM, IGN, photo aérienne, vue de rue), fiche de l'établissement
et position GPS.

## Parcours

```
… → « Quelle est la société concernée ? » (nom + code postal)
   → « Localisez votre entreprise »  ← localisateur intégré
   → « Votre société existe-t-elle déjà ? »
   → nom / prénom → téléphone → envoi
```

- L'étape « société » ne demande plus la **rue** ni la **ville** : seuls le nom
  de société et le code postal sont saisis. Deux champs cachés `adresse` et
  `ville` restent présents dans le formulaire et sont remplis automatiquement
  par le localisateur (colonnes historiques du CRM et du Google Sheet).
- Le localisateur se charge **automatiquement** à l'affichage de l'étape, avec
  le nom et le code postal déjà saisis : aucune ressaisie.

## Ce que voit le visiteur

1. Le localisateur s'ouvre en mode intégré (`?embed=1`) : résultats, carte et
   fiche, sans l'habillage public de l'application.
2. Les résultats de l'API officielle **Recherche d'entreprises** s'affichent
   pour son nom et son code postal.
3. Il clique sur son établissement : adresse exacte, SIRET, GPS et vues
   (plan OSM / plan IGN / photo aérienne / **Street View**) sont disponibles.
4. Il clique sur **« Utiliser cette entreprise »** : le récapitulatif apparaît
   sous le localisateur et le bouton « Suivant » se débloque.
5. Sans sélection, « Suivant » explique quoi faire et propose « Je renseignerai
   ces informations plus tard » : un lead n'est jamais bloqué.

## Champs transmis au lead

| Champ | Contenu |
|---|---|
| `loc_entreprise` | Nom affiché de l'établissement |
| `loc_siret`, `loc_siren` | Identifiants officiels |
| `loc_adresse` | Adresse complète (rue, code postal, commune) |
| `loc_code_postal`, `loc_commune` | Commune et code postal |
| `loc_latitude`, `loc_longitude` | Position GPS (BAN / SIRENE) |
| `loc_precision`, `loc_source` | Niveau de précision et source du géocodage |
| `loc_naf` | Activité principale (NAF/APE) |
| `loc_page` | Fiche Annuaire des entreprises |
| `adresse`, `ville` | Champs cachés historiques, remplis automatiquement |

Un récapitulatif lisible est ajouté à `autre_info_fj` (visible dans Google
Sheets). `lead-handler.js` lit ces valeurs via `window.LocalisateurEntreprise`.

> Le script Apps Script doit exposer les nouvelles colonnes `loc_entreprise`,
> `loc_siret`, `loc_siren`, `loc_code_postal`, `loc_commune`, `loc_precision`,
> `loc_source`, `loc_naf`, `loc_page` s'il filtre les paramètres reçus.

## Protocole iframe ↔ formulaire (`postMessage`)

Le localisateur envoie au parent :

```js
{ source: 'company-locator', type: 'locator:ready' }
{ source: 'company-locator', type: 'locator:results', payload: { count, rows } }
{ source: 'company-locator', type: 'locator:error', payload: { message } }
{ source: 'company-locator', type: 'locator:selected', payload: { siret, siren, nom, … } }
```

Le formulaire envoie à l'iframe :

```js
{ source: 'tns-form', type: 'locator:search', payload: { nom, codePostal } }
```

Seuls les messages dont la source correspond à la fenêtre de l'iframe sont
acceptés ; aucun message d'une autre origine n'est traité.

## Héberger le formulaire avec le localisateur

Le localisateur est une application à modules ES : **elle exige une adresse
`http(s)://`**. Ouvrir `index.html` en double-cliquant (`file://`) affiche un
message de repli avec un lien direct, mais la localisation ne fonctionne pas.

### En local (recommandé)

```bash
# depuis la racine du dépôt
cd company-locator
STATIC_ROOT=.. node server.js --open --path assurance-tns-pro-v2-adw/
```

ou, plus simplement, le lanceur fourni dans ce dossier :

- Windows : double-clic sur **`Lancer-Formulaire-TNS.bat`**
- macOS / Linux : `./lancer-formulaire.sh`

Le serveur local sert **le formulaire et le localisateur** sur la même origine
et fournit le relais d'API (`/api/proxy/...`), ce qui évite tout blocage CORS.

### En production

Déposez le dossier `company-locator/` **à côté** du dossier du formulaire, de
sorte que `../company-locator/index.html` réponde. Pour héberger le localisateur
ailleurs (autre sous-domaine, CDN), deux solutions sans toucher au JavaScript :

```html
<!-- 1. changer l'attribut data-src de l'iframe -->
<iframe id="loc-app" data-loc-app data-src="https://locator.exemple.fr/index.html?embed=1">
```

```html
<!-- 2. ou déclarer l'adresse avant localisateur.js -->
<script>window.LOCALISATEUR_CONFIG = { frameSrc: 'https://locator.exemple.fr/index.html?embed=1' };</script>
```

Dans les deux cas, l'URL doit contenir `embed=1` (mode intégré).

> **Attention** : l'API Recherche d'entreprises est conçue pour des appels
> serveur. En production, faites suivre `/api/proxy/entreprises/...` vers
> `https://recherche-entreprises.api.gouv.fr/...` (reverse proxy), sinon le
> navigateur peut bloquer les appels directs (`company-locator/server.js` le
> fait déjà en local).

## Configuration

```js
window.LOCALISATEUR_CONFIG = {
  readyTimeoutMs: 9000,           // délai avant d'afficher le repli
  frameSrc: ''                    // URL personnalisée du localisateur
};
```

## Accessibilité et vie privée

- L'iframe possède un titre explicite ; l'étape est annoncée par `role="status"`
  (messages) et `role="alert"` (garde-fou).
- Aucune clé d'API, aucun traceur publicitaire ; les données saisies restent
  dans la page jusqu'à l'envoi du formulaire.
- Aucun champ n'est prérempli avec une adresse inventée : si l'entreprise n'est
  pas trouvée, le visiteur peut continuer ou préciser lui-même.

## Tests

```bash
cd tests && npm ci && npm test
```

8 tests couvrent : suppression des champs rue/ville, remplacement du module,
chaîne des étapes, chargement de l'iframe avec nom + code postal, protocole
`postMessage` (recherche et sélection), garde-fou avant l'étape suivante,
localisateur injoignable (repli) et colonnes du lead.

Côté localisateur : `cd company-locator && npm run test:all` (dont
`npm run test:embed`, parcours complet en mode `?embed=1`).
