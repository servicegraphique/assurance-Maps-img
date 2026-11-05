#!/usr/bin/env sh
# ===================================================================
#  Formulaire Assurance TNS Pro — lanceur macOS / Linux
#  chmod +x lancer-formulaire.sh   puis   ./lancer-formulaire.sh
#  Le localisateur d'entreprises (company-locator) exige http:// :
#  n'ouvrez jamais index.html en double-cliquant.
# ===================================================================
set -eu
cd "$(dirname "$0")/.."

echo ""
echo "  ============================================================"
echo "   Formulaire Assurance TNS Pro"
echo "   Etape « Localisez votre entreprise » (localisateur integre)"
echo "  ============================================================"
echo ""
echo "  Dossier : $(pwd)"
echo ""

if command -v node >/dev/null 2>&1; then
  echo "  [OK] Node.js détecté. Démarrage du serveur local (relais d'API inclus)."
  echo "  Pour arrêter : Ctrl + C"
  echo ""
  STATIC_ROOT=. exec node company-locator/server.js --open --path assurance-tns-pro-v2-adw/ --home assurance-tns-pro-v2-adw/
fi

echo "  [!] Node.js est absent : serveur statique Python (mode dégradé)."
echo "      Sans relais d'API, certaines recherches peuvent être bloquées."
echo "      Installez Node.js (gratuit) : https://nodejs.org"
echo ""
( sleep 1; (command -v open >/dev/null 2>&1 && open http://localhost:8080/assurance-tns-pro-v2-adw/) \
  || (command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:8080/assurance-tns-pro-v2-adw/) ) >/dev/null 2>&1 &
exec python3 -m http.server 8080
