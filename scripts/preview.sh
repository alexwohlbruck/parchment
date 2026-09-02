#!/usr/bin/env bash
#
# preview — one Parchment stack per branch, reachable from anywhere on the tailnet.
#
# Each preview gets its own git worktree, its own copy of the dev database, its
# own server/web ports, and its own public URL. The heavy shared things — the
# Postgres server and Barrelman — are not duplicated: previews clone the small
# parchment database (~26MB) and talk to the same Barrelman instance.
#
# The point is to review a branch from a phone. `preview up` on a feature branch
# prints a link you can open on the subway; the branch keeps hot-reloading, so
# fixes land without rebuilding anything.
#
#   preview up [branch]   start (or restart) a preview; creates the worktree if needed
#   preview down [branch] stop it, drop its database, release the slot
#   preview ls            list running previews and their URLs
#   preview url [branch]  print just the web URL
#   preview pr [branch]   push the branch and put the preview link on its PR
#   preview logs [branch] follow the server + web logs
#
# With no branch argument, commands act on the worktree you are currently in —
# so an agent session working in a worktree can simply run `preview up`.
#
# Each preview names its browser tab after the branch's pull request title, or
# the branch name until there is one, so a row of preview tabs can be told
# apart. PREVIEW_LABEL=... overrides it.
#
# Slot 0 is reserved for the main checkout tracking `dev`: it runs against the
# real `parchment` database on fixed ports, as a stable always-on instance.
set -euo pipefail

MAIN_REPO=${PARCHMENT_MAIN_REPO:-$HOME/Documents/code/parchment}
STATE_DIR=${PARCHMENT_PREVIEW_STATE:-$HOME/.parchment-preview}
UNIT_DIR="$HOME/.config/systemd/user"
BASE_DB=${PARCHMENT_BASE_DB:-parchment}
PG_HOST=${PARCHMENT_PG_HOST:-127.0.0.1}
PG_PORT=${PARCHMENT_PG_PORT:-5432}
DB_CONTAINER=${PARCHMENT_DB_CONTAINER:-parchment-db}
MAX_SLOT=8

# Port plan. Deliberately clear of 5000/5173 (the classic dev pair), 5001-5004
# (barrelman family), and 5432-5434 (databases).
server_port() { echo $((5100 + $1)); }
web_port()    { echo $((5180 + $1)); }
api_pub_port() { echo $((8500 + $1)); }
web_pub_port() { echo $((8400 + $1)); }

BUN=${BUN:-$HOME/.bun/bin/bun}
REGISTRY="$STATE_DIR/registry"

die() { echo "preview: $*" >&2; exit 1; }
log() { echo "  $*"; }

# ── state ────────────────────────────────────────────────────────────────────

ensure_state() {
  mkdir -p "$STATE_DIR" "$UNIT_DIR"
  [ -f "$REGISTRY" ] || : > "$REGISTRY"
}

# registry lines: slot<TAB>branch<TAB>worktree<TAB>scheme<TAB>host
registry_get_slot_for_branch() { awk -F'\t' -v b="$1" '$2==b{print $1; exit}' "$REGISTRY"; }
registry_branch_for_slot()     { awk -F'\t' -v s="$1" '$1==s{print $2; exit}' "$REGISTRY"; }
registry_field() { awk -F'\t' -v s="$1" -v n="$2" '$1==s{print $n; exit}' "$REGISTRY"; }

registry_remove_slot() {
  local slot=$1 tmp
  tmp=$(mktemp)
  awk -F'\t' -v s="$slot" '$1!=s' "$REGISTRY" > "$tmp"
  mv "$tmp" "$REGISTRY"
}

registry_put() {
  registry_remove_slot "$1"
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >> "$REGISTRY"
}

allocate_slot() {
  local branch=$1 existing s
  existing=$(registry_get_slot_for_branch "$branch")
  if [ -n "$existing" ]; then echo "$existing"; return; fi
  for s in $(seq 1 $MAX_SLOT); do
    if [ -z "$(registry_branch_for_slot "$s")" ]; then echo "$s"; return; fi
  done
  die "all $MAX_SLOT preview slots are in use — 'preview down <branch>' to free one"
}

