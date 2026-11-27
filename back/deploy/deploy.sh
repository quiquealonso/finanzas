#!/usr/bin/env bash
# Deploys the API on the VM. GitHub Actions runs it over SSH with the deploy key, which in ~/.ssh/authorized_keys can
# only run this script (command="..."): it receives the commit to deploy. It runs the copy ~/finanzas/deploy.sh
# (outside the repository); after each deployment it is updated with this one. See docs/09-despliegue.md.
#
#   ssh finanzas@VM <sha>               (from Actions)
#   ~/finanzas/deploy.sh <sha>          (by hand, on the VM)
#
# 1. Checks that the commit is on main  2. Builds and starts  3. Waits for the API; if it does not answer, goes back
# to the previous commit. The database is Supabase: back it up from your computer (node back/scripts/db-backup.js).
#
# Everything is inside main() so bash reads it whole before running it: the checkout itself changes this file.
set -euo pipefail

main() {
  local sha="${1:-${SSH_ORIGINAL_COMMAND:-}}"
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Uso: deploy.sh <sha de 40 caracteres>" >&2
    exit 2
  fi

  local repo="$HOME/finanzas/app"
  local deploy_dir="$repo/back/deploy"
  cd "$repo"

  git fetch --quiet origin main
  if ! git merge-base --is-ancestor "$sha" origin/main; then
    echo "El commit $sha no esta en main: no se despliega" >&2
    exit 3
  fi
  local previous
  previous="$(git rev-parse HEAD)"
  echo "== Desplegando $sha (antes: $previous)"
  git checkout --quiet --detach "$sha"

  cd "$deploy_dir"
  chmod 600 .env
  docker compose up -d --build --remove-orphans
  if wait_healthy; then
    docker image prune -f > /dev/null
    install -m 755 "$deploy_dir/deploy.sh" "$HOME/finanzas/deploy.sh"
    echo "== Desplegado $sha"
    return 0
  fi

  echo "== La API no responde: vuelvo a $previous" >&2
  docker compose logs --tail 80 api >&2 || true
  cd "$repo" && git checkout --quiet --detach "$previous" && cd "$deploy_dir"
  docker compose up -d --build --remove-orphans
  wait_healthy || true
  echo "== Despliegue fallido" >&2
  exit 1
}

# The API is ready when it answers over HTTPS through Caddy (up to 3 minutes: build and start).
wait_healthy() {
  local domain
  domain="$(grep '^API_DOMAIN=' .env | cut -d= -f2)"
  for _ in $(seq 1 36); do
    if curl -fsS -o /dev/null --max-time 5 "https://$domain/api/auth/register"; then
      return 0
    fi
    sleep 5
  done
  return 1
}

main "$@"; exit $?
