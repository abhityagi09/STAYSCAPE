#!/bin/sh
# Post-deploy smoke test. Usage: scripts/deploy/smoke.sh https://staging.example.com
# Read-only checks of a deployed stack; exits non-zero on the first failure.
set -eu
URL="${1:?base URL required}"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }

[ "$(code "$URL/health/ready")" = 200 ] || fail "readiness"
[ "$(code "$URL/api/v1/hotels?limit=1")" = 200 ] || fail "search API"
[ "$(code "$URL/api/v1/destinations")" = 200 ] || fail "destinations API"
curl -s --max-time 15 "$URL/" | grep -q '<title>' || fail "home page has no <title>"
[ "$(code "$URL/sitemap.xml")" = 200 ] || fail "sitemap"
curl -s --max-time 15 "$URL/robots.txt" | grep -q 'Disallow: /admin' || fail "robots.txt"
# Must NOT be reachable from the edge.
[ "$(code "$URL/metrics")" = 404 ] || fail "/metrics is exposed at the edge"
# Security headers on the HTML shell.
headers="$(curl -sI --max-time 15 "$URL/")"
echo "$headers" | grep -qi '^content-security-policy:' || fail "CSP header missing"
echo "$headers" | grep -qi '^x-frame-options: DENY' || fail "X-Frame-Options missing"
echo "$headers" | grep -qi '^server:.*nginx/[0-9]' && fail "server version disclosed"
# Unauthenticated access to private APIs is refused.
[ "$(code "$URL/api/v1/admin/dashboard")" = 401 ] || fail "admin API not protected"
echo "smoke tests passed for $URL"