# ── tailnet ──────────────────────────────────────────────────────────────────

ts_host() {
  tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//'
}

ts_ip() { tailscale ip -4 2>/dev/null | head -1; }

# Publish a local port on the tailnet. Prefers HTTPS via `tailscale serve`,
# which needs HTTPS certificates enabled for the tailnet (admin console → DNS →
# HTTPS Certificates). Without them we fall back to the raw tailnet IP, and the
# caller warns that browser geolocation will be unavailable — mobile browsers
# only expose it in a secure context, which matters for a maps app.
#
# `tailscale serve` blocks while it tries to provision the certificate, and on a
# tailnet without HTTPS enabled that wait never ends — so it is bounded here
# rather than left to hang the whole command.
publish() {
  local pub_port=$1 local_port=$2
  if timeout 25 tailscale serve --bg --https="$pub_port" "http://127.0.0.1:$local_port" >/dev/null 2>&1; then
    echo https
  else
    timeout 10 tailscale serve --https="$pub_port" off >/dev/null 2>&1 || true
    echo http
  fi
}

unpublish() {
  local pub_port=$1
  tailscale serve --https="$pub_port" off >/dev/null 2>&1 || true
}

# ── database ─────────────────────────────────────────────────────────────────

env_value() { sed -n "s/^$2=//p" "$1" | head -1; }

psql_base() {
  PGPASSWORD="$PGPW" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PGUSER" -d postgres "$@"
}

load_db_creds() {
  local envfile="$MAIN_REPO/.env"
  [ -f "$envfile" ] || die "no .env in $MAIN_REPO — previews copy their config from it"
  PGUSER=$(env_value "$envfile" POSTGRES_USER)
  PGPW=$(env_value "$envfile" POSTGRES_PASSWORD)
  [ -n "$PGUSER" ] && [ -n "$PGPW" ] || die "POSTGRES_USER/POSTGRES_PASSWORD missing from $envfile"
}

# A preview gets a copy of the dev database rather than sharing it, so a branch
# can run its own drizzle migrations (or wreck its own data) without touching
# the main instance or another branch. The database is small enough that a
# dump/restore is a couple of seconds; CREATE DATABASE ... TEMPLATE is not an
# option because it requires zero connections to the template.
table_count() {
  PGPASSWORD="$PGPW" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PGUSER" -d "$1" -tAc \
    "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0
}

clone_db() {
  local target=$1
  if psql_base -tAc "select 1 from pg_database where datname='$target'" | grep -q 1; then
    if [ "$(table_count "$target")" -gt 0 ]; then
      log "database $target already exists — reusing it"
      return
    fi
    log "database $target exists but is empty — refilling it"
  else
    psql_base -q -c "CREATE DATABASE \"$target\""
  fi

  log "cloning $BASE_DB → $target"
  # pg_dump refuses to talk to a server newer than itself, and the container's
  # Postgres major version moves independently of whatever client is installed
  # on the host — so the dump runs inside the container, where they always match.
  docker exec -e PGPASSWORD="$PGPW" "$DB_CONTAINER" \
      pg_dump -h 127.0.0.1 -U "$PGUSER" -d "$BASE_DB" --no-owner --no-acl \
    | docker exec -i -e PGPASSWORD="$PGPW" "$DB_CONTAINER" \
      psql -h 127.0.0.1 -U "$PGUSER" -d "$target" -q -o /dev/null 2>&1 \
    | grep -viE 'already exists|multiple primary keys' || true

  [ "$(table_count "$target")" -gt 0 ] || die "clone of $BASE_DB into $target produced no tables"
}

drop_db() {
  local target=$1
  psql_base -tAc "select 1 from pg_database where datname='$target'" | grep -q 1 || return 0
  log "dropping database $target"
  psql_base -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$target'" >/dev/null
  psql_base -q -c "DROP DATABASE \"$target\""
}

