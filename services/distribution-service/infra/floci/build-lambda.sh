set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf build && mkdir -p build/pkg
cp -r src package.json package-lock.json build/pkg/
(cd build/pkg && npm ci --omit=dev --no-audit --no-fund)

# zip if available, otherwise Windows' built-in bsdtar (it can write real .zip files)
if command -v zip >/dev/null 2>&1; then
  (cd build/pkg && zip -qr ../momen-api.zip .)
elif [ -x /c/Windows/System32/tar.exe ]; then
  /c/Windows/System32/tar.exe -a -c -f build/momen-api.zip -C build/pkg .
else
  echo "ERROR: need 'zip' or Windows tar.exe to build the package" >&2; exit 1
fi
echo "built build/momen-api.zip"
