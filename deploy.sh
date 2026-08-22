#!/usr/bin/env bash
# Ships a built Vite app to the shared box. There is no ssh and no git there:
# the tarball goes through S3 and ssm unpacks it. Caddy serves /opt/games/<name>
# straight off disk, so nothing needs restarting — but the old hashed assets do
# need to go, hence the swap through a .new directory instead of an overlay.
#
#     ./deploy.sh
set -euo pipefail

PROFILE=credits
REGION=eu-central-1
INSTANCE=i-0f31d84610122dc7e
BUCKET=bookkicker-migration-985539780893
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="regex"

(cd "$SRC" && npm run build >/dev/null)

TAR="/tmp/${NAME}-site.tar.gz"
# COPYFILE_DISABLE: without it macOS tar adds ._ resource-fork files next to
# every real one and they ride along to the server.
COPYFILE_DISABLE=1 tar -czf "$TAR" -C "$SRC/dist" .
aws s3 cp "$TAR" "s3://${BUCKET}/ai/${NAME}-site.tar.gz" --profile "$PROFILE" --region "$REGION" >/dev/null
echo "uploaded: $(du -h "$TAR" | cut -f1)"

CMD=$(aws ssm send-command \
  --profile "$PROFILE" --region "$REGION" \
  --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[
    \"set -e\",
    \"rm -rf /opt/games/${NAME}.new && mkdir -p /opt/games/${NAME}.new\",
    \"aws s3 cp s3://${BUCKET}/ai/${NAME}-site.tar.gz /tmp/${NAME}-site.tar.gz\",
    \"tar -xzf /tmp/${NAME}-site.tar.gz -C /opt/games/${NAME}.new\",
    \"rm -rf /opt/games/${NAME}.old\",
    \"if [ -d /opt/games/${NAME} ]; then mv /opt/games/${NAME} /opt/games/${NAME}.old; fi\",
    \"mv /opt/games/${NAME}.new /opt/games/${NAME}\",
    \"rm -rf /opt/games/${NAME}.old /tmp/${NAME}-site.tar.gz\",
    \"ls -la /opt/games/${NAME} /opt/games/${NAME}/assets\"
  ]" \
  --query 'Command.CommandId' --output text)

for _ in $(seq 1 30); do
  STATUS=$(aws ssm get-command-invocation --profile "$PROFILE" --region "$REGION" \
    --command-id "$CMD" --instance-id "$INSTANCE" --query 'Status' --output text 2>/dev/null || echo Pending)
  [[ "$STATUS" == "InProgress" || "$STATUS" == "Pending" ]] || break
  sleep 2
done
aws ssm get-command-invocation --profile "$PROFILE" --region "$REGION" \
  --command-id "$CMD" --instance-id "$INSTANCE" \
  --query 'StandardOutputContent' --output text
echo "status: $STATUS"
echo "local assets: $(ls "$SRC/dist/assets")"