# ── systemd units ────────────────────────────────────────────────────────────

install_units() {
  cat > "$UNIT_DIR/parchment-preview-server@.service" <<'UNIT'
[Unit]
Description=Parchment preview API (slot %i)
After=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.parchment-preview/%i/env
# systemd does not expand variables in WorkingDirectory, so the shell does it.
ExecStart=/bin/bash -c 'cd "$PREVIEW_WORKTREE/server" && exec "$PREVIEW_BUN" --env-file=../.env.preview src/index.ts'
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT

  cat > "$UNIT_DIR/parchment-preview-web@.service" <<'UNIT'
[Unit]
Description=Parchment preview web (slot %i)
After=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.parchment-preview/%i/env
ExecStart=/bin/bash -c 'cd "$PREVIEW_WORKTREE/web" && exec "$PREVIEW_BUN" run dev --host --port "$VITE_PORT"'
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
}

# ── worktree ─────────────────────────────────────────────────────────────────

current_branch_here() { git rev-parse --abbrev-ref HEAD 2>/dev/null || true; }

repo_root_here() { git rev-parse --show-toplevel 2>/dev/null || true; }

sanitize() { echo "$1" | tr '/' '-'; }

# Resolve the (branch, worktree) pair a command applies to: an explicit branch
# argument, else wherever the caller currently is.
resolve_target() {
  local arg=${1:-}
  if [ -z "$arg" ]; then
    local root; root=$(repo_root_here)
    [ -n "$root" ] || die "not inside a git repository — pass a branch name"
    TARGET_WORKTREE=$root
    TARGET_BRANCH=$(current_branch_here)
    [ -n "$TARGET_BRANCH" ] && [ "$TARGET_BRANCH" != HEAD ] || die "detached HEAD — pass a branch name"
    return
  fi
  TARGET_BRANCH=$arg
  local slot; slot=$(registry_get_slot_for_branch "$arg")
  if [ -n "$slot" ]; then
    TARGET_WORKTREE=$(registry_field "$slot" 3)
    return
  fi
  TARGET_WORKTREE="$MAIN_REPO/.claude/worktrees/$(sanitize "$arg")"
}

ensure_worktree() {
  local branch=$1 dir=$2
  [ -d "$dir/.git" ] || [ -f "$dir/.git" ] && return 0 || true
  [ -e "$dir" ] && return 0
  log "creating worktree $dir"
  git -C "$MAIN_REPO" fetch --quiet origin || true
  if git -C "$MAIN_REPO" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$MAIN_REPO" worktree add --quiet "$dir" "$branch"
  elif git -C "$MAIN_REPO" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git -C "$MAIN_REPO" worktree add --quiet --track -b "$branch" "$dir" "origin/$branch"
  else
    git -C "$MAIN_REPO" worktree add --quiet -b "$branch" "$dir" origin/dev
  fi
}

# ── labels ───────────────────────────────────────────────────────────────────

# owner/name from the remote URL, whatever form it takes. The `.git` suffix is
# stripped first: sed's ERE has no lazy quantifiers, so folding it into the
# capture leaves it attached, and every `gh` call then fails against a
# repository named "parchment.git".
repo_slug() {
  git -C "$1" remote get-url origin 2>/dev/null \
    | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#'
}

# A human name for the preview, shown as the browser tab title. With several
# previews open, tabs are otherwise identical — so use what the branch is
# actually about: its pull request title, falling back to the branch name.
# $PREVIEW_LABEL overrides both.
preview_label() {
  local branch=$1 worktree=$2 repo title=
  if [ -n "${PREVIEW_LABEL:-}" ]; then echo "$PREVIEW_LABEL"; return; fi
  repo=$(repo_slug "$worktree")
  if [ -n "$repo" ]; then
    title=$(timeout 15 gh pr view "$branch" --repo "$repo" --json title -q .title 2>/dev/null || true)
  fi
  echo "${title:-$branch}"
}

