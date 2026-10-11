#!/bin/sh
# Manba kodini (src/) versiyali papkaga ko'chiradi: docs/b/<versiya>/
# Shunda brauzer eski nusxani ushlab qolmaydi, yangilanish keyingi ochilishda darhol ko'rinadi.
# Har o'zgarishdan keyin: sh build.sh
set -e
cd "$(dirname "$0")"
V=$(date -u +%Y%m%d%H%M%S)
rm -rf docs/b
mkdir -p "docs/b/$V"
cp -r src/js src/css "docs/b/$V/"
# Eski sahifa nusxasi brauzerda qolgan bo'lsa ham ishlashi uchun (vaqtincha)
rm -rf docs/js docs/css && cp -r src/js src/css docs/
printf '{"v":"%s"}\n' "$V" > docs/version.json
echo "versiya $V"
