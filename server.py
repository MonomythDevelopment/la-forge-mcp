#!/usr/bin/env python3
"""
La Forge MCP Server
===================
"I can see things others can't." - Geordi La Forge

A Model Context Protocol server for visual CSS debugging that provides:
- Screenshot capture and pixel-level diffing
- Computed style extraction and comparison
- CSS inheritance chain analysis
- Structured verification reports

Seeing what AI can't. Solving the "code is correct but visual is wrong"
problem that plagues AI-assisted CSS development.
"""

import asyncio
import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

# Use FastMCP for the decorator-based API
from mcp.server.fastmcp import FastMCP

# Initialize MCP server
mcp = FastMCP("la-forge")

# Global state
class State:
    debug_port: int = 9222
    chrome_process: Optional[subprocess.Popen] = None
    screenshots: dict = {}  # name -> path
    styles: dict = {}       # name -> {selector: computed_styles}

state = State()


# =============================================================================
# CDP (Chrome DevTools Protocol) Connection Utilities
# =============================================================================

async def get_cdp_websocket() -> Optional[str]:
    """Get WebSocket connection URL to Chrome DevTools Protocol."""
    import aiohttp
    
    port = state.debug_port
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://localhost:{port}/json", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                targets = await resp.json()
                
        for target in targets:
            if target.get("type") == "page":
                return target.get("webSocketDebuggerUrl")
        
        return None
    except Exception:
        return None


async def send_cdp_command(method: str, params: dict = None) -> dict:
    """Send a command via Chrome DevTools Protocol."""
    import aiohttp
    
    ws_url = await get_cdp_websocket()
    if not ws_url:
        raise Exception("No Chrome instance found. Start Chrome with --remote-debugging-port=9222")
    
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(ws_url) as ws:
            msg_id = 1
            await ws.send_json({
                "id": msg_id,
                "method": method,
                "params": params or {}
            })
            
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    if data.get("id") == msg_id:
                        if "error" in data:
                            raise Exception(data["error"].get("message", "CDP error"))
                        return data.get("result", {})
    
    return {}


async def execute_cdp_script(script: str):
    """Execute JavaScript in the browser and return result."""
    result = await send_cdp_command("Runtime.evaluate", {
        "expression": script,
        "returnByValue": True,
        "awaitPromise": True
    })
    
    if result.get("exceptionDetails"):
        raise Exception(result["exceptionDetails"].get("text", "Script error"))
    
    return result.get("result", {}).get("value")


# =============================================================================
# Screenshot and Diff Utilities  
# =============================================================================

async def capture_screenshot(full_page: bool = False) -> bytes:
    """Capture screenshot of current page."""
    params = {"format": "png"}
    if full_page:
        params["captureBeyondViewport"] = True
        
    result = await send_cdp_command("Page.captureScreenshot", params)
    return base64.b64decode(result["data"])


def run_pixelmatch(img1_path: str, img2_path: str, diff_path: str, threshold: float = 0.1) -> dict:
    """Run pixel comparison between two images."""
    from PIL import Image
    import numpy as np
    
    img1 = Image.open(img1_path).convert('RGBA')
    img2 = Image.open(img2_path).convert('RGBA')
    
    # Handle size mismatch
    if img1.size != img2.size:
        max_w = max(img1.width, img2.width)
        max_h = max(img1.height, img2.height)
        
        new_img1 = Image.new('RGBA', (max_w, max_h), (0, 0, 0, 0))
        new_img2 = Image.new('RGBA', (max_w, max_h), (0, 0, 0, 0))
        new_img1.paste(img1, (0, 0))
        new_img2.paste(img2, (0, 0))
        img1, img2 = new_img1, new_img2
    
    arr1 = np.array(img1)
    arr2 = np.array(img2)
    
    diff = np.abs(arr1.astype(float) - arr2.astype(float))
    threshold_val = threshold * 255
    pixel_diff = np.any(diff > threshold_val, axis=2)
    
    mismatched = int(np.sum(pixel_diff))
    total = int(pixel_diff.size)
    
    # Create diff image
    diff_img = img2.copy()
    diff_arr = np.array(diff_img)
    diff_arr[pixel_diff] = [255, 0, 255, 255]
    diff_img = Image.fromarray(diff_arr)
    diff_img.save(diff_path)
    
    regions = find_diff_regions(pixel_diff)
    
    return {
        "total_pixels": total,
        "mismatched_pixels": mismatched,
        "match_percentage": round((1 - mismatched / total) * 100, 2) if total > 0 else 100,
        "mismatch_percentage": round((mismatched / total) * 100, 2) if total > 0 else 0,
        "image_size": {"width": img1.width, "height": img1.height},
        "diff_regions": regions,
        "diff_image_path": diff_path
    }


