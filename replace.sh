#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE="$HOME/.bun/install/global/node_modules/@earendil-works"

# Local @earendil-works packages to install into the bun global scope.
PACKAGES=(ai protocol tui pi-enhance-tui agent client coding-agent)

echo -e "${YELLOW}[1/2] Building project...${NC}"
(cd "$ROOT" && npm run build)

echo -e "${YELLOW}[2/2] Installing built packages into bun global scope...${NC}"
mkdir -p "$SCOPE"
for dir in "${PACKAGES[@]}"; do
	src="$ROOT/packages/$dir"
	if [ ! -d "$src/dist" ] || [ -z "$(ls -A "$src/dist" 2>/dev/null)" ]; then
		echo -e "${RED}  SKIP $dir: no build output in $src/dist${NC}"
		exit 1
	fi
	name="$(node -p "require('$src/package.json').name.split('/').pop()")"
	version="$(node -p "require('$src/package.json').version")"
	rm -rf "$SCOPE/$name"
	mkdir -p "$SCOPE"
	cp -R "$src"/. "$SCOPE/$name"/
	echo -e "  Installed ${YELLOW}$name${NC} v$version"
done

echo -e "${GREEN}✓ Build and bun global install completed${NC}"
