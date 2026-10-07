[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SonarHostUrl,

    [Parameter(Mandatory = $true)]
    [string]$SonarToken,

    [string]$ProjectKey = "team1-application",
    [string]$ProjectName = "Team1 Trading Application",

    [switch]$IncludeFrontendE2E
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppRoot = Join-Path $RepoRoot "Application"
$FrontendRoot = Join-Path $AppRoot "Frontend/frontend-app"

function Invoke-Step {
    param(
        [string]$Message,
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan

    # Avoid stale native exit codes from previous steps causing false failures.
    $LASTEXITCODE = 0

    try {
        & $Action
    } catch {
        throw "Step failed: $Message`n$($_.Exception.Message)"
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Step failed: $Message"
    }
}

function Stop-StaleServiceProcesses {
    $jarPathMarkers = @(
        "\\Application\\Services\\order-service\\target\\",
        "\\Application\\Services\\executor-service\\target\\"
    )

    $stale = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match "^javaw?\.exe$" -and
        $_.CommandLine -and
        (
            $_.CommandLine -match [regex]::Escape($jarPathMarkers[0]) -or
            $_.CommandLine -match [regex]::Escape($jarPathMarkers[1])
        )
    }

    foreach ($proc in $stale) {
        Write-Host "Stopping stale Java process $($proc.ProcessId) locking service JARs" -ForegroundColor Yellow
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-StaleFrontendProcesses {
    $frontendPathMarker = "\\Application\\Frontend\\frontend-app\\"

    $stale = Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -match "^(node|esbuild)\.exe$") -and
        $_.CommandLine -and
        ($_.CommandLine -match [regex]::Escape($frontendPathMarker))
    }

    foreach ($proc in $stale) {
        Write-Host "Stopping stale frontend process $($proc.ProcessId) ($($proc.Name))" -ForegroundColor Yellow
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Get-Command mvn -ErrorAction SilentlyContinue)) {
    throw "mvn is not on PATH"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is not on PATH"
}
if (-not (Get-Command sonar-scanner -ErrorAction SilentlyContinue)) {
    throw "sonar-scanner is not on PATH. Install SonarScanner CLI (for example: choco install sonarqube-scanner.portable)."
}

function Assert-SonarAuthentication {
    param(
        [string]$HostUrl,
        [string]$Token
    )

    $authUrl = "$HostUrl/api/authentication/validate"
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${Token}:"))
    $headers = @{ Authorization = "Basic $basic" }

    try {
        $result = Invoke-RestMethod -Uri $authUrl -Headers $headers -Method Get -TimeoutSec 10
    } catch {
        throw "Unable to validate Sonar token against $authUrl. $($_.Exception.Message)"
    }

    if (-not $result.valid) {
        throw "Sonar token is invalid for $HostUrl. Generate a new token and retry."
    }
}

Push-Location $RepoRoot
try {
    Invoke-Step "Validate SonarQube token" {
        Assert-SonarAuthentication -HostUrl $SonarHostUrl -Token $SonarToken
    }

    Invoke-Step "Stop stale backend service processes" {
        Stop-StaleServiceProcesses
    }

    # Build libraries first, then dependent services.
    Invoke-Step "Run tests for domain-engine" {
        mvn -f "Application/Services/libs/domain-engine/pom.xml" clean verify
    }

    Invoke-Step "Run tests for eventbus" {
        mvn -f "Application/Services/libs/eventbus/pom.xml" clean verify
    }

    Invoke-Step "Run tests for order-service" {
        mvn -f "Application/Services/order-service/pom.xml" clean verify
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Retrying order-service build after clearing stale service processes..." -ForegroundColor Yellow
            Stop-StaleServiceProcesses
            mvn -f "Application/Services/order-service/pom.xml" clean verify
        }
    }

    Invoke-Step "Run tests for executor-service" {
        mvn -f "Application/Services/executor-service/pom.xml" clean verify
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Retrying executor-service build after clearing stale service processes..." -ForegroundColor Yellow
            Stop-StaleServiceProcesses
            mvn -f "Application/Services/executor-service/pom.xml" clean verify
        }
    }

    Invoke-Step "Install frontend dependencies" {
        Stop-StaleFrontendProcesses
        Push-Location $FrontendRoot
        try {
            npm ci
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Retrying npm ci after clearing stale frontend processes..." -ForegroundColor Yellow
                Stop-StaleFrontendProcesses
                npm ci
            }
        } finally {
            Pop-Location
        }
    }

    Invoke-Step "Ensure frontend coverage provider" {
        Push-Location $FrontendRoot
        try {
            $vitestVersion = node -p "const v=require('./package.json').devDependencies?.vitest||''; const m=v.match(/\d+\.\d+\.\d+/); m?m[0]:'4.1.11'"
            npm install --no-save -D "@vitest/coverage-v8@$vitestVersion"
        } finally {
            Pop-Location
        }
    }

    Invoke-Step "Run frontend unit tests with coverage" {
        Push-Location $FrontendRoot
        try {
            npm test -- --watch=false --coverage --coverage-reporters=lcov --coverage-reporters=text-summary
        } finally {
            Pop-Location
        }
    }

    if ($IncludeFrontendE2E) {
        Invoke-Step "Run frontend Playwright e2e tests" {
            Push-Location $FrontendRoot
            try {
                npm run test:e2e
            } finally {
                Pop-Location
            }
        }
    }

    Invoke-Step "Publish unified SonarQube analysis" {
        Push-Location $AppRoot
        try {
            $sonarArgs = @(
                "--define", "sonar.host.url=$SonarHostUrl",
                "--define", "sonar.token=$SonarToken",
                "--define", "sonar.projectKey=$ProjectKey",
                "--define", "sonar.projectName=$ProjectName"
            )
            & sonar-scanner @sonarArgs
        } finally {
            Pop-Location
        }
    }

    Write-Host ""
    Write-Host "Complete: backend + frontend tests executed and uploaded to SonarQube project '$ProjectKey'." -ForegroundColor Green
}
finally {
    Pop-Location
}
