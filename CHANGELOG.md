# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-09

### Changed
- Complete rewrite from Python to TypeScript for easier distribution and maintenance
- Now uses Node.js 18+ instead of Python 3.10+
- Uses `sharp` for image processing instead of PIL/NumPy
- Custom connected components implementation replaces scipy dependency
- Uses native `fetch` and `ws` for Chrome DevTools Protocol communication

### Added
- TypeScript type definitions throughout
- ESM module support
- `tsx` for development hot-reloading

## [1.0.0] - 2026-01-09

### Added
- Initial release (Python version)
- `start_chrome` - Start Chrome with remote debugging enabled
- `navigate` - Navigate to URLs in connected browser
- `check_connection` - Verify Chrome connection status
- `capture_reference` - Save screenshot + computed styles as baseline
- `verify_against_reference` - Compare current state against saved reference with pixel diffing
- `quick_visual_check` - Detect black screens, blank pages, loading states
- `get_element_debug_info` - Deep dive on element's computed styles and CSS rule chain
- `compare_elements` - Verify specific style properties against expected values
- `screenshot_element` - Capture screenshot of individual elements
- `list_references` - List all saved reference snapshots
- Pixel-level image diffing
- Automatic problem region detection
- CSS rule chain analysis showing inheritance and overrides
- Cross-platform install scripts (bash + PowerShell)
- One-liner remote installation support
- User-level Claude Code MCP registration
