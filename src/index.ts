#!/usr/bin/env node
/**
 * La Forge MCP Server
 * ===================
 * "I can see things others can't." - Geordi La Forge
 *
 * A Model Context Protocol server for visual CSS debugging that provides:
 * - Screenshot capture and pixel-level diffing
 * - Computed style extraction and comparison
 * - CSS inheritance chain analysis
 * - Structured verification reports
 *
 * Seeing what AI can't. Solving the "code is correct but visual is wrong"
 * problem that plagues AI-assisted CSS development.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess } from "child_process";
import { WebSocket } from "ws";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// =============================================================================
// Types
// =============================================================================

interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

interface DiffRegion {
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  area: string;
  pixel_count: number;
}

interface DiffResult {
  total_pixels: number;
  mismatched_pixels: number;
  match_percentage: number;
  mismatch_percentage: number;
  image_size: { width: number; height: number };
  diff_regions: DiffRegion[];
  diff_image_path: string;
}

interface ComputedStyles {
  selector: string;
  tagName: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  computedStyles: Record<string, string>;
}

interface CSSRule {
  selector: string;
  source: string;
  styles: string;
}

interface ElementInfo {
  selector: string;
  tagName: string;
  id: string | null;
  className: string | null;
  bounds: { x: number; y: number; width: number; height: number };
}

// =============================================================================
// Global State
// =============================================================================

const state = {
  debugPort: 9222,
  chromeProcess: null as ChildProcess | null,
  screenshots: new Map<string, string>(),
  styles: new Map<string, Record<string, ComputedStyles>>(),
};

const REF_DIR = path.join(os.tmpdir(), "la-forge-references");

// Ensure reference directory exists
if (!fs.existsSync(REF_DIR)) {
  fs.mkdirSync(REF_DIR, { recursive: true });
}

// =============================================================================
// CDP (Chrome DevTools Protocol) Connection Utilities
// =============================================================================

async function getCDPWebSocketUrl(): Promise<string | null> {
  try {
    const response = await fetch(
      `http://localhost:${state.debugPort}/json`,
      { signal: AbortSignal.timeout(5000) }
    );
    const targets = (await response.json()) as Array<{
      type: string;
      webSocketDebuggerUrl?: string;
    }>;

    for (const target of targets) {
      if (target.type === "page" && target.webSocketDebuggerUrl) {
        return target.webSocketDebuggerUrl;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function sendCDPCommand(
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const wsUrl = await getCDPWebSocketUrl();
  if (!wsUrl) {
    throw new Error(
      "No Chrome instance found. Start Chrome with --remote-debugging-port=9222"
    );
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const msgId = 1;

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

    ws.on("message", (data) => {
      const response = JSON.parse(data.toString()) as CDPResponse;
      if (response.id === msgId) {
        ws.close();
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result || {});
        }
      }
    });

    ws.on("error", (err) => {
      reject(err);
    });

    setTimeout(() => {
      ws.close();
      reject(new Error("CDP command timeout"));
    }, 30000);
  });
}

async function executeCDPScript(script: string): Promise<unknown> {
  const result = await sendCDPCommand("Runtime.evaluate", {
    expression: script,
    returnByValue: true,
    awaitPromise: true,
  });

  if (result.exceptionDetails) {
    const details = result.exceptionDetails as { text?: string };
    throw new Error(details.text || "Script error");
  }

  const value = result.result as { value?: unknown };
  return value?.value;
}

// =============================================================================
// Screenshot and Diff Utilities
// =============================================================================

async function captureScreenshot(fullPage = false): Promise<Buffer> {
  const params: Record<string, unknown> = { format: "png" };
  if (fullPage) {
    params.captureBeyondViewport = true;
  }

  const result = await sendCDPCommand("Page.captureScreenshot", params);
  return Buffer.from(result.data as string, "base64");
}

/**
 * Connected components labeling using flood-fill algorithm.
 * This replaces scipy.ndimage.label()
 */
