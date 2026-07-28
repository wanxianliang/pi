#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Target directory
GLOBAL_PKG="/Users/sean/.bun/install/global/node_modules/@earendil-works/pi-coding-agent"
SOURCE_PKG="packages/coding-agent"
BACKUP_DIR="/tmp/pi-coding-agent-backup-$(date +%Y%m%d-%H%M%S)"

echo -e "${YELLOW}Starting pi-coding-agent build and replace process...${NC}\n"

# Step 1: Build the project
echo -e "${YELLOW}[1/4] Building project...${NC}"
if ! npm run build; then
	echo -e "${RED}Build failed. Exiting.${NC}"
	exit 1
fi
echo -e "${GREEN}✓ Build completed${NC}\n"

# Step 2: Verify source package exists
echo -e "${YELLOW}[2/4] Verifying source package...${NC}"
if [ ! -d "$SOURCE_PKG/dist" ]; then
	echo -e "${RED}Source package dist directory not found at $SOURCE_PKG/dist${NC}"
	exit 1
fi
echo -e "${GREEN}✓ Source package verified${NC}\n"

# Step 3: Backup current global package
echo -e "${YELLOW}[3/4] Backing up current global package...${NC}"
if [ ! -d "$GLOBAL_PKG" ]; then
	echo -e "${RED}Global package not found at $GLOBAL_PKG${NC}"
	echo -e "${YELLOW}You may need to install it first with:${NC}"
	echo -e "${YELLOW}  bun add -g --ignore-scripts @earendil-works/pi-coding-agent${NC}"
	exit 1
fi

mkdir -p "$BACKUP_DIR"
cp -R "$GLOBAL_PKG"/* "$BACKUP_DIR/"
echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}\n"

# Step 4: Replace global package
echo -e "${YELLOW}[4/4] Replacing global package...${NC}"
rm -rf "$GLOBAL_PKG"/*
cp -R "$SOURCE_PKG"/* "$GLOBAL_PKG/"
echo -e "${GREEN}✓ Global package replaced${NC}\n"

# Verify installation
echo -e "${YELLOW}Verifying installation...${NC}"
PI_VERSION=$(pi --version 2>/dev/null || echo "unknown")
echo -e "  Version: ${GREEN}$PI_VERSION${NC}"
echo -e "  Location: ${GREEN}$GLOBAL_PKG${NC}"
echo -e "  Backup: ${GREEN}$BACKUP_DIR${NC}\n"

echo -e "${GREEN}✓ Replace completed successfully!${NC}"
echo -e "\n${YELLOW}To restore from backup if needed:${NC}"
echo -e "  rm -rf $GLOBAL_PKG/*"
echo -e "  cp -R $BACKUP_DIR/* $GLOBAL_PKG/"
