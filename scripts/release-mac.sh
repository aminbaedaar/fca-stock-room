#!/bin/zsh
# Builds the universal Mac app (Apple Silicon + Intel) on this Mac and adds it
# to the GitHub Release for the current version, including the auto-update
# entry in latest.json. Run after the Windows release workflow has finished:
#   scripts/release-mac.sh            (build, then upload)
#   scripts/release-mac.sh --no-build (upload what was built last)
# Needs: Rust (~/.cargo), GitHub CLI signed in, and the signing key in ~/.tauri.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."
REPO=aminbaedaar/fca-stock-room
VERSION=$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")
TAG="v$VERSION"
BUNDLE=apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle

if [[ "${1:-}" != "--no-build" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/fca-stock-room.key)"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/fca-stock-room.password)"
  (cd apps/desktop && npx tauri build --target universal-apple-darwin)
fi

gh release view "$TAG" -R $REPO > /dev/null || { echo "Release $TAG not found. Push the tag and wait for the Windows build first."; exit 1; }

OUT=$(mktemp -d)
cp "$BUNDLE/dmg/FCA Stock Room_${VERSION}_universal.dmg" "$OUT/FCA-Stock-Room_${VERSION}_universal.dmg"
cp "$BUNDLE/macos/FCA Stock Room.app.tar.gz" "$OUT/FCA-Stock-Room_universal.app.tar.gz"
SIG=$(cat "$BUNDLE/macos/FCA Stock Room.app.tar.gz.sig")

gh release upload "$TAG" -R $REPO --clobber "$OUT/FCA-Stock-Room_${VERSION}_universal.dmg" "$OUT/FCA-Stock-Room_universal.app.tar.gz"

# Add the Mac entries to the auto-update file.
gh release download "$TAG" -R $REPO -p latest.json -D "$OUT" --clobber
URL="https://github.com/$REPO/releases/download/$TAG/FCA-Stock-Room_universal.app.tar.gz"
SIG="$SIG" URL="$URL" node -e '
  const fs = require("fs"); const f = process.argv[1];
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const entry = { signature: process.env.SIG, url: process.env.URL };
  for (const p of ["darwin-aarch64", "darwin-x86_64", "darwin-universal"]) j.platforms[p] = entry;
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  console.log("latest.json platforms:", Object.keys(j.platforms).join(", "));
' "$OUT/latest.json"
gh release upload "$TAG" -R $REPO --clobber "$OUT/latest.json"
rm -rf "$OUT"
echo "Mac app added to $TAG: https://github.com/$REPO/releases/tag/$TAG"