function findConnectedComponents(
  diffMask: boolean[],
  width: number,
  height: number
): number[] {
  const labels = new Array(diffMask.length).fill(0);
  let currentLabel = 0;

  const floodFill = (startX: number, startY: number, label: number) => {
    const stack: Array<[number, number]> = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const idx = y * width + x;

      if (
        x < 0 ||
        x >= width ||
        y < 0 ||
        y >= height ||
        !diffMask[idx] ||
        labels[idx] !== 0
      ) {
        continue;
      }

      labels[idx] = label;

      // 4-connectivity
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (diffMask[idx] && labels[idx] === 0) {
        currentLabel++;
        floodFill(x, y, currentLabel);
      }
    }
  }

  return labels;
}

function findDiffRegions(
  diffMask: boolean[],
  width: number,
  height: number
): DiffRegion[] {
  const labels = findConnectedComponents(diffMask, width, height);

  // Find unique labels and their pixel coordinates
  const regionPixels = new Map<number, Array<{ x: number; y: number }>>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const label = labels[y * width + x];
      if (label > 0) {
        if (!regionPixels.has(label)) {
          regionPixels.set(label, []);
        }
        regionPixels.get(label)!.push({ x, y });
      }
    }
  }

  const regions: DiffRegion[] = [];

  for (const [, pixels] of regionPixels) {
    if (pixels.length === 0) continue;

    const xs = pixels.map((p) => p.x);
    const ys = pixels.map((p) => p.y);

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    const centerX = Math.floor((xMin + xMax) / 2);
    const centerY = Math.floor((yMin + yMax) / 2);

    // Determine quadrant
    let quadrant = "";
    if (centerY < height / 3) {
      quadrant = "top";
    } else if (centerY > (2 * height) / 3) {
      quadrant = "bottom";
    } else {
      quadrant = "middle";
    }

    if (centerX < width / 3) {
      quadrant += "-left";
    } else if (centerX > (2 * width) / 3) {
      quadrant += "-right";
    } else {
      quadrant += "-center";
    }

    regions.push({
      bounds: { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin },
      center: { x: centerX, y: centerY },
      area: quadrant,
      pixel_count: pixels.length,
    });
  }

  // Sort by pixel count descending, limit to top 10
  regions.sort((a, b) => b.pixel_count - a.pixel_count);
  return regions.slice(0, 10);
}

