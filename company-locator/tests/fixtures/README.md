# Jeux de données de test

**Ces fichiers sont SYNTHÉTIQUES.** Ils reproduisent la *structure* des réponses
officielles (API Recherche d'entreprises, BAN/Géoplateforme, STAC Panoramax,
Graph API Mapillary) mais les entreprises, adresses, coordonnées et URL d'images
sont fictives.

Ils servent uniquement aux tests automatisés (`tests/unit/`, `tests/dom.test.mjs`)
qui doivent pouvoir s'exécuter sans réseau. **Ils ne sont jamais chargés par
l'application** : `js/app.js` n'importe aucun de ces fichiers, et l'interface
n'expose aucun « mode démo » susceptible d'afficher de fausses données comme
réelles.

Les identifiants SIREN/SIRET utilisés sont syntaxiquement valides (clé de Luhn
correcte) afin de tester réellement les validateurs.
