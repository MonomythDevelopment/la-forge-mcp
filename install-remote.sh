#!/bin/bash
#
# La Forge MCP - Remote Installation Script
# ==========================================
# "I can see things others can't."
#
# Usage: curl -fsSL https://raw.githubusercontent.com/MonomythDevelopment/la-forge-mcp/main/install-remote.sh | bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  _             ______                    "
echo " | |           |  ____|                   "
echo " | |     __ _  | |__ ___  _ __ __ _  ___  "
echo " | |    / _\` | |  __/ _ \| '__/ _\` |/ _ \ "
echo " | |___| (_| | | | | (_) | | | (_| |  __/ "
echo " |______\__,_| |_|  \___/|_|  \__, |\___| "
echo "                               __/ |      "
echo "                              |___/   MCP "
echo -e "${NC}"
echo -e "${BLUE}\"I can see things others can't.\"${NC}"
echo ""

INSTALL_DIR="$HOME/.la-forge-mcp"
REPO_URL="${LA_FORGE_REPO:-https://github.com/MonomythDevelopment/la-forge-mcp.git}"

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    echo -e "${YELLOW}Install Node.js 18+ first: https://nodejs.org${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}✗ Node.js 18+ required (found v$NODE_VERSION)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm $(npm -v)${NC}"

if ! command -v claude &> /dev/null; then
    echo -e "${RED}✗ Claude CLI not found${NC}"
    echo -e "${YELLOW}Install Claude Code first: https://claude.ai/code${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Claude CLI found${NC}"

if ! command -v git &> /dev/null; then
    echo -e "${RED}✗ Git not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Git found${NC}"

# Clone or update repository
echo ""
echo -e "${BLUE}Installing La Forge MCP...${NC}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Existing installation found. Updating...${NC}"
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
else
    echo -e "${BLUE}Cloning repository...${NC}"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies and build
echo ""
echo -e "${BLUE}Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

echo ""
echo -e "${BLUE}Building TypeScript...${NC}"
npm run build
echo -e "${GREEN}✓ Build complete${NC}"

# Register with Claude Code
echo ""
echo -e "${BLUE}Registering with Claude Code...${NC}"

SERVER_PATH="$INSTALL_DIR/dist/index.js"

# Remove existing if present
if claude mcp list 2>/dev/null | grep -q "la-forge"; then
    claude mcp remove la-forge -s user 2>/dev/null || true
fi

claude mcp add la-forge node "$SERVER_PATH" -s user
echo -e "${GREEN}✓ Registered with Claude Code${NC}"

# Detect Chrome
echo ""
echo -e "${BLUE}Detecting Chrome...${NC}"
CHROME_PATH=""
for path in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/usr/bin/google-chrome" "/usr/bin/chromium-browser" "/usr/bin/chromium"; do
    if [ -f "$path" ]; then
        CHROME_PATH="$path"
        break
    fi
done

if [ -n "$CHROME_PATH" ]; then
    echo -e "${GREEN}✓ Chrome found: $CHROME_PATH${NC}"
else
    echo -e "${YELLOW}⚠ Chrome not auto-detected. Set CHROME_PATH if needed.${NC}"
fi

# Done
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Installation Complete!                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "La Forge MCP is now available in Claude Code."
echo ""
echo -e "${BLUE}Quick Start:${NC}"
echo -e "  1. Open Claude Code"
echo -e "  2. Ask: \"Start Chrome and navigate to localhost:3000\""
echo -e "  3. Ask: \"Capture a reference called 'homepage'\""
echo -e "  4. Make CSS changes"
echo -e "  5. Ask: \"Verify against the homepage reference\""
echo ""
echo -e "${BLUE}Tools available:${NC}"
echo -e "  • start_chrome(url)           • capture_reference(name)"
echo -e "  • verify_against_reference()  • get_element_debug_info(selector)"
echo -e "  • quick_visual_check()        • compare_elements(selector, expected)"
echo ""
echo -e "${CYAN}\"It's not just what you look at, it's what you see.\"${NC}"
echo ""