def find_diff_regions(pixel_diff) -> list:
    """Find contiguous regions of differences."""
    try:
        from scipy import ndimage
        import numpy as np
        
        labeled, num_features = ndimage.label(pixel_diff)
        
        regions = []
        for i in range(1, min(num_features + 1, 11)):
            coords = np.where(labeled == i)
            if len(coords[0]) == 0:
                continue
                
            y_min, y_max = int(coords[0].min()), int(coords[0].max())
            x_min, x_max = int(coords[1].min()), int(coords[1].max())
            
            center_y = (y_min + y_max) // 2
            center_x = (x_min + x_max) // 2
            
            height, width = pixel_diff.shape
            quadrant = ""
            if center_y < height / 3:
                quadrant = "top"
            elif center_y > 2 * height / 3:
                quadrant = "bottom"
            else:
                quadrant = "middle"
                
            if center_x < width / 3:
                quadrant += "-left"
            elif center_x > 2 * width / 3:
                quadrant += "-right"
            else:
                quadrant += "-center"
            
            regions.append({
                "bounds": {"x": x_min, "y": y_min, "width": x_max - x_min, "height": y_max - y_min},
                "center": {"x": center_x, "y": center_y},
                "area": quadrant,
                "pixel_count": int(len(coords[0]))
            })
        
        regions.sort(key=lambda r: r["pixel_count"], reverse=True)
        return regions
        
    except ImportError:
        return []


# =============================================================================
# Computed Style Extraction
# =============================================================================

async def get_computed_styles_for_selector(selector: str) -> Optional[dict]:
    """Get computed styles for an element."""
    script = f"""
    (() => {{
        const el = document.querySelector({json.dumps(selector)});
        if (!el) return null;
        
        const styles = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        
        const props = [
            'display', 'position', 'top', 'right', 'bottom', 'left',
            'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
            'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
            'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'border', 'borderWidth', 'borderStyle', 'borderColor',
            'borderRadius', 'boxSizing',
            'flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'gap',
            'gridTemplateColumns', 'gridTemplateRows', 'gridGap',
            'backgroundColor', 'color', 'opacity',
            'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'textAlign',
            'overflow', 'overflowX', 'overflowY',
            'zIndex', 'visibility',
            'transform', 'transition'
        ];
        
        const computed = {{}};
        for (const prop of props) {{
            computed[prop] = styles.getPropertyValue(
                prop.replace(/([A-Z])/g, '-$1').toLowerCase()
            );
        }}
        
        return {{
            selector: {json.dumps(selector)},
            tagName: el.tagName,
            boundingRect: {{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }},
            computedStyles: computed
        }};
    }})()
    """
    return await execute_cdp_script(script)


async def get_css_rules_for_selector(selector: str) -> list:
    """Get all CSS rules that apply to an element."""
    script = f"""
    (() => {{
        const el = document.querySelector({json.dumps(selector)});
        if (!el) return [];
        
        const rules = [];
        
        for (const sheet of document.styleSheets) {{
            try {{
                for (const rule of sheet.cssRules || []) {{
                    if (rule.type === CSSRule.STYLE_RULE) {{
                        try {{
                            if (el.matches(rule.selectorText)) {{
                                rules.push({{
                                    selector: rule.selectorText,
                                    source: sheet.href || 'inline',
                                    styles: rule.style.cssText
                                }});
                            }}
                        }} catch (e) {{}}
                    }}
                }}
            }} catch (e) {{}}
        }}
        
        if (el.style.cssText) {{
            rules.push({{
                selector: 'inline',
                source: 'element',
                styles: el.style.cssText
            }});
        }}
        
        return rules;
    }})()
    """
    return await execute_cdp_script(script)