async function runPixelMatch(
  img1Path: string,
  img2Path: string,
  diffPath: string,
  threshold = 0.1
): Promise<DiffResult> {
  // Load both images
  let img1 = sharp(img1Path);
  let img2 = sharp(img2Path);

  const meta1 = await img1.metadata();
  const meta2 = await img2.metadata();

  const width1 = meta1.width!;
  const height1 = meta1.height!;
  const width2 = meta2.width!;
  const height2 = meta2.height!;

  // Handle size mismatch by padding to max dimensions
  const maxWidth = Math.max(width1, width2);
  const maxHeight = Math.max(height1, height2);

  if (width1 !== maxWidth || height1 !== maxHeight) {
    img1 = sharp(img1Path).extend({
      right: maxWidth - width1,
      bottom: maxHeight - height1,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  if (width2 !== maxWidth || height2 !== maxHeight) {
    img2 = sharp(img2Path).extend({
      right: maxWidth - width2,
      bottom: maxHeight - height2,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  // Get raw pixel data (RGBA)
  const buf1 = await img1.raw().ensureAlpha().toBuffer();
  const buf2 = await img2.raw().ensureAlpha().toBuffer();

  const totalPixels = maxWidth * maxHeight;
  const thresholdVal = threshold * 255;
  const diffMask: boolean[] = new Array(totalPixels).fill(false);
  let mismatchedPixels = 0;

  // Create diff image buffer
  const diffBuf = Buffer.from(buf2);

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r1 = buf1[offset];
    const g1 = buf1[offset + 1];
    const b1 = buf1[offset + 2];
    const a1 = buf1[offset + 3];

    const r2 = buf2[offset];
    const g2 = buf2[offset + 1];
    const b2 = buf2[offset + 2];
    const a2 = buf2[offset + 3];

    const diffR = Math.abs(r1 - r2);
    const diffG = Math.abs(g1 - g2);
    const diffB = Math.abs(b1 - b2);
    const diffA = Math.abs(a1 - a2);

    if (
      diffR > thresholdVal ||
      diffG > thresholdVal ||
      diffB > thresholdVal ||
      diffA > thresholdVal
    ) {
      diffMask[i] = true;
      mismatchedPixels++;

      // Mark diff pixels as magenta
      diffBuf[offset] = 255;
      diffBuf[offset + 1] = 0;
      diffBuf[offset + 2] = 255;
      diffBuf[offset + 3] = 255;
    }
  }

  // Save diff image
  await sharp(diffBuf, {
    raw: { width: maxWidth, height: maxHeight, channels: 4 },
  })
    .png()
    .toFile(diffPath);

  const regions = findDiffRegions(diffMask, maxWidth, maxHeight);

  return {
    total_pixels: totalPixels,
    mismatched_pixels: mismatchedPixels,
    match_percentage:
      totalPixels > 0
        ? Math.round((1 - mismatchedPixels / totalPixels) * 10000) / 100
        : 100,
    mismatch_percentage:
      totalPixels > 0
        ? Math.round((mismatchedPixels / totalPixels) * 10000) / 100
        : 0,
    image_size: { width: maxWidth, height: maxHeight },
    diff_regions: regions,
    diff_image_path: diffPath,
  };
}

// =============================================================================
// Computed Style Extraction
// =============================================================================

async function getComputedStylesForSelector(
  selector: string
): Promise<ComputedStyles | null> {
  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
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
      
      const computed = {};
      for (const prop of props) {
        computed[prop] = styles.getPropertyValue(
          prop.replace(/([A-Z])/g, '-$1').toLowerCase()
        );
      }
      
      return {
        selector: ${JSON.stringify(selector)},
        tagName: el.tagName,
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        computedStyles: computed
      };
    })()
  `;

  return (await executeCDPScript(script)) as ComputedStyles | null;
}

async function getCSSRulesForSelector(selector: string): Promise<CSSRule[]> {
  const script = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return [];
      
      const rules = [];
      
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule.type === CSSRule.STYLE_RULE) {
              try {
                if (el.matches(rule.selectorText)) {
                  rules.push({
                    selector: rule.selectorText,
                    source: sheet.href || 'inline',
                    styles: rule.style.cssText
                  });
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
      
      if (el.style.cssText) {
        rules.push({
          selector: 'inline',
          source: 'element',
          styles: el.style.cssText
        });
      }
      
      return rules;
    })()
  `;

  return ((await executeCDPScript(script)) as CSSRule[]) || [];
}

async function getElementsInRegion(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<ElementInfo[]> {
  const script = `
    (() => {
      const bounds = ${JSON.stringify(bounds)};
      const elements = document.elementsFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2
      );
      
      return elements.slice(0, 10).map(el => {
        const rect = el.getBoundingClientRect();
        let selector = el.tagName.toLowerCase();
        if (el.id) selector += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
          selector += '.' + el.className.trim().split(/\\s+/).join('.');
        }
        return {
          selector: selector,
          tagName: el.tagName,
          id: el.id || null,
          className: el.className || null,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      });
    })()
  `;

  return ((await executeCDPScript(script)) as ElementInfo[]) || [];
}

// =============================================================================
// Tool Implementations
// =============================================================================

async function startChrome(
  url = "about:blank",
  port = 9222,
  headless = false
): Promise<string> {
  state.debugPort = port;

  const chromePaths = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean) as string[];

  let chromePath: string | null = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      chromePath = p;
      break;
    }
  }

  if (!chromePath) {
    return JSON.stringify({
      success: false,
      error: "Chrome not found. Set CHROME_PATH environment variable.",
    });
  }

  const args = [
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  if (headless) {
    args.push("--headless=new");
  }

  args.push(url);

  try {
    state.chromeProcess = spawn(chromePath, args, {
      detached: true,
      stdio: "ignore",
    });
    state.chromeProcess.unref();

    // Wait for Chrome to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const ws = await getCDPWebSocketUrl();
    if (ws) {
      return JSON.stringify({
        success: true,
        message: `Chrome started on port ${port}`,
        url,
      });
    } else {
      return JSON.stringify({
        success: false,
        error: "Chrome started but CDP connection failed",
      });
    }
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function navigate(url: string): Promise<string> {
  try {
    await sendCDPCommand("Page.navigate", { url });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return JSON.stringify({ success: true, url });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function checkConnection(): Promise<string> {
  try {
    const ws = await getCDPWebSocketUrl();
    if (ws) {
      const result = await sendCDPCommand("Page.getNavigationHistory");
      const entries = (result.entries || [{}]) as Array<{ url?: string }>;
      const idx = (result.currentIndex as number) || 0;
      const currentUrl =
        idx < entries.length ? entries[idx]?.url || "unknown" : "unknown";

      return JSON.stringify({
        connected: true,
        current_url: currentUrl,
        debug_port: state.debugPort,
      });
    } else {
      return JSON.stringify({
        connected: false,
        error: "No Chrome instance found",
        debug_port: state.debugPort,
      });
    }
  } catch (err) {
    return JSON.stringify({
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function captureReference(
  name: string,
  selectors?: string[],
  fullPage = false
): Promise<string> {
  try {
    const screenshotData = await captureScreenshot(fullPage);
    const screenshotPath = path.join(REF_DIR, `${name}.png`);
    fs.writeFileSync(screenshotPath, screenshotData);
    state.screenshots.set(name, screenshotPath);

    const stylesData: Record<string, ComputedStyles> = {};
    if (selectors && selectors.length > 0) {
      for (const selector of selectors) {
        try {
          const styles = await getComputedStylesForSelector(selector);
          if (styles) {
            stylesData[selector] = styles;
          }
        } catch (err) {
          // Skip failed selectors
        }
      }
    }

    state.styles.set(name, stylesData);

    const stylesPath = path.join(REF_DIR, `${name}_styles.json`);
    fs.writeFileSync(stylesPath, JSON.stringify(stylesData, null, 2));

    return JSON.stringify({
      success: true,
      name,
      screenshot_path: screenshotPath,
      styles_path: stylesPath,
      selectors_captured: Object.keys(stylesData),
    });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function verifyAgainstReference(
  name: string,
  threshold = 0.1,
  checkStyles = true
): Promise<string> {
  try {
    // Load reference if not in memory
    if (!state.screenshots.has(name)) {
      const screenshotPath = path.join(REF_DIR, `${name}.png`);
      const stylesPath = path.join(REF_DIR, `${name}_styles.json`);

      if (!fs.existsSync(screenshotPath)) {
        return JSON.stringify({
          success: false,
          error: `No reference found with name '${name}'. Use capture_reference first.`,
        });
      }

      state.screenshots.set(name, screenshotPath);
      if (fs.existsSync(stylesPath)) {
        state.styles.set(name, JSON.parse(fs.readFileSync(stylesPath, "utf-8")));
      }
    }

    const refPath = state.screenshots.get(name)!;
    const refStyles = state.styles.get(name) || {};

    // Capture current state
    const currentData = await captureScreenshot();
    const currentPath = path.join(REF_DIR, `current_${name}.png`);
    fs.writeFileSync(currentPath, currentData);

    // Run diff
    const diffPath = path.join(REF_DIR, `diff_${name}.png`);
    const diffResult = await runPixelMatch(refPath, currentPath, diffPath, threshold);

    // Analyze problem areas
    const problemAnalysis: Array<{
      region: DiffRegion;
      elements: Array<{
        selector: string;
        computed_styles: ComputedStyles | null;
        css_rules: CSSRule[];
        error?: string;
      }>;
      style_differences: Array<{
        property: string;
        expected: string;
        actual: string;
      }>;
      error?: string;
    }> = [];

    for (const region of diffResult.diff_regions.slice(0, 5)) {
      const analysis: (typeof problemAnalysis)[0] = {
        region,
        elements: [],
        style_differences: [],
      };

      try {
        const elements = await getElementsInRegion(region.bounds);
        if (elements && elements.length > 0) {
          for (const el of elements.slice(0, 3)) {
            const elInfo: (typeof analysis.elements)[0] = {
              selector: el.selector,
              computed_styles: null,
              css_rules: [],
            };

            try {
              let selector = el.selector;
              if (el.id) {
                selector = `#${el.id}`;
              }

              const styles = await getComputedStylesForSelector(selector);
              elInfo.computed_styles = styles;

              if (checkStyles && refStyles[selector]) {
                const refComputed = refStyles[selector].computedStyles || {};
                const currentComputed = styles?.computedStyles || {};

                for (const [prop, refVal] of Object.entries(refComputed)) {
                  const currVal = currentComputed[prop] || "";
                  if (refVal !== currVal) {
                    analysis.style_differences.push({
                      property: prop,
                      expected: refVal,
                      actual: currVal,
                    });
                  }
                }
              }

              const rules = await getCSSRulesForSelector(selector);
              elInfo.css_rules = rules.slice(0, 5);
            } catch (err) {
              elInfo.error = err instanceof Error ? err.message : String(err);
            }

            analysis.elements.push(elInfo);
          }
        }
      } catch (err) {
        analysis.error = err instanceof Error ? err.message : String(err);
      }

      problemAnalysis.push(analysis);
    }

    const passed = diffResult.match_percentage >= 99.0;

    let recommendation: string;
    if (passed) {
      recommendation = "Visual match is acceptable (>99% match)";
    } else if (diffResult.mismatch_percentage > 50) {
      recommendation =
        "Major visual differences detected. Check if the page loaded correctly.";
    } else if (diffResult.mismatch_percentage > 10) {
      recommendation =
        "Significant layout differences. Check problem_areas for CSS rule conflicts.";
    } else {
      recommendation =
        "Minor differences. Review style_differences for property mismatches.";
    }

    return JSON.stringify(
      {
        success: true,
        passed,
        summary: {
          match_percentage: diffResult.match_percentage,
          mismatch_percentage: diffResult.mismatch_percentage,
          mismatched_pixels: diffResult.mismatched_pixels,
          total_pixels: diffResult.total_pixels,
          problem_region_count: diffResult.diff_regions.length,
        },
        diff_image: diffPath,
        current_screenshot: currentPath,
        reference_screenshot: refPath,
        problem_areas: problemAnalysis,
        recommendation,
      },
      null,
      2
    );
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

async function getElementDebugInfo(selector: string): Promise<string> {
  try {
    const styles = await getComputedStylesForSelector(selector);
    if (!styles) {
      return JSON.stringify({
        success: false,
        error: `Element not found: ${selector}`,
      });
    }

    const rules = await getCSSRulesForSelector(selector);

    const parentScript = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return [];
        
        const parents = [];
        let current = el.parentElement;
        while (current && current !== document.body) {
          let sel = current.tagName.toLowerCase();
          if (current.id) sel += '#' + current.id;
          if (current.className && typeof current.className === 'string') {
            sel += '.' + current.className.trim().split(/\\s+/)[0];
          }
          
          const styles = window.getComputedStyle(current);
          parents.push({
            selector: sel,
            display: styles.display,
            position: styles.position,
            overflow: styles.overflow
          });
          current = current.parentElement;
          if (parents.length >= 5) break;
        }
        return parents;
      })()
    `;
    const parents = await executeCDPScript(parentScript);

    return JSON.stringify(
      {
        success: true,
        selector,
        element: styles,
        css_rules: rules,
        parent_chain: parents,
        tip: "Check css_rules for conflicting styles. Rules listed later or with higher specificity win.",
      },
      null,
      2
    );
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function compareElements(
  selector: string,
  expected: Record<string, string>
): Promise<string> {
  try {
    const styles = await getComputedStylesForSelector(selector);
    if (!styles) {
      return JSON.stringify({
        success: false,
        error: `Element not found: ${selector}`,
      });
    }

    const computed = styles.computedStyles;

    const results: {
      passed: boolean;
      selector: string;
      checks: Array<{
        property: string;
        expected: string;
        actual: string;
        passed: boolean;
      }>;
      failures: Array<{
        property: string;
        expected: string;
        actual: string;
        passed: boolean;
      }>;
    } = {
      passed: true,
      selector,
      checks: [],
      failures: [],
    };

    for (const [prop, expectedVal] of Object.entries(expected)) {
      // Convert camelCase to kebab-case
      const kebabProp = prop
        .replace(/([A-Z])/g, "-$1")
        .toLowerCase()
        .replace(/^-/, "");
      const actualVal = computed[kebabProp] || computed[prop] || "";

      const normalizedExpected = normalizeCSSValue(expectedVal);
      const normalizedActual = normalizeCSSValue(actualVal);
      const match = normalizedExpected === normalizedActual;

      const check = {
        property: prop,
        expected: expectedVal,
        actual: actualVal,
        passed: match,
      };
      results.checks.push(check);

      if (!match) {
        results.passed = false;
        results.failures.push(check);
      }
    }

    return JSON.stringify(results, null, 2);
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function normalizeCSSValue(value: string): string {
  if (!value) return "";
  let normalized = String(value).trim().toLowerCase();
  normalized = normalized.replace(/\s+/g, " ");
  if (["0", "0px", "0em", "0rem", "0%"].includes(normalized)) {
    return "0px";
  }
  return normalized;
}

async function quickVisualCheck(url?: string): Promise<string> {
  try {
    if (url) {
      await sendCDPCommand("Page.navigate", { url });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const screenshotData = await captureScreenshot();

    // Analyze brightness using sharp
    const { data, info } = await sharp(screenshotData)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = info.width * info.height;
    let totalBrightness = 0;
    let brightnessValues: number[] = [];

    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      totalBrightness += brightness;
      brightnessValues.push(brightness);
    }

    const meanBrightness = totalBrightness / pixels;

    // Calculate standard deviation
    const variance =
      brightnessValues.reduce(
        (sum, val) => sum + Math.pow(val - meanBrightness, 2),
        0
      ) / pixels;
    const stdDev = Math.sqrt(variance);

    const isDark = meanBrightness < 20;
    const isWhite = meanBrightness > 250;
    const isSingleColor = stdDev < 5;

    const pageState = (await executeCDPScript(`
      (() => {
        return {
          readyState: document.readyState,
          bodyChildCount: document.body ? document.body.children.length : 0,
          title: document.title,
          hasContent: document.body ? document.body.innerText.length > 0 : false
        };
      })()
    `)) as {
      readyState: string;
      bodyChildCount: number;
      title: string;
      hasContent: boolean;
    };

    const issues: string[] = [];
    if (isDark) {
      issues.push("Screen appears black/very dark");
    }
    if (isWhite) {
      issues.push("Screen appears blank/white");
    }
    if (isSingleColor) {
      issues.push("Screen appears to be a single color (loading screen?)");
    }
    if (pageState && pageState.bodyChildCount === 0) {
      issues.push("Page body has no child elements");
    }
    if (pageState && !pageState.hasContent) {
      issues.push("Page has no visible text content");
    }

    const screenshotPath = path.join(REF_DIR, "la_forge_quick_check.png");
    fs.writeFileSync(screenshotPath, screenshotData);

    return JSON.stringify(
      {
        success: true,
        healthy: issues.length === 0,
        issues,
        metrics: { mean_brightness: meanBrightness, std_deviation: stdDev },
        page_state: pageState,
        screenshot: screenshotPath,
      },
      null,
      2
    );
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function listReferences(): Promise<string> {
  if (!fs.existsSync(REF_DIR)) {
    return JSON.stringify({ references: [] });
  }

  const refs: Array<{
    name: string;
    screenshot: string;
    has_styles: boolean;
  }> = [];

  const files = fs.readdirSync(REF_DIR);
  for (const file of files) {
    if (
      file.endsWith(".png") &&
      !file.startsWith("current_") &&
      !file.startsWith("diff_") &&
      !file.startsWith("element_") &&
      !file.startsWith("la_forge_")
    ) {
      const name = file.replace(".png", "");
      const stylesFile = path.join(REF_DIR, `${name}_styles.json`);

      refs.push({
        name,
        screenshot: path.join(REF_DIR, file),
        has_styles: fs.existsSync(stylesFile),
      });
    }
  }

  return JSON.stringify({ references: refs });
}

async function screenshotElement(
  selector: string,
  outputName?: string
): Promise<string> {
  try {
    const bounds = (await executeCDPScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `)) as { x: number; y: number; width: number; height: number } | null;

    if (!bounds) {
      return JSON.stringify({
        success: false,
        error: `Element not found: ${selector}`,
      });
    }

    const result = await sendCDPCommand("Page.captureScreenshot", {
      format: "png",
      clip: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        scale: 1,
      },
    });

    const name =
      outputName ||
      selector.replace(/\s/g, "_").replace(/\./g, "").replace(/#/g, "");
    const filePath = path.join(REF_DIR, `element_${name}.png`);
    fs.writeFileSync(filePath, Buffer.from(result.data as string, "base64"));

    return JSON.stringify({ success: true, path: filePath, bounds });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// MCP Server Setup
// =============================================================================

const tools: Tool[] = [
  {
    name: "start_chrome",
    description: "Start Chrome with remote debugging enabled",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "Initial URL to navigate to",
          default: "about:blank",
        },
        port: {
          type: "number",
          description: "Debug port (default 9222)",
          default: 9222,
        },
        headless: {
          type: "boolean",
          description: "Run in headless mode",
          default: false,
        },
      },
    },
  },
  {
    name: "navigate",
    description: "Navigate to a URL in the connected browser",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "URL to navigate to" },
      },
      required: ["url"],
    },
  },
  {
    name: "check_connection",
    description: "Check if connected to Chrome and return status",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "capture_reference",
    description:
      "Capture a reference screenshot and computed styles for later comparison",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name for this reference (e.g., 'homepage', 'header-component')",
        },
        selectors: {
          type: "array",
          items: { type: "string" },
          description: "CSS selectors to capture computed styles for",
        },
        full_page: {
          type: "boolean",
          description: "Capture full page or just viewport",
          default: false,
        },
      },
      required: ["name"],
    },
  },
  {
    name: "verify_against_reference",
    description:
      "Compare current page against a saved reference. This is the main debugging tool.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the reference to compare against",
        },
        threshold: {
          type: "number",
          description: "Pixel diff threshold (0-1, lower = stricter)",
          default: 0.1,
        },
        check_styles: {
          type: "boolean",
          description: "Also compare computed styles",
          default: true,
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_element_debug_info",
    description:
      "Get detailed debug information for a specific element including computed styles, CSS rules, and parent chain",
    inputSchema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the element",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "compare_elements",
    description: "Compare an element's current styles against expected values",
    inputSchema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the element",
        },
        expected: {
          type: "object",
          description:
            'Dictionary of expected style values, e.g., {"width": "100px", "backgroundColor": "rgb(255, 0, 0)"}',
        },
      },
      required: ["selector", "expected"],
    },
  },
  {
    name: "quick_visual_check",
    description:
      "Quick visual sanity check - detects black/blank screens, loading states, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "Optional URL to navigate to first",
        },
      },
    },
  },
  {
    name: "list_references",
    description: "List all saved references",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "screenshot_element",
    description: "Take a screenshot of a specific element",
    inputSchema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the element",
        },
        output_name: {
          type: "string",
          description: "Optional name for the output file",
        },
      },
      required: ["selector"],
    },
  },
];

