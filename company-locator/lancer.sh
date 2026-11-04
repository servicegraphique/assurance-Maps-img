#!/usr/bin/env sh
# ===================================================================
#  Company Locator France — lanceur macOS / Linux
#  Rendu exécutable : chmod +x lancer.sh   puis   ./lancer.sh
#  N'ouvrez jamais index.html directement (file://).
# ===================================================================
set -eu
cd "$(dirname "$0")"

echo ""
echo "  ============================================================"
echo "   Company Locator France"
echo "   Recherche, géolocalisation et imagerie d'entreprises"
echo "  ============================================================"
echo ""
echo "  Dossier : $(pwd)"
echo ""

if command -v node >/dev/null 2>&1; then
  echo "  [OK] Node.js détecté. Démarrage du serveur local…"
  echo "  Le navigateur va s'ouvrir automatiquement."
  echo "  Pour arrêter : Ctrl + C"
  echo ""
  exec node server.js --open
fi

if command -v python3 >/dev/null 2>&1; then
  echo "  [!] Node.js est absent : démarrage en MODE DÉGRADÉ avec Python."
  echo "      La recherche d'entreprises peut être bloquée par CORS."
  echo "      Installez Node.js (gratuit) : https://nodejs.org"
  echo ""
  ( sleep 1; (command -v open >/dev/null 2>&1 && open http://localhost:8080/) \
    || (command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:8080/) ) >/dev/null 2>&1 &
  exec python3 -m http.server 8080
fi

echo "  [ERREUR] Ni Node.js ni Python 3 n'est installé."
echo "  Installez Node.js gratuitement : https://nodejs.org"
exit 1