async def get_elements_in_region(bounds: dict) -> list:
    """Get elements at a given position."""
    script = f"""
    (() => {{
        const bounds = {json.dumps(bounds)};
        const elements = document.elementsFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
        );
        
        return elements.slice(0, 10).map(el => {{
            const rect = el.getBoundingClientRect();
            let selector = el.tagName.toLowerCase();
            if (el.id) selector += '#' + el.id;
            if (el.className && typeof el.className === 'string') {{
                selector += '.' + el.className.trim().split(/\\s+/).join('.');
            }}
            return {{
                selector: selector,
                tagName: el.tagName,
                id: el.id || null,
                className: el.className || null,
                bounds: {{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }}
            }};
        }});
    }})()
    """
    return await execute_cdp_script(script)


# =============================================================================
# MCP Tool Definitions
# =============================================================================

@mcp.tool()
async def start_chrome(
    url: str = "about:blank",
    port: int = 9222,
    headless: bool = False
) -> str:
    """
    Start Chrome with remote debugging enabled.
    
    Args:
        url: Initial URL to navigate to
        port: Debug port (default 9222)
        headless: Run in headless mode
    """
    state.debug_port = port
    
    chrome_paths = [
        os.environ.get("CHROME_PATH", ""),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ]
    
    chrome_path = None
    for path in chrome_paths:
        if path and os.path.exists(path):
            chrome_path = path
            break
    
    if not chrome_path:
        return json.dumps({
            "success": False,
            "error": "Chrome not found. Set CHROME_PATH environment variable."
        })
    
    args = [
        chrome_path,
        f"--remote-debugging-port={port}",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    
    if headless:
        args.append("--headless=new")
    
    args.append(url)
    
    try:
        state.chrome_process = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        
        await asyncio.sleep(2)
        
        ws = await get_cdp_websocket()
        if ws:
            return json.dumps({
                "success": True,
                "message": f"Chrome started on port {port}",
                "url": url
            })
        else:
            return json.dumps({
                "success": False,
                "error": "Chrome started but CDP connection failed"
            })
            
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@mcp.tool()
async def navigate(url: str) -> str:
    """
    Navigate to a URL in the connected browser.
    
    Args:
        url: URL to navigate to
    """
    try:
        await send_cdp_command("Page.navigate", {"url": url})
        await asyncio.sleep(1)
        return json.dumps({"success": True, "url": url})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@mcp.tool()
async def check_connection() -> str:
    """Check if connected to Chrome and return status."""
    try:
        ws = await get_cdp_websocket()
        if ws:
            result = await send_cdp_command("Page.getNavigationHistory")
            entries = result.get("entries", [{}])
            idx = result.get("currentIndex", 0)
            current_url = entries[idx].get("url", "unknown") if idx < len(entries) else "unknown"
            
            return json.dumps({
                "connected": True,
                "current_url": current_url,
                "debug_port": state.debug_port
            })
        else:
            return json.dumps({
                "connected": False,
                "error": "No Chrome instance found",
                "debug_port": state.debug_port
            })
    except Exception as e:
        return json.dumps({"connected": False, "error": str(e)})


@mcp.tool()
async def capture_reference(
    name: str,
    selectors: list[str] = None,
    full_page: bool = False
) -> str:
    """
    Capture a reference screenshot and computed styles for later comparison.
    
    Args:
        name: Name for this reference (e.g., "homepage", "header-component")
        selectors: CSS selectors to capture computed styles for
        full_page: Capture full page or just viewport
    """
    try:
        ref_dir = Path(tempfile.gettempdir()) / "la-forge-references"
        ref_dir.mkdir(exist_ok=True)
        
        screenshot_data = await capture_screenshot(full_page)
        screenshot_path = ref_dir / f"{name}.png"
        screenshot_path.write_bytes(screenshot_data)
        state.screenshots[name] = str(screenshot_path)
        
        styles_data = {}
        if selectors:
            for selector in selectors:
                try:
                    styles = await get_computed_styles_for_selector(selector)
                    if styles:
                        styles_data[selector] = styles
                except Exception as e:
                    styles_data[selector] = {"error": str(e)}
        
        state.styles[name] = styles_data
        
        styles_path = ref_dir / f"{name}_styles.json"
        styles_path.write_text(json.dumps(styles_data, indent=2))
        
        return json.dumps({
            "success": True,
            "name": name,
            "screenshot_path": str(screenshot_path),
            "styles_path": str(styles_path),
            "selectors_captured": list(styles_data.keys())
        })
        
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@mcp.tool()
async def verify_against_reference(
    name: str,
    threshold: float = 0.1,
    check_styles: bool = True
) -> str:
    """
    Compare current page against a saved reference.
    
    This is the main debugging tool. It will:
    1. Take a screenshot and diff against reference
    2. Identify regions that differ
    3. Extract computed styles for elements in problem areas
    4. Show CSS rules that might be causing issues
    
    Args:
        name: Name of the reference to compare against
        threshold: Pixel diff threshold (0-1, lower = stricter)
        check_styles: Also compare computed styles
    """
    try:
        ref_dir = Path(tempfile.gettempdir()) / "la-forge-references"
        
        if name not in state.screenshots:
            screenshot_path = ref_dir / f"{name}.png"
            styles_path = ref_dir / f"{name}_styles.json"
            
            if not screenshot_path.exists():
                return json.dumps({
                    "success": False,
                    "error": f"No reference found with name '{name}'. Use capture_reference first."
                })
            
            state.screenshots[name] = str(screenshot_path)
            if styles_path.exists():
                state.styles[name] = json.loads(styles_path.read_text())
        
        ref_path = state.screenshots[name]
        ref_styles = state.styles.get(name, {})
        
        current_data = await capture_screenshot()
        current_path = Path(tempfile.gettempdir()) / f"current_{name}.png"
        current_path.write_bytes(current_data)
        
        diff_path = Path(tempfile.gettempdir()) / f"diff_{name}.png"
        diff_result = run_pixelmatch(ref_path, str(current_path), str(diff_path), threshold)
        
        problem_analysis = []
        for region in diff_result["diff_regions"][:5]:
            analysis = {
                "region": region,
                "elements": [],
                "style_differences": []
            }
            
            try:
                elements = await get_elements_in_region(region["bounds"])
                if elements:
                    for el in elements[:3]:
                        el_info = {"selector": el["selector"], "computed_styles": None, "css_rules": None}
                        
                        try:
                            selector = el["selector"]
                            if el.get("id"):
                                selector = f"#{el['id']}"
                            
                            styles = await get_computed_styles_for_selector(selector)
                            el_info["computed_styles"] = styles
                            
                            if check_styles and selector in ref_styles:
                                ref_computed = ref_styles[selector].get("computedStyles", {})
                                current_computed = styles.get("computedStyles", {}) if styles else {}
                                
                                for prop, ref_val in ref_computed.items():
                                    curr_val = current_computed.get(prop, "")
                                    if ref_val != curr_val:
                                        analysis["style_differences"].append({
                                            "property": prop,
                                            "expected": ref_val,
                                            "actual": curr_val
                                        })
                            
                            rules = await get_css_rules_for_selector(selector)
                            el_info["css_rules"] = rules[:5] if rules else []
                            
                        except Exception as e:
                            el_info["error"] = str(e)
                        
                        analysis["elements"].append(el_info)
                        
            except Exception as e:
                analysis["error"] = str(e)
            
            problem_analysis.append(analysis)
        
        report = {
            "success": True,
            "passed": diff_result["match_percentage"] >= 99.0,
            "summary": {
                "match_percentage": diff_result["match_percentage"],
                "mismatch_percentage": diff_result["mismatch_percentage"],
                "mismatched_pixels": diff_result["mismatched_pixels"],
                "total_pixels": diff_result["total_pixels"],
                "problem_region_count": len(diff_result["diff_regions"])
            },
            "diff_image": str(diff_path),
            "current_screenshot": str(current_path),
            "reference_screenshot": ref_path,
            "problem_areas": problem_analysis
        }
        
        if report["passed"]:
            report["recommendation"] = "Visual match is acceptable (>99% match)"
        elif diff_result["mismatch_percentage"] > 50:
            report["recommendation"] = "Major visual differences detected. Check if the page loaded correctly."
        elif diff_result["mismatch_percentage"] > 10:
            report["recommendation"] = "Significant layout differences. Check problem_areas for CSS rule conflicts."
        else:
            report["recommendation"] = "Minor differences. Review style_differences for property mismatches."
        
        return json.dumps(report, indent=2)
        
    except Exception as e:
        import traceback
        return json.dumps({"success": False, "error": str(e), "traceback": traceback.format_exc()})


@mcp.tool()
async def get_element_debug_info(selector: str) -> str:
    """
    Get detailed debug information for a specific element.
    
    Includes computed styles, all matching CSS rules (with sources),
    and bounding box information.
    
    Args:
        selector: CSS selector for the element
    """
    try:
        styles = await get_computed_styles_for_selector(selector)
        if not styles:
            return json.dumps({"success": False, "error": f"Element not found: {selector}"})
        
        rules = await get_css_rules_for_selector(selector)
        
        parent_script = f"""
        (() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return [];
            
            const parents = [];
            let current = el.parentElement;
            while (current && current !== document.body) {{
                let sel = current.tagName.toLowerCase();
                if (current.id) sel += '#' + current.id;
                if (current.className && typeof current.className === 'string') {{
                    sel += '.' + current.className.trim().split(/\\s+/)[0];
                }}
                
                const styles = window.getComputedStyle(current);
                parents.push({{
                    selector: sel,
                    display: styles.display,
                    position: styles.position,
                    overflow: styles.overflow
                }});
                current = current.parentElement;
                if (parents.length >= 5) break;
            }}
            return parents;
        }})()
        """
        parents = await execute_cdp_script(parent_script)
        
        return json.dumps({
            "success": True,
            "selector": selector,
            "element": styles,
            "css_rules": rules,
            "parent_chain": parents,
            "tip": "Check css_rules for conflicting styles. Rules listed later or with higher specificity win."
        }, indent=2)
        
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@mcp.tool()
async def compare_elements(selector: str, expected: dict) -> str:
    """
    Compare an element's current styles against expected values.
    
    Args:
        selector: CSS selector for the element
        expected: Dictionary of expected style values, e.g., {"width": "100px", "backgroundColor": "rgb(255, 0, 0)"}
    """
    try:
        styles = await get_computed_styles_for_selector(selector)
        if not styles:
            return json.dumps({"success": False, "error": f"Element not found: {selector}"})
        
        computed = styles.get("computedStyles", {})
        
        results = {"passed": True, "selector": selector, "checks": [], "failures": []}
        
        for prop, expected_val in expected.items():
            kebab_prop = ''.join(['-' + c.lower() if c.isupper() else c for c in prop]).lstrip('-')
            actual_val = computed.get(kebab_prop, computed.get(prop, ""))
            
            match = normalize_css_value(expected_val) == normalize_css_value(actual_val)
            
            check = {"property": prop, "expected": expected_val, "actual": actual_val, "passed": match}
            results["checks"].append(check)
            
            if not match:
                results["passed"] = False
                results["failures"].append(check)
        
        return json.dumps(results, indent=2)
        
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


def normalize_css_value(value: str) -> str:
    """Normalize CSS values for comparison."""
    if not value:
        return ""
    value = str(value).strip().lower()
    value = ' '.join(value.split())
    if value in ['0', '0px', '0em', '0rem', '0%']:
        return '0px'
    return value


@mcp.tool()
async def quick_visual_check(url: str = None) -> str:
    """
    Quick visual sanity check - detects common issues like:
    - Black/blank screens
    - Page not loaded
    - Major layout issues
    
    Args:
        url: Optional URL to navigate to first
    """
    try:
        if url:
            await send_cdp_command("Page.navigate", {"url": url})
            await asyncio.sleep(2)
        
        screenshot_data = await capture_screenshot()
        
        from PIL import Image
        import numpy as np
        from io import BytesIO
        
        img = Image.open(BytesIO(screenshot_data)).convert('RGB')
        arr = np.array(img)
        
        mean_brightness = float(arr.mean())
        std_dev = float(arr.std())
        
        is_dark = mean_brightness < 20
        is_white = mean_brightness > 250
        is_single_color = std_dev < 5
        
        page_state = await execute_cdp_script("""
        (() => {
            return {
                readyState: document.readyState,
                bodyChildCount: document.body ? document.body.children.length : 0,
                title: document.title,
                hasContent: document.body ? document.body.innerText.length > 0 : false
            };
        })()
        """)
        
        issues = []
        if is_dark:
            issues.append("Screen appears black/very dark")
        if is_white:
            issues.append("Screen appears blank/white")
        if is_single_color:
            issues.append("Screen appears to be a single color (loading screen?)")
        if page_state and page_state.get("bodyChildCount", 0) == 0:
            issues.append("Page body has no child elements")
        if page_state and not page_state.get("hasContent", True):
            issues.append("Page has no visible text content")
        
        path = Path(tempfile.gettempdir()) / "la_forge_quick_check.png"
        path.write_bytes(screenshot_data)
        
        return json.dumps({
            "success": True,
            "healthy": len(issues) == 0,
            "issues": issues,
            "metrics": {"mean_brightness": mean_brightness, "std_deviation": std_dev},
            "page_state": page_state,
            "screenshot": str(path)
        }, indent=2)
        
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


@mcp.tool()
async def list_references() -> str:
    """List all saved references."""
    ref_dir = Path(tempfile.gettempdir()) / "la-forge-references"
    
    if not ref_dir.exists():
        return json.dumps({"references": []})
    
    refs = []
    for png_file in ref_dir.glob("*.png"):
        if not png_file.name.startswith(("current_", "diff_", "element_")):
            name = png_file.stem
            styles_file = ref_dir / f"{name}_styles.json"
            
            refs.append({
                "name": name,
                "screenshot": str(png_file),
                "has_styles": styles_file.exists()
            })
    
    return json.dumps({"references": refs})


@mcp.tool()
async def screenshot_element(selector: str, output_name: str = None) -> str:
    """
    Take a screenshot of a specific element.
    
    Args:
        selector: CSS selector for the element
        output_name: Optional name for the output file
    """
    try:
        script = f"""
        (() => {{
            const el = document.querySelector({json.dumps(selector)});
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return {{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }};
        }})()
        """
        bounds = await execute_cdp_script(script)
        
        if not bounds:
            return json.dumps({"success": False, "error": f"Element not found: {selector}"})
        
        result = await send_cdp_command("Page.captureScreenshot", {
            "format": "png",
            "clip": {
                "x": bounds["x"],
                "y": bounds["y"],
                "width": bounds["width"],
                "height": bounds["height"],
                "scale": 1
            }
        })
        
        name = output_name or selector.replace(' ', '_').replace('.', '').replace('#', '')
        path = Path(tempfile.gettempdir()) / f"element_{name}.png"
        path.write_bytes(base64.b64decode(result["data"]))
        
        return json.dumps({"success": True, "path": str(path), "bounds": bounds})
        
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    mcp.run()
