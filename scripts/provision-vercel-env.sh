#!/usr/bin/env bash
#
# provision-vercel-env.sh
#
# One-shot: pushes the env vars the cron handler at api/cron-photo-intake.ts
# needs into the `crossfit-otl` Vercel project (production target).
#
# Reads VERCEL_TOKEN from the env, or prompts. Reads VERCEL_TEAM_ID from env or
# uses the known OTL team. Reads project secrets from pipeline/.env so this
# stays in sync with whatever the Mac mini was using.
#
# Run once. Re-running is safe — it deletes any existing entry with the same
# key+target before re-creating it.

set -euo pipefail

VERCEL_TOKEN="${VERCEL_TOKEN:-}"
if [[ -z "$VERCEL_TOKEN" ]]; then
  read -rsp "Vercel token: " VERCEL_TOKEN
  echo
fi

VERCEL_TEAM_ID="${VERCEL_TEAM_ID:-team_SfN4SdT39JjnhxOLvzeLv1ma}"
PROJECT_SLUG="${PROJECT_SLUG:-crossfit-otl}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/pipeline/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ Missing $ENV_FILE — cannot read source secrets" >&2
  exit 1
fi

# Read a key out of the .env file (no shell substitution; values may contain =)
read_env() {
  local key="$1"
  awk -F= -v k="$key" '$1==k {sub("^[^=]+=",""); print; exit}' "$ENV_FILE"
}

CRON_SECRET="${CRON_SECRET:-4184e509ffaf655f4138d8d1eec9c55c16c109b7bdb71379e771189b5ae2bfb0}"

declare -A KV
KV[ICLOUD_ALBUM_TOKEN]="$(read_env ICLOUD_ALBUM_TOKEN)"
KV[ANTHROPIC_API_KEY]="$(read_env ANTHROPIC_API_KEY)"
KV[CLOUDINARY_CLOUD_NAME]="$(read_env CLOUDINARY_CLOUD_NAME)"
KV[CLOUDINARY_API_KEY]="$(read_env CLOUDINARY_API_KEY)"
KV[CLOUDINARY_API_SECRET]="$(read_env CLOUDINARY_API_SECRET)"
KV[CRON_SECRET]="$CRON_SECRET"

echo "→ Project: $PROJECT_SLUG (team $VERCEL_TEAM_ID)"
echo "→ Setting ${#KV[@]} env vars on production…"
echo

VAPI="https://api.vercel.com/v9/projects/$PROJECT_SLUG/env?teamId=$VERCEL_TEAM_ID"

# Fetch existing prod env vars so we can overwrite cleanly
EXISTING_JSON="$(curl -fsSL -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/$PROJECT_SLUG/env?teamId=$VERCEL_TEAM_ID&decrypt=false")"

for KEY in "${!KV[@]}"; do
  VAL="${KV[$KEY]}"
  if [[ -z "$VAL" ]]; then
    echo "  ⚠ $KEY  (empty in source — skipping)"
    continue
  fi

  # Delete any existing prod entry for this key
  EXIST_ID=$(printf '%s' "$EXISTING_JSON" | python3 -c "
import json,sys
data=json.load(sys.stdin)
key='$KEY'
for e in data.get('envs',[]):
  if e.get('key')==key and 'production' in e.get('target',[]):
    print(e.get('id',''))
    break
")
  if [[ -n "$EXIST_ID" ]]; then
    curl -fsSL -X DELETE -H "Authorization: Bearer $VERCEL_TOKEN" \
      "https://api.vercel.com/v9/projects/$PROJECT_SLUG/env/$EXIST_ID?teamId=$VERCEL_TEAM_ID" >/dev/null
  fi

  # Create
  PAYLOAD=$(python3 -c "
import json,sys
print(json.dumps({'key': sys.argv[1], 'value': sys.argv[2], 'type': 'encrypted', 'target': ['production']}))
" "$KEY" "$VAL")

  curl -fsSL -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    "$VAPI" -d "$PAYLOAD" >/dev/null

  echo "  ✓ $KEY"
done

echo
echo "✓ Done. Trigger a redeploy so the new env vars get picked up:"
echo "    git commit --allow-empty -m 're: bump for env vars' && git push"
echo
echo "Or hit the latest deployment manually:"
echo "  curl -H 'Authorization: Bearer $CRON_SECRET' https://crossfit-otl.com/api/cron-photo-intake"
