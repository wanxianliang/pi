#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Global node_modules scope directory
GLOBAL_SCOPE="/Users/sean/.bun/install/global/node_modules/@earendil-works"
BACKUP_DIR="/tmp/pi-global-backup-$(date +%Y%m%d-%H%M%S)"

# List of local workspace paths and package names under @earendil-works
PACKAGES=(
	"agent:pi-agent-core"
	"ai:pi-ai"
	"coding-agent:pi-coding-agent"
	"tui:pi-tui"
	"client:pi-client"
	"protocol:pi-protocol"
	"server:pi-server"
	"storage/sqlite-node:pi-storage-sqlite-node"
)

echo -e "${YELLOW}Starting full @earendil-works build and replace process...${NC}\n"

# Step 1: Build the project
echo -e "${YELLOW}[1/4] Building project...${NC}"
if ! npm run build; then
	echo -e "${RED}Build failed. Exiting.${NC}"
	exit 1
fi
echo -e "${GREEN}✓ Build completed${NC}\n"

# Step 2: Verify global scope directory
echo -e "${YELLOW}[2/4] Verifying global package scope...${NC}"
if [ ! -d "$GLOBAL_SCOPE" ]; then
	echo -e "${RED}Global package scope not found at $GLOBAL_SCOPE${NC}"
	exit 1
fi
echo -e "${GREEN}✓ Global scope verified${NC}\n"

# Step 3: Backup current global scope packages
echo -e "${YELLOW}[3/4] Backing up current global packages...${NC}"
mkdir -p "$BACKUP_DIR"
cp -R "$GLOBAL_SCOPE"/* "$BACKUP_DIR/"
echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}\n"

# Step 4: Replace all built packages under @earendil-works
echo -e "${YELLOW}[4/4] Replacing global packages under @earendil-works...${NC}"
for item in "${PACKAGES[@]}"; do
	src_dir="packages/${item%%:*}"
	pkg_name="${item#*:}"
	target_dir="$GLOBAL_SCOPE/$pkg_name"

	if [ -d "$src_dir" ]; then
		echo -e "  Replacing ${YELLOW}@earendil-works/$pkg_name${NC} from $src_dir..."
		mkdir -p "$target_dir"
		rm -rf "${target_dir:?}"/*
		cp -R "$src_dir"/* "$target_dir/"
	fi
done
echo -e "${GREEN}✓ All global packages replaced${NC}\n"

# Verify installation
echo -e "${YELLOW}Verifying installation...${NC}"
PI_VERSION=$(pi --version 2>/dev/null || echo "unknown")
echo -e "  Version: ${GREEN}$PI_VERSION${NC}"
echo -e "  Location: ${GREEN}$GLOBAL_SCOPE${NC}"
echo -e "  Backup: ${GREEN}$BACKUP_DIR${NC}\n"

echo -e "${GREEN}✓ Replace completed successfully!${NC}"