# systemd's EnvironmentFile takes double-quoted values, so a title with spaces
# or a `#` survives — as long as quotes and backslashes in it are escaped and
# it stays on one line.
env_quote() { printf '"%s"' "$(printf '%s' "$1" | tr -d '\n' | sed 's/[\\"]/\\&/g')"; }

# ── env generation ───────────────────────────────────────────────────────────

# Write .env.preview: the main .env with the per-slot values replaced. The app
# is started with --env-file pointing here rather than at .env, so there is no
# question of which value wins — and .env is left untouched for other tooling.
write_env() {
  local worktree=$1 dbname=$2 sport=$3 wport=$4 server_origin=$5 client_origin=$6
  local src="$MAIN_REPO/.env" dest="$worktree/.env.preview"
  grep -vE '^(SERVER_ORIGIN|CLIENT_ORIGIN|DATABASE_URL|PORT|HOST|NODE_ENV|VITE_SERVER_ORIGIN|VITE_PORT)=' "$src" > "$dest"
  cat >> "$dest" <<EOF

# ── written by scripts/preview.sh — do not edit, regenerated on every up ──
NODE_ENV=development
HOST=0.0.0.0
PORT=$sport
DATABASE_URL=postgresql://$PGUSER:$PGPW@$PG_HOST:$PG_PORT/$dbname
SERVER_ORIGIN=$server_origin
CLIENT_ORIGIN=$client_origin
VITE_SERVER_ORIGIN=$server_origin
VITE_PORT=$wport
EOF
  chmod 600 "$dest"
}

write_unit_env() {
  local slot=$1 worktree=$2 wport=$3 pub_host=$4 pub_scheme=$5 pub_web_port=$6 api_origin=$7 label=$8
  mkdir -p "$STATE_DIR/$slot"
  cat > "$STATE_DIR/$slot/env" <<EOF
PREVIEW_WORKTREE=$worktree
PREVIEW_BUN=$BUN
VITE_PORT=$wport
# The client reads its API base from VITE_SERVER_ORIGIN at dev-server start.
# It has to be in this process environment: Vite only loads .env/.env.local
# from web/, so it never sees the .env.preview the server is started with.
# Without it the client falls back to http://localhost:5000 — which, from a
# phone, is the phone itself, and from a laptop is that laptop's own dev
# server. Either way the session cookie lands on the wrong origin and sign-in
# appears not to persist.
VITE_SERVER_ORIGIN=$api_origin
# Vite refuses Host headers it does not know, and its HMR client would dial the
# origin port directly instead of the public one it was actually loaded from.
VITE_ALLOWED_HOSTS=$pub_host,.ts.net,localhost
VITE_PUBLIC_HOST=$pub_host
VITE_PUBLIC_PROTOCOL=$pub_scheme
VITE_PUBLIC_PORT=$pub_web_port
# Names this preview's browser tab (web/vite.config.ts rewrites <title>).
VITE_PREVIEW_LABEL=$(env_quote "$label")
EOF
}

# Retitle a running preview without a full `up`: Vite reads the label once, at
# start, so the web service is restarted to pick it up.
set_unit_label() {
  local slot=$1 label=$2 line tmp
  local file="$STATE_DIR/$slot/env"
  [ -f "$file" ] || return 0
  line="VITE_PREVIEW_LABEL=$(env_quote "$label")"
  # Already correct — leave the service alone rather than bouncing the tab.
  if grep -qxF "$line" "$file"; then return 0; fi
  tmp=$(mktemp)
  grep -v '^VITE_PREVIEW_LABEL=' "$file" > "$tmp"
  echo "$line" >> "$tmp"
  mv "$tmp" "$file"
  systemctl --user restart "parchment-preview-web@$slot"
}

# ── commands ─────────────────────────────────────────────────────────────────

