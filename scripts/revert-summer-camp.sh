#!/bin/bash
# CrossFit OTL — Summer Camp 2026 Revert Script
# Run this on or after July 25, 2026 to remove the summer camp landing page and popup.
# Usage: bash scripts/revert-summer-camp.sh

set -e

REPO="$HOME/Library/CloudStorage/OneDrive-OnTheLineFitness/GitHub/crossfit-otl"
cd "$REPO"

echo "Pulling latest from main..."
git pull origin main

echo "Removing summer camp nav link from index.html..."
# Remove the nav link block (2 lines)
sed -i '' '/<!-- SUMMER CAMP 2026 NAV LINK — REMOVE AFTER JULY 24 -->/,/<\/li>/{ /Summer Camps/d; /<!-- SUMMER CAMP 2026/d; }' index.html
# More precise: delete the exact two lines
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("index.html")
html = p.read_text()
# Remove nav link block
html = re.sub(
    r'\s*<!-- SUMMER CAMP 2026 NAV LINK[^>]*-->\s*\n\s*<li><a href="/summer-camp\.html"[^<]*</a></li>',
    '',
    html
)
p.write_text(html)
print("  Nav link removed.")
PY

echo "Removing popup CSS from index.html..."
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("index.html")
html = p.read_text()
# Remove the popup CSS block
html = re.sub(
    r'\s*/\* ={5,} SUMMER CAMP POPUP ={5,} \*/.*?/\* ={5,} END SUMMER CAMP POPUP ={5,} \*/',
    '',
    html,
    flags=re.DOTALL
)
p.write_text(html)
print("  Popup CSS removed.")
PY

echo "Removing popup HTML + JS from index.html..."
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("index.html")
html = p.read_text()
# Remove the popup HTML+JS block
html = re.sub(
    r'\s*<!-- ={5,} SUMMER CAMP POPUP ={5,} -->.*?</script>',
    '',
    html,
    flags=re.DOTALL
)
p.write_text(html)
print("  Popup HTML+JS removed.")
PY

echo "Deleting summer-camp.html..."
git rm summer-camp.html

echo "Committing and pushing..."
git add index.html
git commit -m "chore: remove summer camp 2026 landing page and popup — camps ended July 24"
git push origin main

echo ""
echo "Done. crossfit-otl.com will auto-deploy via Vercel in ~1 minute."
echo "Verify at: https://crossfit-otl.com"
