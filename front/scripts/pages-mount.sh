#!/usr/bin/env bash
# Builds the folder published on GitHub Pages (.github/workflows/pages.yml), from front/:
#   /<repo>/       the demo (example portfolio and guided tour, no back end)
#   /<repo>/app/   the real app, calling the API on the server (only when API_URL is given)
# Both get a Content-Security-Policy (Pages cannot send headers: it goes in a <meta>). Run from front/:
#   bash scripts/pages-mount.sh <repo name> <out folder> [API_URL]
set -euo pipefail

repo="${1:?Falta el nombre del repositorio}"
out="${2:?Falta la carpeta de salida}"
api="${3:-}"
origin_file="src/app/core/api-origin.ts"

# CSP: only this site's own scripts; data only from the site itself (demo) and the API (app).
csp() {
  local connect="'self'${1:+ $1}"
  echo "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src $connect; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests"
}
add_csp() { # add_csp <index.html> <api or empty>
  local tag="<meta http-equiv=\"Content-Security-Policy\" content=\"$(csp "$2")\">"
  sed -i "s#<meta charset=\"utf-8\">#<meta charset=\"utf-8\">\n  ${tag}#" "$1"
  grep -q 'Content-Security-Policy' "$1"
}

rm -rf "$out"
mkdir -p "$out"

# 1. Demo at the root (DEMO_ONLY stays null: on github.io it only runs the demo).
npx ng build --base-href "/$repo/"
cp -r dist/front/browser/. "$out/"
add_csp "$out/index.html" ""

# 2. Real app at /app/, built against the server.
if [ -n "$api" ]; then
  [[ "$api" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo "API_URL debe ser https://dominio, sin barra final" >&2; exit 1; }
  cp "$origin_file" /tmp/api-origin.ts.bak
  sed -i "s#^export const API_ORIGIN = .*#export const API_ORIGIN = '$api';#; s#^export const DEMO_ONLY: boolean | null = .*#export const DEMO_ONLY: boolean | null = false;#" "$origin_file"
  grep -q "API_ORIGIN = '$api'" "$origin_file" && grep -q "DEMO_ONLY: boolean | null = false" "$origin_file"
  npx ng build --base-href "/$repo/app/"
  cp /tmp/api-origin.ts.bak "$origin_file"
  mkdir -p "$out/app"
  cp -r dist/front/browser/. "$out/app/"
  add_csp "$out/app/index.html" "$api"
fi

# 3. Pages has no URL rewriting: 404.html keeps the address asked for and opens the right app (main.ts puts it back).
cat > "$out/404.html" <<EOF
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-REPLACE'">
<title>Finanzas</title>
<script>try{sessionStorage.setItem('finanzas.redirect',location.pathname+location.search+location.hash)}catch(e){}location.replace(location.pathname.indexOf('/$repo/app/')===0?'/$repo/app/':'/$repo/')</script>
EOF
# Allow exactly that inline script (its hash), nothing else.
script="$(sed -n 's#.*<script>\(.*\)</script>.*#\1#p' "$out/404.html")"
hash="$(printf '%s' "$script" | openssl dgst -sha256 -binary | openssl base64 -A)"
sed -i "s#sha256-REPLACE#sha256-$hash#" "$out/404.html"
echo "Pages montado en $out (app real: ${api:-no})"
