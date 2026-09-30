#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE="$HOME/.bun/install/global/node_modules/@earendil-works"

# Local @earendil-works packages to install into the bun global scope.
PACKAGES=(chord ai protocol tui pi-enhance-tui telemetry codemode mcp durable agent client server coding-agent session-backends/sqlite-node)

echo -e "${YELLOW}[1/2] Building project...${NC}"
(cd "$ROOT" && npm run build)

echo -e "${YELLOW}[2/2] Installing built packages into bun global scope...${NC}"
mkdir -p "$SCOPE"
for dir in "${PACKAGES[@]}"; do
	src="$ROOT/packages/$dir"
	if [ ! -d "$src/dist" ] || [ -z "$(ls -A "$src/dist" 2>/dev/null)" ]; then
		echo -e "${RED} SKIP $dir: no build output in $src/dist${NC}"
		exit 1
	fi
	name="$(node -p "require('$src/package.json').name.split('/').pop()")"
	version="$(node -p "require('$src/package.json').version")"
	rm -rf "$SCOPE/$name"
	mkdir -p "$SCOPE/$name"
	cp -R "$src"/. "$SCOPE/$name"/
	echo -e " Installed ${YELLOW}$name${NC} v$version"
done

# Ensure external runtime dependencies (e.g. quickjs-wasi for codemode) are present in bun global scope
GLOBAL_NM="$HOME/.bun/install/global/node_modules"
for ext_dep in quickjs-wasi esbuild; do
	if [ -d "$ROOT/node_modules/$ext_dep" ]; then
		rm -rf "$GLOBAL_NM/$ext_dep"
		cp -R "$ROOT/node_modules/$ext_dep" "$GLOBAL_NM/"
		echo -e "  Synced external dependency ${YELLOW}$ext_dep${NC}"
	fi
done
if [ -d "$ROOT/node_modules/@esbuild" ]; then
	mkdir -p "$GLOBAL_NM/@esbuild"
	cp -R "$ROOT/node_modules/@esbuild"/. "$GLOBAL_NM/@esbuild"/
fi

echo -e "${GREEN}✓ Build and bun global install completed${NC}"