cmd_up() {
  ensure_state; load_db_creds; install_units
  resolve_target "${1:-}"
  local branch=$TARGET_BRANCH worktree=$TARGET_WORKTREE slot dbname

  if [ "$worktree" = "$MAIN_REPO" ]; then
    slot=0; dbname=$BASE_DB
    log "main checkout → slot 0 (shares the $BASE_DB database)"
  else
    slot=$(allocate_slot "$branch")
    dbname="parchment_p$slot"
    ensure_worktree "$branch" "$worktree"
  fi

  local sport wport apub wpub host
  sport=$(server_port "$slot"); wport=$(web_port "$slot")
  apub=$(api_pub_port "$slot"); wpub=$(web_pub_port "$slot")
  host=$(ts_host)
  [ -n "$host" ] || die "tailscale is not up on this machine"

  log "slot $slot — branch $branch"
  [ "$slot" -eq 0 ] || clone_db "$dbname"

  log "installing dependencies"
  (cd "$worktree/server" && "$BUN" install --silent) || die "server deps failed"
  (cd "$worktree/web" && "$BUN" install --silent) || die "web deps failed"

  # Publish first: the app needs to be told its own public origin (CORS, cookies,
  # the client's API base URL), and that depends on whether HTTPS is available.
  local scheme_web scheme_api base_web base_api
  scheme_web=$(publish "$wpub" "$wport")
  scheme_api=$(publish "$apub" "$sport")
  if [ "$scheme_web" = https ] && [ "$scheme_api" = https ]; then
    base_web="https://$host:$wpub"; base_api="https://$host:$apub"
  else
    # No tailnet certs — serve plainly on the dev ports over the tailnet IP.
    local ip; ip=$(ts_ip)
    base_web="http://$ip:$wport"; base_api="http://$ip:$sport"
    PREVIEW_INSECURE=1
  fi

  local label; label=$(preview_label "$branch" "$worktree")
  write_env "$worktree" "$dbname" "$sport" "$wport" "$base_api" "$base_web"
  write_unit_env "$slot" "$worktree" "$wport" "$host" "${scheme_web}" "$wpub" "$base_api" "$label"

  systemctl --user restart "parchment-preview-server@$slot" "parchment-preview-web@$slot"
  registry_put "$slot" "$branch" "$worktree" "${scheme_web}" "$host"

  log "waiting for the API"
  local i ok=
  for i in $(seq 1 40); do
    sleep 2
    if curl -sf -m 3 "http://127.0.0.1:$sport/" >/dev/null 2>&1; then ok=1; break; fi
  done
  [ -n "$ok" ] || log "API did not answer yet — 'preview logs $branch' to see why"

  echo
  echo "  preview ready — $branch (slot $slot)"
  echo "     app  $base_web"
  echo "     api  $base_api"
  [ "$label" = "$branch" ] || echo "     tab  $label"
  if [ -n "${PREVIEW_INSECURE:-}" ]; then
    echo
    echo "  served over plain HTTP: browser geolocation will not work on mobile."
    echo "  Enable HTTPS certificates for the tailnet (admin console → DNS →"
    echo "  HTTPS Certificates), then re-run 'preview up $branch'."
  fi
}

cmd_down() {
  ensure_state; load_db_creds
  resolve_target "${1:-}"
  local branch=$TARGET_BRANCH slot
  slot=$(registry_get_slot_for_branch "$branch")
  [ -n "$slot" ] || die "no preview running for $branch"

  log "stopping slot $slot ($branch)"
  systemctl --user stop "parchment-preview-server@$slot" "parchment-preview-web@$slot" 2>/dev/null || true
  unpublish "$(web_pub_port "$slot")"
  unpublish "$(api_pub_port "$slot")"
  [ "$slot" -eq 0 ] || drop_db "parchment_p$slot"
  registry_remove_slot "$slot"
  rm -rf "${STATE_DIR:?}/$slot"
  log "slot $slot released (the worktree is left on disk)"
}

