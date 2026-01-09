# La Forge MCP - CLAUDE.md Snippet

Add this content to your user-level CLAUDE.md file to teach Claude Code
when and how to use La Forge's visual debugging tools.

**Location:**
- Claude Code: `~/.claude/CLAUDE.md` (or use `claude config get` to find it)
- Or add to any project's `CLAUDE.md`

---

**Copy everything below this line:**

---

## Visual CSS Debugging with La Forge MCP

You have access to `la-forge` MCP server for visual CSS debugging. Like a visor, it lets you see what you normally can't — the actual rendered visual state of CSS, not just the code.

### Core Principle

**Never assume the visual is correct just because the CSS code looks correct.** CSS cascade and inheritance can produce unexpected results that are invisible in source code. Use La Forge to verify.

### When to Use La Forge

Use these tools when:
- Working on CSS/HTML layouts
- Modifying styles that affect visual appearance
- The user says something "looks wrong" or "isn't matching"
- You need to verify your CSS changes actually worked
- Debugging why a style isn't being applied

### Workflow

#### Before Making CSS Changes
```
1. quick_visual_check() - Verify page is rendering (catches black screens, loading states)
2. capture_reference("component-name", selectors=[".header", ".content", etc])
```

#### After Making CSS Changes
```
1. verify_against_reference("component-name")
2. If failed, check:
   - problem_areas -> elements in regions that differ
   - style_differences -> exact property mismatches
   - css_rules -> which rules are overriding your styles
3. Use get_element_debug_info(selector) for deep dives
```

### Available Tools

| Tool | Use When |
|------|----------|
| `start_chrome(url)` | Starting a debugging session |
| `capture_reference(name, selectors)` | Saving a known-good state |
| `verify_against_reference(name)` | Checking if changes match expected |
| `quick_visual_check()` | Quick sanity check (black screens, etc) |
| `get_element_debug_info(selector)` | Deep dive on one element's styles |
| `compare_elements(selector, expected)` | Verify specific style values |

### Interpreting Results

When `verify_against_reference` returns a failure, look for:

1. **style_differences** — Which properties differ between reference and current
2. **css_rules** — Which CSS rules are competing (the later/more specific one wins)
3. **problem_areas.region.area** — Where on the page the difference is

**Common Causes of CSS Issues:**
- Global resets overriding component styles
- Lower specificity selectors being overridden
- Inherited properties from parent elements
- Order of stylesheet imports (later wins)

### Black Screen Detection

If `quick_visual_check()` returns `healthy: false`, the page is not rendering. Check:
- JavaScript errors in console
- Missing assets/failed imports
- Hydration errors
- Loading states that never resolve

### Example Debugging Session

```
User: "The header height is wrong after my changes"

You: Let me verify the visual state with La Forge.

> verify_against_reference("header")
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

The issue is that reset.css has `header { height: auto }` which is overriding
`.main-header { height: 64px }`. To fix this, increase specificity:

header.main-header { height: 64px; }
```

### Important Notes

1. **Capture references early** — Do this when the visual is correct, before making changes
2. **Include key selectors** — When capturing, list the important elements to track styles for
3. **Trust the diff** — If verification fails, the visual IS different, even if code looks right
4. **Check the rule chain** — css_rules shows you exactly what's overriding what

