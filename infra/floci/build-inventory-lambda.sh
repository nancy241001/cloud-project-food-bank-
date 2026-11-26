#!/usr/bin/env bash
# Packages Mohamed's Inventory backend for its API Lambda.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$(mktemp -d)"
SVC="$ROOT/services/inventory-service"
ZIP="$ROOT/infra/floci/inventory-service.zip"

cleanup() { rm -rf "$BUILD"; }
trap cleanup EXIT

cp -r "$SVC/src" "$SVC/package.json" "$SVC/package-lock.json" "$BUILD/"
(cd "$BUILD" && npm ci --omit=dev --silent)
rm -f "$ZIP"
if command -v zip >/dev/null 2>&1; then
  (cd "$BUILD" && zip -qr "$ZIP" src node_modules package.json)
elif [ -x /c/Windows/System32/tar.exe ] && command -v powershell.exe >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
  # bsdtar creates Lambda-compatible ZIP entries with forward-slash separators.
  BUILD_WIN="$(cygpath -w "$BUILD")"
  ZIP_WIN="$(cygpath -w "$ZIP")"
  powershell.exe -NoProfile -Command \
    "& 'C:\Windows\System32\tar.exe' -a -c -f '$ZIP_WIN' -C '$BUILD_WIN' src node_modules package.json"
else
  echo "zip is required (or Windows bsdtar when running under Git Bash)" >&2
  exit 1
fi
echo "built infra/floci/inventory-service.zip"
