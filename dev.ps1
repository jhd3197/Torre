# Torre (torre.sh) local dev helper: Windows PowerShell, or PowerShell 7 (pwsh) on Windows, macOS or Linux
#
#   .\dev.ps1                start the studio API + the UI with live reload (http://127.0.0.1:5173)
#                            Python changes restart the API; UI changes reload the page.
#   .\dev.ps1 serve          build the UI if it changed, then run the studio (http://127.0.0.1:1886)
#   .\dev.ps1 serve -Open    the same, opening the browser (start-studio.cmd)
#   .\dev.ps1 ui             UI dev server only, against a studio already running on 1886
#   .\dev.ps1 validate       watch Python + UI files; type-check, lint, test and build on every save
#   .\dev.ps1 validate once  the same checks once (exit code 1 on any failure)
#   .\dev.ps1 test           Python tests
#   .\dev.ps1 test-web       UI tests (vitest)
#   .\dev.ps1 lint           lint the UI (ESLint: hooks rules, typescript-eslint)
#   .\dev.ps1 format         format the stylesheets (Prettier on web/src/styles)
#   .\dev.ps1 build          build the UI into torre/ui
#   .\dev.ps1 check          everything: Python tests, type-check, lint, UI tests, build
#   .\dev.ps1 setup          create .venv, install Python + Node dependencies, build the UI
#   .\dev.ps1 analyze <args> run torre/analysis/analyze.py (e.g. .\dev.ps1 analyze --limit 20)
#   .\dev.ps1 lessons [slugs] check the chess in lessons/ with Stockfish (torre/tools/verify_lessons.py)
#   .\dev.ps1 masters [names] download the legends' games (torre/games/download_masters.py)
#   .\dev.ps1 story <args>   build a game-story lesson (torre/tools/game_story.py find|moments|skeleton ...)
#   .\dev.ps1 art fetch [built]   download the cut images the app shows (web/public/art);
#                            the original source sheets stay in the private art pipeline.
#   .\dev.ps1 art publish [built] zip and replace the built images on the public release
#   .\dev.ps1 art [stages]   cut art/source into web/public/art (e.g. .\dev.ps1 art pieces grades);
#                            needs rembg in the system Python: pip install "rembg[cpu]" opencv-python-headless
#   .\dev.ps1 translate [args] translate the app text (torre/tools/translate_content.py; --check lists what is missing);
#                            needs a model (default: local Ollama qwen3.8); Prompture comes with setup
#   .\dev.ps1 narrate [en|es] record the coach voice packs, female and male, with Kokoro (starts its Docker container if needed)
#   .\dev.ps1 packs [publish] zip the voice packs (torre/tools/build_packs.py); publish uploads them to the voice-packs release
#   .\dev.ps1 release        check, then package the Vela app (torre/tools/release_vela.py)
#
# Options: -Port 1886 (studio), -UiPort 5173 (Vite), -Open (serve: open the browser)

