# La Forge MCP

> *"I can see things others can't."* — Geordi La Forge

A Model Context Protocol (MCP) server that gives AI coding assistants the visual perception they lack. Named after the *Enterprise*'s chief engineer who could see what others couldn't.

## The Problem

When AI coding assistants (like Claude Code) work on CSS/HTML:
- They can see the code, but can't truly "see" the rendered result
- Screenshots are interpreted semantically, not pixel-precisely  
- CSS inheritance and cascade can cause unexpected results invisible in source code
- A black screen might be reported as "looks good" because there's nothing to semantically parse

## The Solution

La Forge provides:
- **Pixel-level diffing** — Programmatic comparison that catches *any* visual difference
- **Computed style extraction** — See what CSS is *actually* applied after cascade
- **CSS rule chain analysis** — Find which rules are overriding your styles
- **Problem region detection** — Automatically identify which areas differ

---

## Quick Install

### One-Liner (macOS/Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/MonomythDevelopment/la-forge-mcp/main/install-remote.sh | bash
```

### One-Liner (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/MonomythDevelopment/la-forge-mcp/main/install-remote.ps1 | iex
```



### Manual Install

```bash
# Clone the repo
git clone https://github.com/MonomythDevelopment/la-forge-mcp.git ~/.la-forge-mcp
cd ~/.la-forge-mcp

# Run installer
chmod +x install.sh
./install.sh
```

---

## Requirements

- Python 3.10+
- Claude Code CLI (`claude` command)
- Google Chrome or Chromium

---

## Quick Start

### 1. Start Chrome and Navigate to Your App

```
start_chrome("http://localhost:3000")
```

### 2. Capture a Reference (When Things Look Right)

```
capture_reference("homepage", selectors=[".header", ".nav", ".hero", ".footer"])
```

### 3. Make Your CSS Changes

Edit your code as normal...

### 4. Verify Against Reference

```
verify_against_reference("homepage")
```

Returns a detailed report:
```json
{
  "passed": false,
  "summary": {
    "match_percentage": 94.2,
    "problem_region_count": 2
  },
  "problem_areas": [{
    "region": {"area": "top-center"},
    "style_differences": [
      {"property": "height", "expected": "64px", "actual": "48px"}
    ],
    "css_rules": [
      {"selector": ".header", "source": "component.css"},
      {"selector": "header", "source": "reset.css"}
    ]
  }],
  "recommendation": "Check problem_areas for CSS rule conflicts."
}
```

---

## Available Tools

### Chrome Management

| Tool | Description |
|------|-------------|
| `start_chrome(url, port, headless)` | Start Chrome with debugging enabled |
| `navigate(url)` | Navigate to a URL |
| `check_connection()` | Verify Chrome connection status |

### Reference Management

| Tool | Description |
|------|-------------|
| `capture_reference(name, selectors, full_page)` | Save screenshot + computed styles as reference |
| `list_references()` | List all saved references |

### Visual Verification

| Tool | Description |
|------|-------------|
| `verify_against_reference(name, threshold)` | **Main tool** — Compare current state against reference |
| `quick_visual_check(url)` | Quick sanity check for black screens, loading states |

### Element Analysis

| Tool | Description |
|------|-------------|
| `get_element_debug_info(selector)` | Deep dive on element's computed styles + rule chain |
| `compare_elements(selector, expected)` | Compare element against expected style values |
| `screenshot_element(selector)` | Screenshot a single element |

---

## Example Debugging Session

```
User: "The header height seems wrong after my changes"

Claude: Let me check what's happening.

> verify_against_reference("homepage")
{
  "passed": false,
  "problem_areas": [{
    "style_differences": [
      {"property": "height", "expected": "64px", "actual": "48px"}
    ],
    "css_rules": [
      {"selector": ".main-header", "source": "header.css", "styles": "height: 64px"},
      {"selector": "header", "source": "reset.css", "styles": "height: auto"}
    ]
  }]
}

Claude: Found it! Your reset.css has `header { height: auto }` which is 
overriding `.main-header { height: 64px }`. The reset rule appears later 
in the cascade.

Fix options:
1. Increase specificity: `header.main-header { height: 64px }`
2. Use !important: `.main-header { height: 64px !important }`
3. Reorder stylesheet imports
```

---

## Black Screen Detection

The `quick_visual_check()` tool programmatically detects rendering issues:

```json
{
  "healthy": false,
  "issues": [
    "Screen appears black/very dark",
    "Page has no visible text content"
  ],
  "metrics": {
    "mean_brightness": 2.3,
    "std_deviation": 1.1
  }
}
```

No more "looks good" on a black screen!

---

## CLAUDE.md Integration

For best results, add the snippet from `CLAUDE_SNIPPET.md` to your user-level CLAUDE.md:

```bash
# Find your Claude config location
claude config get

# Append the snippet
cat CLAUDE_SNIPPET.md >> ~/.claude/CLAUDE.md
```

This teaches Claude Code when and how to use the visual debugging tools automatically.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHROME_PATH` | Path to Chrome executable | Auto-detected |
| `CHROME_DEBUG_PORT` | Port for Chrome debugging | 9222 |

### Setting Chrome Path

If Chrome isn't auto-detected:

```bash
# macOS
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Linux  
export CHROME_PATH="/usr/bin/google-chrome"

# Windows
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

---

## How It Works

### Pixel Diffing
Uses PIL/NumPy to compare images pixel-by-pixel. Outputs a diff image with mismatched areas highlighted in magenta. Connected components analysis (scipy) identifies distinct problem regions.

### Computed Style Extraction  
Uses Chrome DevTools Protocol to query `window.getComputedStyle()` for any element. Shows the *actual* applied values after CSS cascade, not just source file values.

### CSS Rule Chain
Iterates through all stylesheets via CDP to find every rule matching an element. Shows source file, selector, and styles. Reveals which rule is "winning" for each property.

---

## Troubleshooting

### Server won't start

```bash
# Test directly
~/.la-forge-mcp/.venv/bin/python ~/.la-forge-mcp/server.py

# Should hang waiting for input (Ctrl+C to exit)
# If errors appear, check Python version and dependencies
```

### "Chrome not found"

Set `CHROME_PATH` environment variable or pass `chrome_path` to `start_chrome()`.

### "No Chrome instance found"  

Start Chrome manually with debugging:
```bash
google-chrome --remote-debugging-port=9222
```

Or use `start_chrome()` tool which does this automatically.

### Module import errors

Reinstall dependencies:
```bash
cd ~/.la-forge-mcp
source .venv/bin/activate
pip install --upgrade mcp aiohttp pillow numpy scipy
```

### Claude Code shows "Failed to connect"

1. Check paths are absolute: `claude mcp get la-forge`
2. Test server manually (see above)
3. Remove and re-add:
   ```bash
   claude mcp remove la-forge -s user
   claude mcp add la-forge ~/.la-forge-mcp/.venv/bin/python ~/.la-forge-mcp/server.py -s user
   ```

---

## Uninstall

```bash
# Remove from Claude Code
claude mcp remove la-forge -s user

# Remove files
rm -rf ~/.la-forge-mcp
```

---

## License

MIT — see [LICENSE](LICENSE)

---

## Why "La Forge"?

Geordi La Forge, Chief Engineer of the *USS Enterprise-D*, was born blind but could see more than anyone else through his VISOR. This tool does the same for AI coding assistants — giving them the visual perception they lack to see what's really happening with your CSS.

*"It's not just what you look at, it's what you see."*
