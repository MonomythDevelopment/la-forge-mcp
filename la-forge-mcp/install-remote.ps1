<#
.SYNOPSIS
    La Forge MCP - Remote Installation Script for Windows

.DESCRIPTION
    "I can see things others can't."
    Usage: irm https://raw.githubusercontent.com/MonomythDevelopment/la-forge-mcp/main/install-remote.ps1 | iex
#>

$ErrorActionPreference = "Stop"

Write-Host @"

  _             ______                    
 | |           |  ____|                   
 | |     __ _  | |__ ___  _ __ __ _  ___  
 | |    / _` | |  __/ _ \| '__/ _` |/ _ \ 
 | |___| (_| | | | | (_) | | | (_| |  __/ 
 |______\__,_| |_|  \___/|_|  \__, |\___| 
                               __/ |      
                              |___/   MCP 

"@ -ForegroundColor Cyan

Write-Host '"I can see things others cannot."' -ForegroundColor Blue
Write-Host ""

$InstallDir = "$env:USERPROFILE\.la-forge-mcp"
$RepoUrl = if ($env:LA_FORGE_REPO) { $env:LA_FORGE_REPO } else { "https://github.com/MonomythDevelopment/la-forge-mcp.git" }

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Blue

try {
    $nodeVersion = node -v 2>&1
    if ($nodeVersion -match "v(\d+)\.") {
        $major = [int]$Matches[1]
        if ($major -ge 18) {
            Write-Host "✓ Node.js $nodeVersion" -ForegroundColor Green
        } else {
            Write-Host "✗ Node.js 18+ required (found $nodeVersion)" -ForegroundColor Red
            exit 1
        }
    }
} catch {
    Write-Host "✗ Node.js not found" -ForegroundColor Red
    Write-Host "Install Node.js 18+ first: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

try {
    $npmVersion = npm -v 2>&1
    Write-Host "✓ npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ npm not found" -ForegroundColor Red
    exit 1
}

try {
    $null = Get-Command claude -ErrorAction Stop
    Write-Host "✓ Claude CLI found" -ForegroundColor Green
} catch {
    Write-Host "✗ Claude CLI not found" -ForegroundColor Red
    Write-Host "Install Claude Code first: https://claude.ai/code" -ForegroundColor Yellow
    exit 1
}

try {
    $null = Get-Command git -ErrorAction Stop
    Write-Host "✓ Git found" -ForegroundColor Green
} catch {
    Write-Host "✗ Git not found" -ForegroundColor Red
    exit 1
}

# Clone or update repository
Write-Host ""
Write-Host "Installing La Forge MCP..." -ForegroundColor Blue

if (Test-Path $InstallDir) {
    Write-Host "Existing installation found. Updating..." -ForegroundColor Yellow
    Push-Location $InstallDir
    git pull origin main 2>$null
    if (-not $?) { git pull origin master 2>$null }
} else {
    Write-Host "Cloning repository..." -ForegroundColor Blue
    git clone $RepoUrl $InstallDir
    Push-Location $InstallDir
}

# Install dependencies and build
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Blue
npm install
Write-Host "✓ Dependencies installed" -ForegroundColor Green

Write-Host ""
Write-Host "Building TypeScript..." -ForegroundColor Blue
npm run build
Write-Host "✓ Build complete" -ForegroundColor Green

# Register with Claude Code
Write-Host ""
Write-Host "Registering with Claude Code..." -ForegroundColor Blue

$ServerPath = "$InstallDir\dist\index.js"

$mcpList = claude mcp list 2>&1
if ($mcpList -match "la-forge") {
    claude mcp remove la-forge -s user 2>&1 | Out-Null
}

claude mcp add la-forge node $ServerPath -s user
Write-Host "✓ Registered with Claude Code" -ForegroundColor Green

Pop-Location

# Detect Chrome
Write-Host ""
Write-Host "Detecting Chrome..." -ForegroundColor Blue

$ChromePath = $null
$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $ChromePath = $path
        break
    }
}

if ($ChromePath) {
    Write-Host "✓ Chrome found: $ChromePath" -ForegroundColor Green
} else {
    Write-Host "⚠ Chrome not auto-detected. Set CHROME_PATH if needed." -ForegroundColor Yellow
}

# Done
Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║              Installation Complete!                        ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "La Forge MCP is now available in Claude Code."
Write-Host ""
Write-Host "Quick Start:" -ForegroundColor Blue
Write-Host "  1. Open Claude Code"
Write-Host "  2. Ask: `"Start Chrome and navigate to localhost:3000`""
Write-Host "  3. Ask: `"Capture a reference called 'homepage'`""
Write-Host "  4. Make CSS changes"
Write-Host "  5. Ask: `"Verify against the homepage reference`""
Write-Host ""
Write-Host "Tools available:" -ForegroundColor Blue
Write-Host "  • start_chrome(url)           • capture_reference(name)"
Write-Host "  • verify_against_reference()  • get_element_debug_info(selector)"
Write-Host "  • quick_visual_check()        • compare_elements(selector, expected)"
Write-Host ""
Write-Host '"It is not just what you look at, it is what you see."' -ForegroundColor Cyan
Write-Host ""
