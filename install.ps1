<#
.SYNOPSIS
    La Forge MCP - Local Installation Script for Windows

.DESCRIPTION
    "I can see things others can't."
    Run this after cloning the repository locally.
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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = if ($env:LA_FORGE_MCP_DIR) { $env:LA_FORGE_MCP_DIR } else { "$env:USERPROFILE\.la-forge-mcp" }

Write-Host "Source: $ScriptDir" -ForegroundColor Yellow
Write-Host "Install to: $InstallDir" -ForegroundColor Yellow
Write-Host ""

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Blue

try {
    $pythonVersion = python --version 2>&1
    if ($pythonVersion -match "Python (\d+)\.(\d+)") {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        if ($major -ge 3 -and $minor -ge 10) {
            Write-Host "✓ Python $major.$minor" -ForegroundColor Green
        } else {
            Write-Host "✗ Python 3.10+ required (found $major.$minor)" -ForegroundColor Red
            exit 1
        }
    }
} catch {
    Write-Host "✗ Python not found" -ForegroundColor Red
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

# Copy files to install directory (if different from source)
Write-Host ""
if ($ScriptDir -ne $InstallDir) {
    Write-Host "Copying files to $InstallDir..." -ForegroundColor Blue
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    Copy-Item "$ScriptDir\server.py" "$InstallDir\" -Force
    Copy-Item "$ScriptDir\requirements.txt" "$InstallDir\" -Force
    Copy-Item "$ScriptDir\pyproject.toml" "$InstallDir\" -Force
    Copy-Item "$ScriptDir\README.md" "$InstallDir\" -Force
    if (Test-Path "$ScriptDir\CLAUDE_SNIPPET.md") {
        Copy-Item "$ScriptDir\CLAUDE_SNIPPET.md" "$InstallDir\" -Force
    }
    Write-Host "✓ Files copied" -ForegroundColor Green
} else {
    Write-Host "Installing in place..." -ForegroundColor Blue
}

# Create virtual environment
Write-Host ""
Write-Host "Creating virtual environment..." -ForegroundColor Blue
Push-Location $InstallDir

if (-not (Test-Path ".venv")) {
    python -m venv .venv
    Write-Host "✓ Virtual environment created" -ForegroundColor Green
} else {
    Write-Host "Virtual environment exists" -ForegroundColor Yellow
}

# Install dependencies
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Blue
& ".\.venv\Scripts\pip.exe" install --upgrade pip 2>&1 | Out-Null
& ".\.venv\Scripts\pip.exe" install -r requirements.txt
Write-Host "✓ Dependencies installed" -ForegroundColor Green

# Get absolute paths
$PythonPath = "$InstallDir\.venv\Scripts\python.exe"
$ServerPath = "$InstallDir\server.py"

# Register with Claude Code
Write-Host ""
Write-Host "Registering with Claude Code..." -ForegroundColor Blue

$mcpList = claude mcp list 2>&1
if ($mcpList -match "la-forge") {
    Write-Host "Removing existing registration..." -ForegroundColor Yellow
    claude mcp remove la-forge -s user 2>&1 | Out-Null
}

claude mcp add la-forge $PythonPath $ServerPath -s user
Write-Host "✓ Registered with Claude Code (user level)" -ForegroundColor Green

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
    Write-Host "⚠ Chrome not auto-detected" -ForegroundColor Yellow
    Write-Host "  Set CHROME_PATH environment variable if needed" -ForegroundColor Yellow
}

# Verify installation
Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor Blue
$mcpList = claude mcp list 2>&1
if ($mcpList -match "la-forge") {
    Write-Host "✓ Installation verified" -ForegroundColor Green
} else {
    Write-Host "✗ Installation verification failed" -ForegroundColor Red
    exit 1
}

# Success message
Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║              Installation Complete!                        ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "La Forge MCP is now available in all your Claude Code sessions."
Write-Host ""
Write-Host "Quick Start:" -ForegroundColor Blue
Write-Host "  1. Open Claude Code"
Write-Host "  2. Ask: `"Start Chrome and navigate to localhost:3000`""
Write-Host "  3. Ask: `"Capture a reference called 'homepage'`""
Write-Host "  4. Make CSS changes"
Write-Host "  5. Ask: `"Verify against the homepage reference`""
Write-Host ""
Write-Host "Available Tools:" -ForegroundColor Blue
Write-Host "  • start_chrome(url)           • capture_reference(name)"
Write-Host "  • verify_against_reference()  • get_element_debug_info(selector)"
Write-Host "  • quick_visual_check()        • compare_elements(selector, expected)"
Write-Host ""
Write-Host "Installation Location: $InstallDir" -ForegroundColor Blue
Write-Host ""
Write-Host '"It is not just what you look at, it is what you see."' -ForegroundColor Cyan
Write-Host ""
