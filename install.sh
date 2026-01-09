#!/bin/bash
#
# La Forge MCP - Local Installation Script
# =========================================
# "I can see things others can't."
#
# Run this after cloning the repository locally.
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

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${LA_FORGE_MCP_DIR:-$HOME/.la-forge-mcp}"

echo -e "${YELLOW}Source:${NC} $SCRIPT_DIR"
echo -e "${YELLOW}Install to:${NC} $INSTALL_DIR"
echo ""

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}✗ Python 3 not found${NC}"
    exit 1
fi

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 10 ]); then
    echo -e "${RED}✗ Python 3.10+ required (found $PYTHON_VERSION)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Python $PYTHON_VERSION${NC}"

if ! command -v claude &> /dev/null; then
    echo -e "${RED}✗ Claude CLI not found${NC}"
    echo -e "${YELLOW}Install Claude Code first: https://claude.ai/code${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Claude CLI found${NC}"

# Copy files to install directory (if different from source)
echo ""
if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
    echo -e "${BLUE}Copying files to $INSTALL_DIR...${NC}"
    mkdir -p "$INSTALL_DIR"
    cp "$SCRIPT_DIR/server.py" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/pyproject.toml" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/README.md" "$INSTALL_DIR/"
    cp "$SCRIPT_DIR/CLAUDE_SNIPPET.md" "$INSTALL_DIR/" 2>/dev/null || true
    echo -e "${GREEN}✓ Files copied${NC}"
else
    echo -e "${BLUE}Installing in place...${NC}"
fi

# Create virtual environment
echo ""
echo -e "${BLUE}Creating virtual environment...${NC}"
cd "$INSTALL_DIR"

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
else
    echo -e "${YELLOW}Virtual environment exists${NC}"
fi

# Install dependencies
echo ""
echo -e "${BLUE}Installing dependencies...${NC}"
source .venv/bin/activate
pip install --upgrade pip > /dev/null 2>&1
pip install -r requirements.txt
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Get absolute paths
PYTHON_PATH="$INSTALL_DIR/.venv/bin/python"
SERVER_PATH="$INSTALL_DIR/server.py"

# Register with Claude Code
echo ""
echo -e "${BLUE}Registering with Claude Code...${NC}"

if claude mcp list 2>/dev/null | grep -q "la-forge"; then
    echo -e "${YELLOW}Removing existing registration...${NC}"
    claude mcp remove la-forge -s user 2>/dev/null || true
fi

claude mcp add la-forge "$PYTHON_PATH" "$SERVER_PATH" -s user
echo -e "${GREEN}✓ Registered with Claude Code (user level)${NC}"

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
    echo -e "${YELLOW}⚠ Chrome not auto-detected${NC}"
    echo -e "${YELLOW}  Set CHROME_PATH environment variable if needed${NC}"
fi

# Verify installation
echo ""
echo -e "${BLUE}Verifying installation...${NC}"
if claude mcp list 2>/dev/null | grep -q "la-forge"; then
    echo -e "${GREEN}✓ Installation verified${NC}"
else
    echo -e "${RED}✗ Installation verification failed${NC}"
    exit 1
fi

# Success message
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Installation Complete!                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "La Forge MCP is now available in all your Claude Code sessions."
echo ""
echo -e "${BLUE}Quick Start:${NC}"
echo -e "  1. Open Claude Code"
echo -e "  2. Ask: \"Start Chrome and navigate to localhost:3000\""
echo -e "  3. Ask: \"Capture a reference called 'homepage'\""
echo -e "  4. Make CSS changes"
echo -e "  5. Ask: \"Verify against the homepage reference\""
echo ""
echo -e "${BLUE}Available Tools:${NC}"
echo -e "  • start_chrome(url)           • capture_reference(name)"
echo -e "  • verify_against_reference()  • get_element_debug_info(selector)"
echo -e "  • quick_visual_check()        • compare_elements(selector, expected)"
echo ""
echo -e "${BLUE}Installation Location:${NC} $INSTALL_DIR"
echo ""
echo -e "${CYAN}\"It's not just what you look at, it's what you see.\"${NC}"
echo ""
