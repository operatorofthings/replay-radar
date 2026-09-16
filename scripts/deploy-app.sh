#!/usr/bin/env bash
set -euo pipefail
: "${STATIC_BUCKET:?Set STATIC_BUCKET}"
: "${DISTRIBUTION_ID:?Set DISTRIBUTION_ID}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-eu-central-1}"
test -f dist/index.html
test -f .build/lambda/index.cjs
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('.build/lambda.zip','w',zipfile.ZIP_DEFLATED) as z:z.write('.build/lambda/index.cjs','index.cjs')
PY
for fn in replay-radar-worker replay-radar-api; do
  aws lambda update-function-code --function-name "$fn" --zip-file fileb://.build/lambda.zip --query LastUpdateStatus --output text
  aws lambda wait function-updated-v2 --function-name "$fn"
done
# Upload assets first; retain previous hashes so already-open tabs keep working.
aws s3 sync dist/assets/ "s3://$STATIC_BUCKET/assets/" --cache-control 'public,max-age=31536000,immutable' --only-show-errors
aws s3 sync dist/ "s3://$STATIC_BUCKET/" --exclude 'assets/*' --exclude index.html --cache-control 'public,max-age=60' --only-show-errors
aws s3 cp dist/index.html "s3://$STATIC_BUCKET/index.html" --content-type 'text/html; charset=utf-8' --cache-control 'public,max-age=60' --only-show-errors
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths / /index.html /demo-images.json --query Invalidation.Id --output text