cmd_ls() {
  ensure_state
  if [ ! -s "$REGISTRY" ]; then echo "  no previews running"; return; fi
  printf '  %-4s %-28s %-8s %s\n' SLOT BRANCH STATE URL
  while IFS=$'\t' read -r slot branch worktree scheme host; do
    [ -n "$slot" ] || continue
    local state=stopped
    systemctl --user is-active --quiet "parchment-preview-server@$slot" && state=running
    local url
    if [ "$scheme" = https ]; then url="https://$host:$(web_pub_port "$slot")"
    else url="http://$(ts_ip):$(web_port "$slot")"; fi
    printf '  %-4s %-28s %-8s %s\n' "$slot" "$branch" "$state" "$url"
  done < "$REGISTRY"
}

cmd_url() {
  ensure_state; resolve_target "${1:-}"
  local slot; slot=$(registry_get_slot_for_branch "$TARGET_BRANCH")
  [ -n "$slot" ] || die "no preview running for $TARGET_BRANCH"
  local scheme host; scheme=$(registry_field "$slot" 4); host=$(registry_field "$slot" 5)
  if [ "$scheme" = https ]; then echo "https://$host:$(web_pub_port "$slot")"
  else echo "http://$(ts_ip):$(web_port "$slot")"; fi
}

# Push the branch and open (or update) its pull request.
#
# The preview URL is a hostname on a private network. That is a useless link to
# anyone who isn't on it, but it still describes infrastructure — so it is only
# written into the PR when the repository is private. On a public repository the
# link is printed here instead, for the author to open directly.
cmd_pr() {
  ensure_state; resolve_target "${1:-}"
  local branch=$TARGET_BRANCH worktree=$TARGET_WORKTREE url repo visibility
  url=$(cmd_url "$branch")
  repo=$(repo_slug "$worktree")

  git -C "$worktree" push --quiet -u origin "$branch"

  visibility=$(gh repo view "$repo" --json visibility -q .visibility 2>/dev/null || echo PUBLIC)

  local body
  if [ "$visibility" = PRIVATE ]; then
    body="<!-- preview-link -->
**Preview:** $url

Running from the \`$branch\` worktree with a clone of the dev database.
Hot-reloads on every push to this branch — no rebuild needed to see a change.
Reachable from the private network only."
  else
    body="A live preview of this branch is running on the author's development
machine, hot-reloading on every push. The link is on a private network and is
deliberately not published here."
  fi

  if gh pr view "$branch" --repo "$repo" >/dev/null 2>&1; then
    gh pr comment "$branch" --repo "$repo" --body "$body" >/dev/null
    log "commented on the existing PR"
  else
    gh pr create --repo "$repo" --base dev --head "$branch" \
      --title "$(git -C "$worktree" log -1 --pretty=%s)" --body "$body" >/dev/null
    log "opened a PR"
  fi
  gh pr view "$branch" --repo "$repo" --json url -q .url
  [ "$visibility" = PRIVATE ] || log "preview (not posted — public repo): $url"

  # The tab was named after the branch while no PR existed; now there is a
  # title worth reading, so the running preview takes it.
  local slot; slot=$(registry_get_slot_for_branch "$branch")
  [ -n "$slot" ] && set_unit_label "$slot" "$(preview_label "$branch" "$worktree")" || true
}

cmd_logs() {
  ensure_state; resolve_target "${1:-}"
  local slot; slot=$(registry_get_slot_for_branch "$TARGET_BRANCH")
  [ -n "$slot" ] || die "no preview running for $TARGET_BRANCH"
  journalctl --user -u "parchment-preview-server@$slot" -u "parchment-preview-web@$slot" -n 100 -f
}

case "${1:-}" in
  up)   shift; cmd_up "${1:-}" ;;
  down) shift; cmd_down "${1:-}" ;;
  ls|list) cmd_ls ;;
  url)  shift; cmd_url "${1:-}" ;;
  pr)   shift; cmd_pr "${1:-}" ;;
  logs) shift; cmd_logs "${1:-}" ;;
  # Usage is the header comment itself, minus the shebang — so it cannot drift.
  *) awk 'NR>1 && !/^#/{exit} NR>1{sub(/^# ?/, ""); print}' "$0"; exit 1 ;;
esac
