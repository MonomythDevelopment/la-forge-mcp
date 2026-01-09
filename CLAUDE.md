# CLAUDE.md

This file provides guidance to Claude Code when working with this codebase.

## Project Overview

La Forge MCP is a Model Context Protocol (MCP) server that provides visual CSS debugging capabilities for AI coding assistants. It enables pixel-level screenshot comparison, computed style extraction, and CSS rule chain analysis.

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript (ES modules)
- **Build**: TypeScript compiler (`tsc`)
- **Key Dependencies**:
  - `@modelcontextprotocol/sdk` - MCP server framework
  - `sharp` - Image processing for screenshot diffing
  - `ws` - WebSocket client for Chrome DevTools Protocol

## Project Structure

```
la-forge-mcp/
├── src/
│   └── index.ts      # Main server implementation (all-in-one)
├── dist/             # Compiled output (generated)
├── package.json
├── tsconfig.json
├── install.sh        # Local installer (macOS/Linux)
├── install.ps1       # Local installer (Windows)
├── install-remote.sh # Remote one-liner installer
├── install-remote.ps1
├── CLAUDE_SNIPPET.md # Instructions for users to add to their CLAUDE.md
├── README.md
├── CHANGELOG.md
└── LICENSE
```

## Common Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode (with tsx)
npm run dev

# Run production build
npm start
```

## Architecture Notes

The server is a single-file implementation (`src/index.ts`) that:

1. **Chrome DevTools Protocol (CDP)**: Connects to Chrome via WebSocket for browser automation
2. **Screenshot Capture**: Uses CDP's `Page.captureScreenshot` for pixel-perfect captures
3. **Pixel Diffing**: Custom implementation using `sharp` with connected-components analysis
4. **Style Extraction**: Injects JavaScript via CDP to read `getComputedStyle()` values
5. **CSS Rule Analysis**: Iterates stylesheets to find all rules matching an element

## MCP Tools Provided

- `start_chrome` - Launch Chrome with debugging enabled
- `navigate` - Navigate to a URL
- `check_connection` - Verify Chrome connection status
- `capture_reference` - Save screenshot + styles as reference
- `verify_against_reference` - Compare current state against reference
- `get_element_debug_info` - Deep dive on element styles/rules
- `compare_elements` - Check specific style values
- `quick_visual_check` - Detect black screens, loading states
- `list_references` - List saved references
- `screenshot_element` - Screenshot a specific element

## Development Guidelines

- Keep the single-file architecture for simplicity
- All CDP communication goes through `sendCDPCommand()` helper
- Reference screenshots are stored in OS temp directory (`la-forge-references/`)
- Error handling should return JSON with `success: false` and `error` message

## Testing

Manual testing workflow:
1. Start the server: `npm run dev`
2. In another terminal, start Chrome: `google-chrome --remote-debugging-port=9222`
3. Use an MCP client to call the tools

## Release Checklist

When preparing a release:
1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Run `npm run build` to ensure clean compilation
4. Test install scripts on fresh environment
