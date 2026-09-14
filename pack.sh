#!/usr/bin/env bash
set -euo pipefail

RED='\x1b[0;31m'
GREEN='\x1b[0;32m'
YELLOW='\x1b[1;33m'
BLUE='\x1b[0;34m'
NC='\x1b[0m'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_NAME="pi-bundle"
OUTPUT_DIR="$ROOT/dist-package"
STAGING="$OUTPUT_DIR/$DIST_NAME"
ARCHIVE="$ROOT/$DIST_NAME.tar.gz"

# Path to distribute.sh
DISTRIBUTE_SH="${DISTRIBUTE_SH:-$HOME/Documents/node-base/scripts/distribute.sh}"

SKIP_BUILD=0
AUTO_DIST=1

for arg in "$@"; do
	case "$arg" in
		--skip-build|-s)
			SKIP_BUILD=1
			;;
		--no-dist)
			AUTO_DIST=0
			;;
	esac
done

PACKAGES=(chord ai protocol tui pi-enhance-tui telemetry agent client server coding-agent session-backends/sqlite-node)

if [ "$SKIP_BUILD" -eq 1 ]; then
	echo -e "${YELLOW}[1/4] Skipping build step (--skip-build)...${NC}"
else
	echo -e "${YELLOW}[1/4] Building project...${NC}"
	(cd "$ROOT" && npm run build)
fi

echo -e "${YELLOW}[2/4] Collecting built packages into staging...${NC}"
rm -rf "$OUTPUT_DIR" "$ARCHIVE"
mkdir -p "$STAGING/@earendil-works"

for dir in "${PACKAGES[@]}"; do
	src="$ROOT/packages/$dir"
	if [ ! -d "$src/dist" ] || [ -z "$(ls -A "$src/dist" 2>/dev/null)" ]; then
		echo -e "${RED} ERROR $dir: no build output in $src/dist (run without --skip-build first)${NC}"
		exit 1
	fi
	name="$(node -p "require('$src/package.json').name.split('/').pop()")"
	version="$(node -p "require('$src/package.json').version")"
	mkdir -p "$STAGING/@earendil-works/$name"
	cp -R "$src"/. "$STAGING/@earendil-works/$name"/
	echo -e " Packed ${BLUE}$name${NC} v$version"
done

# Generate self-contained install.sh for the target machine
cat << 'EOF' > "$STAGING/install.sh"
#!/usr/bin/env bash
set -euo pipefail

GREEN='\x1b[0;32m'
YELLOW='\x1b[1;33m'
BLUE='\x1b[0;34m'
NC='\x1b[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN_DIR="${BUN_INSTALL:-$HOME/.bun}"
SCOPE="$BUN_DIR/install/global/node_modules/@earendil-works"
BIN_DIR="$BUN_DIR/bin"

echo -e "${YELLOW}[1/2] Installing @earendil-works packages into $SCOPE...${NC}"
mkdir -p "$SCOPE"
for pkg in "$SCRIPT_DIR/@earendil-works"/*; do
	pkg_name="$(basename "$pkg")"
	rm -rf "$SCOPE/$pkg_name"
	mkdir -p "$SCOPE/$pkg_name"
	cp -R "$pkg"/. "$SCOPE/$pkg_name"/
	echo -e " Installed ${BLUE}$pkg_name${NC}"
done

echo -e "${YELLOW}[2/2] Configuring global binary 'pi'...${NC}"
mkdir -p "$BIN_DIR"
CLI="$SCOPE/pi-coding-agent/dist/bundle/cli.js"
chmod +x "$CLI"
ln -sf "$CLI" "$BIN_DIR/pi"

# Also link into ~/.local/bin if ~/.local/bin is in PATH
if echo ":$PATH:" | grep -q ":$HOME/.local/bin:"; then
	mkdir -p "$HOME/.local/bin"
	ln -sf "$CLI" "$HOME/.local/bin/pi"
fi

echo -e "${GREEN}✓ Installation completed successfully!${NC}"

# Check if pi is directly reachable in PATH
if command -v pi >/dev/null 2>&1; then
	echo -e "pi command ready: ${GREEN}$(which pi)${NC}"
	echo -e "Version: ${GREEN}$(pi --version 2>/dev/null || echo 'ok')${NC}"
else
	echo -e "${YELLOW}Notice:${NC} '$BIN_DIR' is not in your current PATH."
	echo "Please add it to your ~/.zshrc or ~/.bashrc:"
	echo -e "  ${BLUE}export PATH="$BIN_DIR:\$PATH"${NC}"
fi
EOF

chmod +x "$STAGING/install.sh"

echo -e "${YELLOW}[3/4] Creating archive: $ARCHIVE...${NC}"
tar -czf "$ARCHIVE" -C "$OUTPUT_DIR" "$DIST_NAME"
rm -rf "$OUTPUT_DIR"

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo -e "${GREEN}✓ Done! Archive created at:${NC} ${BLUE}$ARCHIVE${NC} (${YELLOW}$SIZE${NC})"

# Auto distribution step
if [ "$AUTO_DIST" -eq 1 ]; then
	echo ""
	echo -e "${YELLOW}[4/4] Auto-distributing archive via distribute.sh...${NC}"
	if [ -f "$DISTRIBUTE_SH" ]; then
		bash "$DISTRIBUTE_SH" push "$ARCHIVE"
		echo -e "${GREEN}✓ Auto-distribution completed!${NC}"
		echo -e "On other machines, simply install it with:"
		echo -e "  ${BLUE}./distribute.sh install $DIST_NAME.tar.gz -y${NC}"
	else
		echo -e "${RED}Warning:${NC} distribute.sh not found at: $DISTRIBUTE_SH"
		echo "Skipping auto-distribution. You can manually run:"
		echo "  <path_to_distribute.sh> push $ARCHIVE"
	fi
else
	echo -e "${YELLOW}[4/4] Skipping auto-distribution (--no-dist specified).${NC}"
fi
