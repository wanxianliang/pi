#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Repo root (location of this script)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Consumer project that should use the locally built @earendil-works packages.
# Override with PI_SUITE_DIR if needed.
SUITE_DIR="${PI_SUITE_DIR:-/Users/sean/Documents/node-base/ai/pi-agent-suite}"
SUITE_SCOPE="$SUITE_DIR/node_modules/@earendil-works"
BACKUP_DIR="/tmp/pi-suite-backup-$(date +%Y%m%d-%H%M%S)"

# Local @earendil-works packages to sync into the suite (full local dependency closure of
# pi-agent-suite: pi-coding-agent -> agent-core/ai/client/protocol/tui, client -> protocol).
# Format: workspace_dir:package_name
PACKAGES=(
	"agent:pi-agent-core"
	"ai:pi-ai"
	"client:pi-client"
	"coding-agent:pi-coding-agent"
	"protocol:pi-protocol"
	"tui:pi-tui"
)

echo -e "${YELLOW}Starting @earendil-works build and suite sync...${NC}\n"

# Step 1: Build the project
echo -e "${YELLOW}[1/5] Building project...${NC}"
if ! (cd "$ROOT" && npm run build); then
	echo -e "${RED}Build failed. Exiting.${NC}"
	exit 1
fi
echo -e "${GREEN}✓ Build completed${NC}\n"

# Step 2: Verify suite directory
echo -e "${YELLOW}[2/5] Verifying suite at $SUITE_DIR...${NC}"
if [ ! -d "$SUITE_DIR" ]; then
	echo -e "${RED}Suite directory not found: $SUITE_DIR${NC}"
	echo -e "${RED}Set PI_SUITE_DIR to the consumer project that uses @earendil-works.${NC}"
	exit 1
fi
mkdir -p "$SUITE_SCOPE"
echo -e "${GREEN}✓ Suite verified${NC}\n"

# Step 3: Backup current suite @earendil-works packages (resolve symlinks so the backup
#         contains real data, unlike the old script which backed up only the links)
echo -e "${YELLOW}[3/5] Backing up current suite packages...${NC}"
if [ -n "$(ls -A "$SUITE_SCOPE" 2>/dev/null)" ]; then
	mkdir -p "$BACKUP_DIR"
	cp -RL "$SUITE_SCOPE"/. "$BACKUP_DIR/"
	echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}\n"
else
	echo -e "${YELLOW}No existing suite packages to back up${NC}\n"
fi

# Step 4: Sync built packages into the suite
echo -e "${YELLOW}[4/5] Syncing built packages into $SUITE_SCOPE...${NC}"
for item in "${PACKAGES[@]}"; do
	dir="${item%%:*}"
	pkg="${item#*:}"
	src="$ROOT/packages/$dir"
	target="$SUITE_SCOPE/$pkg"

	# Never touch the target before verifying the source has build output
	if [ ! -d "$src/dist" ] || [ -z "$(ls -A "$src/dist" 2>/dev/null)" ]; then
		echo -e "${RED}  SKIP @earendil-works/$pkg: no build output in $src/dist${NC}"
		exit 1
	fi

	# Remove the old entry completely. rm -rf on a symlink removes only the link,
	# never the files it points to (the bug that used to wipe packages/client).
	rm -rf "$target"
	mkdir -p "$SUITE_SCOPE"
	cp -R "$src"/. "$target"/

	version="$(node -p "require('$src/package.json').version" 2>/dev/null || echo '?')"
	echo -e "  Replaced ${YELLOW}@earendil-works/$pkg${NC} v$version from $src"
done
echo -e "${GREEN}✓ All suite packages synced${NC}\n"

# Step 5: Verify resolution from the suite
echo -e "${YELLOW}[5/5] Verifying resolution from $SUITE_DIR...${NC}"
(
	cd "$SUITE_DIR"
	ok=1
	for item in "${PACKAGES[@]}"; do
		pkg="${item#*:}"
		resolved="$(bun -e "console.log(import.meta.resolve('@earendil-works/$pkg'))" 2>/dev/null || echo 'FAILED')"
		if [ "$resolved" = "FAILED" ]; then
			echo -e "  ${RED}✗ $pkg: FAILED to resolve${NC}"
			ok=0
		else
			echo -e "  ${GREEN}✓ $pkg ->${NC} $resolved"
		fi
	done
	[ "$ok" -eq 1 ]
)
echo -e "${GREEN}✓ Replace completed successfully!${NC}"