const server = new Server(
  { name: "la-forge", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "start_chrome":
        result = await startChrome(
          (args?.url as string) || "about:blank",
          (args?.port as number) || 9222,
          (args?.headless as boolean) || false
        );
        break;
      case "navigate":
        result = await navigate(args?.url as string);
        break;
      case "check_connection":
        result = await checkConnection();
        break;
      case "capture_reference":
        result = await captureReference(
          args?.name as string,
          args?.selectors as string[] | undefined,
          (args?.full_page as boolean) || false
        );
        break;
      case "verify_against_reference":
        result = await verifyAgainstReference(
          args?.name as string,
          (args?.threshold as number) || 0.1,
          args?.check_styles !== false
        );
        break;
      case "get_element_debug_info":
        result = await getElementDebugInfo(args?.selector as string);
        break;
      case "compare_elements":
        result = await compareElements(
          args?.selector as string,
          args?.expected as Record<string, string>
        );
        break;
      case "quick_visual_check":
        result = await quickVisualCheck(args?.url as string | undefined);
        break;
      case "list_references":
        result = await listReferences();
        break;
      case "screenshot_element":
        result = await screenshotElement(
          args?.selector as string,
          args?.output_name as string | undefined
        );
        break;
      default:
        result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
    };
  }
});

// =============================================================================
// Entry Point
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