param(
    [Parameter(Position = 0)]
    [string]$Command = "start",

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Rest,

    [int]$Port = 1886,
    [int]$UiPort = 5173,
    [switch]$Open
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$Root = $PSScriptRoot
$Web = Join-Path $Root "web"
$OnWindows = $env:OS -eq "Windows_NT"
$UiBuild = Join-Path $Root "torre/ui/index.html"
$VenvPython = if ($OnWindows) { Join-Path $Root ".venv/Scripts/python.exe" } else { Join-Path $Root ".venv/bin/python" }
$SystemPython = if ($OnWindows) { "python" } else { "python3" }
$Python = if (Test-Path $VenvPython) { $VenvPython } else { $SystemPython }
$Npm = if ($OnWindows) { "npm.cmd" } else { "npm" }
$Repo = "jhd3197/Torre"  # the GitHub repository whose releases hold the art
$ArtRelease = "art-2026-10-06"  # GitHub release holding art-built.zip, the images the app shows
$ArtDownload = "https://torre.sh/downloads/art/art-built-2026-10-06.zip"
# The public zip holds art/... so it expands into web/public/.
$ArtZips = [ordered]@{
    built   = @{ Asset = "art-built.zip"; Folder = (Join-Path $Root "web/public/art") }
}
$PacksRelease = "voice-packs"            # GitHub release holding the voice packs (packs.py reads it)
$KokoroImage = "ghcr.io/remsky/kokoro-fastapi-gpu:latest"
# Every tests/test_*.py; `.\dev.ps1 test tests.test_coach` runs just one.
$PythonTests = @("discover", "-s", "tests", "-t", ".")

function Invoke-Step([string]$Name, [scriptblock]$Block) {
    Write-Host "`n==> $Name" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0  # cmdlets never set it, so a step made only of cmdlets would read as failed
    & $Block
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $Name (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

function Stop-Port([int]$Number) {
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return }  # Windows only
    Get-NetTCPConnection -LocalPort $Number -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        Where-Object { $_ -and $_ -ne $PID } |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

function Ensure-WebPackages {
    if (Test-Path (Join-Path $Web "node_modules")) { return }
    Invoke-Step "npm ci (web)" { npm --prefix $Web ci }
}

# requirements.txt is installed into .venv again whenever it changes (Prompture for the AI coach, ...).
function Ensure-PythonPackages {
    if (-not (Test-Path $VenvPython)) { return }
    $stamp = Join-Path $Root ".venv/requirements.stamp"
    $wanted = (Get-FileHash (Join-Path $Root "requirements.txt")).Hash
    if ((Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq $wanted) { return }
    Invoke-Step "pip install -r requirements.txt" { & $VenvPython -m pip install --disable-pip-version-check -q -r (Join-Path $Root "requirements.txt") }
    Set-Content -Path $stamp -Value $wanted -Encoding ascii
}

# The UI is stale when any of its sources is newer than the last build.
function Test-UiStale {
    if (-not (Test-Path $UiBuild)) { return $true }
    $built = (Get-Item $UiBuild).LastWriteTimeUtc
    $sources = @(Get-ChildItem (Join-Path $Web "src") -Recurse -File) +
        @("index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json" |
            ForEach-Object { Get-Item (Join-Path $Web $_) -ErrorAction SilentlyContinue })
    return [bool]($sources | Where-Object { $_ -and $_.LastWriteTimeUtc -gt $built } | Select-Object -First 1)
}

# Download the built art zip from the release and expand it in place.
function Get-Art([string[]]$Which) {
    foreach ($name in $Which) {
        $art = $ArtZips[$name]
        $zip = Join-Path ([IO.Path]::GetTempPath()) $art.Asset
        Invoke-Step "download $($art.Asset) ($ArtRelease)" {
            try {
                Invoke-WebRequest $ArtDownload -OutFile $zip -ErrorAction Stop
            } catch {
                # The public GitHub release remains usable while torre.sh is unavailable.
                Invoke-WebRequest "https://github.com/$Repo/releases/download/$ArtRelease/$($art.Asset)" -OutFile $zip -ErrorAction Stop
            }
        }
        Expand-Archive -Path $zip -DestinationPath (Split-Path $art.Folder) -Force
        Remove-Item $zip
    }
}

function Build-Ui([switch]$IfStale) {
    if ($IfStale -and -not (Test-UiStale)) { Write-Host "UI build is up to date." -ForegroundColor DarkGray; return }
    Ensure-WebPackages
    Invoke-Step "build UI (web -> torre/ui)" { npm --prefix $Web run build }
}

# ---- validate: one line per check, details only when it fails --------------

# Runs a native command with its stderr folded into the output, without
# Windows PowerShell turning a stderr line into a terminating error.
function Invoke-Quiet([scriptblock]$Block) {
    $saved = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { $out = & $Block 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $saved }
    return @{ Out = @($out); Code = $LASTEXITCODE }
}

function Write-Check([string]$Name, [string]$State, [string]$Summary = "", [string[]]$Detail = @()) {
    $colour = @{ ok = "Green"; fail = "Red" }[$State]
    Write-Host ("  {0,-12}" -f $Name) -ForegroundColor Cyan -NoNewline
    Write-Host ($(if ($Summary) { "$State ($Summary)" } else { $State })) -ForegroundColor $colour
    $Detail | Select-Object -First 25 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    if ($State -eq "fail") { $script:Failures++ }
}

function Test-Python {
    $r = Invoke-Quiet { & $Python -m unittest @PythonTests }
    $ran = ($r.Out | Select-String "^Ran (\d+) tests?").Matches.Groups[1].Value
    if ($r.Code -eq 0) { Write-Check "python" "ok" "$ran passed"; return }
    Write-Check "python" "fail" ($r.Out | Select-String "^FAILED").Line ($r.Out | Where-Object { $_ -match "^(FAIL|ERROR):|Error:|File `"" })
}

function Test-Types {
    $r = Invoke-Quiet { npm --prefix $Web run typecheck --silent }
    if ($r.Code -eq 0) { Write-Check "typescript" "ok"; return }
    Write-Check "typescript" "fail" "" ($r.Out | Where-Object { $_ -match "error TS" })
}

function Test-Lint {
    $r = Invoke-Quiet { npm --prefix $Web run lint --silent }
    if ($r.Code -eq 0) { Write-Check "eslint" "ok"; return }
    Write-Check "eslint" "fail" "" ($r.Out | Where-Object { $_ -match "error|warning|\.tsx?$" })
}

function Test-Vitest {
    $r = Invoke-Quiet { npm --prefix $Web test --silent -- --reporter=dot }
    $tests = ($r.Out | Select-String "Tests\s+(.*)").Matches.Groups[1].Value
    if ($r.Code -eq 0) { Write-Check "vitest" "ok" "$tests".Trim(); return }
    Write-Check "vitest" "fail" "$tests".Trim() ($r.Out | Where-Object { $_ -match "FAIL|Error|expected" })
}

function Test-Build {
    $r = Invoke-Quiet { npm --prefix $Web run build --silent }
    if ($r.Code -eq 0) { Write-Check "ui build" "ok"; return }
    Write-Check "ui build" "fail" "" ($r.Out | Where-Object { $_ -match "error|Error" })
}

function Invoke-Validate([bool]$CheckPython, [bool]$CheckUi) {
    $script:Failures = 0
    $started = Get-Date
    $what = @(); if ($CheckPython) { $what += "Python" }; if ($CheckUi) { $what += "UI" }
    Write-Host ("[{0}] " -f $started.ToString("HH:mm:ss")) -ForegroundColor DarkGray -NoNewline
    Write-Host ("Checking " + ($what -join " + ")) -ForegroundColor Cyan
    if ($CheckUi) { Test-Types; Test-Lint; Test-Vitest; Test-Build }
    if ($CheckPython) { Test-Python }
    $took = [int]((Get-Date) - $started).TotalSeconds
    if ($script:Failures) { Write-Host "  $($script:Failures) failing - ${took}s" -ForegroundColor Red }
    else { Write-Host "  all good - ${took}s" -ForegroundColor Green }
    Write-Host ""
}

# Which side of the project a changed path belongs to, or $null to ignore it.
function Get-Side([string]$Path) {
    if ($Path -match "[\\/](node_modules|studio[\\/]ui|__pycache__|\.venv|data|dist|graphify-out)([\\/]|$)") { return $null }
    if ($Path -match "[\\/]web[\\/]") { return "ui" }
    if ($Path -match "\.py$") { return "python" }
    return $null
}

# Calls $OnChange with the set of changed sides ("python", "ui"), debounced.
function Watch-Project([scriptblock]$OnChange, [scriptblock]$OnTick = {}) {
    $queue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
    $watcher = [System.IO.FileSystemWatcher]::new($Root)
    $watcher.IncludeSubdirectories = $true
    $watcher.NotifyFilter = [System.IO.NotifyFilters]'LastWrite, FileName'
    $watcher.EnableRaisingEvents = $true
    $subscriptions = foreach ($kind in "Changed", "Created", "Deleted", "Renamed") {
        Register-ObjectEvent $watcher $kind -MessageData $queue -Action { $Event.MessageData.Enqueue($EventArgs.FullPath) }
    }
    try {
        while ($true) {
            Start-Sleep -Milliseconds 400
            & $OnTick
            if ($queue.IsEmpty) { continue }
            # Debounce: an editor's save (or a branch switch) arrives as a burst.
            do { $before = $queue.Count; Start-Sleep -Milliseconds 700 } while ($queue.Count -ne $before)
            $sides = @{}
            $path = $null
            while ($queue.TryDequeue([ref]$path)) { $side = Get-Side $path; if ($side) { $sides[$side] = $true } }
            if ($sides.Count) { & $OnChange $sides }
            # What the handler wrote itself (the UI build) is not a new change.
            while ($queue.TryDequeue([ref]$path)) { }
        }
    } finally {
        $subscriptions | ForEach-Object { Unregister-Event -SourceIdentifier $_.Name -ErrorAction SilentlyContinue }
        $watcher.Dispose()
    }
}

function Start-Studio([int]$On, [switch]$Background) {
    $argv = @("-m", "torre.server.studio", "--port", "$On")
    if ($Background) { return Start-Process -FilePath $Python -ArgumentList $argv -WorkingDirectory $Root -NoNewWindow -PassThru }
    & $Python @argv
}

switch ($Command) {
    "start" {
        Ensure-WebPackages
        Ensure-PythonPackages
        Stop-Port $Port; Stop-Port $UiPort
        $env:STUDIO_URL = "http://127.0.0.1:$Port"
        Write-Host "`nTorre (dev)" -ForegroundColor Cyan
        Write-Host "  Open:   http://127.0.0.1:$UiPort   (UI with live reload)"
        Write-Host "  API:    http://127.0.0.1:$Port   (restarts when a .py file changes)"
        Write-Host "  Ctrl+C stops both.`n" -ForegroundColor DarkGray
        $script:Api = Start-Studio $Port -Background
        $vite = Start-Process -FilePath $Npm -WorkingDirectory $Web -NoNewWindow -PassThru `
            -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$UiPort", "--strictPort")
        try {
            Watch-Project -OnChange {
                param($sides)
                if (-not $sides["python"]) { return }
                Write-Host ("[{0}] Python changed; restarting the API" -f (Get-Date).ToString("HH:mm:ss")) -ForegroundColor Yellow
                Stop-Process -Id $script:Api.Id -Force -ErrorAction SilentlyContinue
                Stop-Port $Port
                $script:Api = Start-Studio $Port -Background
            } -OnTick {
                if ($vite.HasExited) { throw "The UI dev server stopped." }
            }
        } finally {
            Stop-Process -Id $script:Api.Id -Force -ErrorAction SilentlyContinue
            Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
            Stop-Port $Port; Stop-Port $UiPort
        }
    }
    "serve" {
        Ensure-PythonPackages
        Build-Ui -IfStale
        Stop-Port $Port
        $argv = @("-m", "torre.server.studio", "--port", "$Port")
        if ($Open) { $argv += "--open-browser" }
        & $Python @argv
    }
    "ui" {
        Ensure-WebPackages
        $env:STUDIO_URL = "http://127.0.0.1:$Port"
        npm --prefix $Web run dev -- --host 127.0.0.1 --port $UiPort
    }
    "validate" {
        Ensure-WebPackages
        if ($Rest -contains "once") {
            Invoke-Validate $true $true
            exit $(if ($script:Failures) { 1 } else { 0 })
        }
        Write-Host "[dev] Watching Python and web/ for type, test and build errors. Ctrl+C to stop.`n" -ForegroundColor Cyan
        Invoke-Validate $true $true
        Watch-Project -OnChange { param($sides) Invoke-Validate ([bool]$sides["python"]) ([bool]$sides["ui"]) }
    }
    "lessons" {
        & $Python -m torre.tools.verify_lessons @Rest
        exit $LASTEXITCODE
    }
    "masters" {
        & $Python -m torre.games.download_masters @Rest
        exit $LASTEXITCODE
    }
    "story" {
        & $Python -m torre.tools.game_story @Rest
        exit $LASTEXITCODE
    }
    "test" {
        if ($Rest) { & $Python -m unittest @Rest } else { & $Python -m unittest @PythonTests }
        exit $LASTEXITCODE
    }
    "test-web" {
        Ensure-WebPackages
        npm --prefix $Web test -- @Rest
        exit $LASTEXITCODE
    }
    "lint" {
        Ensure-WebPackages
        npm --prefix $Web run lint -- @Rest
        exit $LASTEXITCODE
    }
    "format" {
        Ensure-WebPackages
        npm --prefix $Web run format
        exit $LASTEXITCODE
    }
    "build" {
        Build-Ui
    }
    "check" {
        Ensure-WebPackages
        Invoke-Step "python tests" { & $Python -m unittest @PythonTests }
        Invoke-Step "typescript" { npm --prefix $Web run typecheck }
        Invoke-Step "eslint" { npm --prefix $Web run lint }
        Invoke-Step "vitest" { npm --prefix $Web test }
        Build-Ui
        Write-Host "`nAll checks passed." -ForegroundColor Green
    }
    "setup" {
        if (-not (Test-Path $VenvPython)) { Invoke-Step "create .venv" { & $SystemPython -m venv (Join-Path $Root ".venv") } }
        $Python = $VenvPython
        Invoke-Step "pip install -r requirements.txt" { & $Python -m pip install -r requirements.txt }
        Invoke-Step "npm ci (web)" { npm --prefix $Web ci }
        # The images the app shows are a release asset, not in git.
        if (-not (Test-Path (Join-Path $ArtZips.built.Folder "bots"))) { Get-Art @("built") }
        Build-Ui
        # The legend bots play from these; the studio also fetches any still missing on launch.
        Invoke-Step "download legend games" { & $Python -m torre.games.download_masters }
        Write-Host "`nSetup complete. Start with .\dev.ps1 (live reload) or .\dev.ps1 serve." -ForegroundColor Green
    }
    "art" {
        if ($Rest -and $Rest[0] -in @("fetch", "publish")) {
            # Only the cut images are public. The source sheets stay in the private art pipeline.
            $which = if ($Rest.Count -gt 1) { @($Rest[1]) } else { @("built") }
            foreach ($name in $which) { if (-not $ArtZips.Contains($name)) { throw "Only built art can be fetched or published here; source sheets stay private." } }
            if ($Rest[0] -eq "fetch") {
                Get-Art $which
                Write-Host "Restored $($which -join ' and ') art." -ForegroundColor Green
                exit 0
            }
            foreach ($name in $which) {
                $art = $ArtZips[$name]
                $zip = Join-Path ([IO.Path]::GetTempPath()) $art.Asset
                if (Test-Path $zip) { Remove-Item $zip }
                Invoke-Step "zip $($art.Folder)" { Compress-Archive -Path $art.Folder -DestinationPath $zip -ErrorAction Stop }
                Invoke-Step "upload $($art.Asset) ($ArtRelease)" { gh release upload $ArtRelease $zip --repo $Repo --clobber }
                $dockerfile = Join-Path $Root "Dockerfile"
                $digest = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
                $old = [IO.File]::ReadAllText($dockerfile)
                $updated = [regex]::Replace($old, '(?<=ADD --checksum=sha256:)[0-9a-f]{64}', $digest)
                if ($updated -eq $old -and -not $old.Contains($digest)) { throw "Could not update the Dockerfile art checksum." }
                [IO.File]::WriteAllText($dockerfile, $updated)
                Write-Host "Updated Dockerfile art checksum; commit it with the new release asset." -ForegroundColor Yellow
                Remove-Item $zip
            }
            exit 0
        }
        # rembg and its model are large, so they live in the system Python, not .venv.
        & python (Join-Path $Root "art/build_assets.py") @Rest
        exit $LASTEXITCODE
    }
    "analyze" {
        & $Python -m torre.analysis.analyze @Rest
        exit $LASTEXITCODE
    }
    "translate" {
        & $Python -m torre.tools.translate_content @Rest
        exit $LASTEXITCODE
    }
    "narrate" {
        $langs = if ($Rest) { $Rest } else { @("en", "es") }
        try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:8880/v1/audio/voices" | Out-Null }
        catch {
            Invoke-Step "start Kokoro ($KokoroImage)" {
                docker rm -f chess-kokoro 2>$null | Out-Null
                docker run -d --gpus all -p 8880:8880 --name chess-kokoro $KokoroImage | Out-Null
            }
            $deadline = (Get-Date).AddMinutes(3)
            do { Start-Sleep -Seconds 2; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:8880/v1/audio/voices" | Out-Null; $up = $true } catch { $up = $false } }
            until ($up -or (Get-Date) -gt $deadline)
        }
        foreach ($lang in $langs) {
            foreach ($gender in @("female", "male")) {
                Invoke-Step "record the $lang $gender voice pack" { & $Python -m torre narrate --lang $lang --gender $gender }
            }
        }
    }
    "packs" {
        Invoke-Step "zip the voice packs" { & $Python -m torre.tools.build_packs }
        if ($Rest -and $Rest[0] -eq "publish") {
            $files = @(Get-ChildItem (Join-Path $Root "dist/packs") -File | ForEach-Object { $_.FullName })
            # "release not found" on stderr is the expected answer before the first publish, not a failure.
            $saved = $ErrorActionPreference; $ErrorActionPreference = "Continue"
            gh release view $PacksRelease 2>$null | Out-Null
            $exists = $LASTEXITCODE -eq 0
            $ErrorActionPreference = $saved
            if (-not $exists) {
                Invoke-Step "create the $PacksRelease release" { gh release create $PacksRelease --title "Voice packs" --notes "Coach voice packs, downloaded by the app (packs.py)." }
            }
            Invoke-Step "upload the voice packs" { gh release upload $PacksRelease @files --clobber }
        }
    }
    "release" {
        & $PSCommandPath check
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Invoke-Step "package Vela app" { & $Python -m torre.tools.release_vela @Rest }
    }
    default {
        Get-Content $PSCommandPath -TotalCount 21
    }
}
