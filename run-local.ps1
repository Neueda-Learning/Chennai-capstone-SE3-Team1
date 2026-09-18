<#
.SYNOPSIS
    One-shot local bring-up of the trading platform on Windows: Postgres schema, the auth
    stub, Trade API and Trade Executor - talking to Kafka running as a Docker container on
    a separate Linux box - then a merged live tail of every local log.

.DESCRIPTION
    Run from anywhere; the script cd's to the repo root it lives in. Windows PowerShell 5.1
    compatible. No Docker on this machine: Kafka is expected to already be running on Linux
    (docker-compose up in infra/kafka) before this script is run. Only the Kafka CLI tools
    are downloaded locally, to create topics on the remote broker and to let you inspect it
    from Windows - no broker ever starts on this machine.

    What it does, in order:
      1. Checks java, mvn, python (+trustme_secrets), node, npm, psql, the TrustMe key file
         and services\auth-stub.
      2. Downloads the Kafka 3.8.0 CLI tools to -KafkaHome if absent, verifies the remote
         broker at -KafkaHost:9092 is reachable, creates the six contracted topics there.
      3. Applies migrations + seed to local Postgres via scripts\apply_db.py (-ResetDb rebuilds).
      4. Builds domain-engine, eventbus, sprint-06-api and executor (-SkipBuild reuses jars);
         npm installs services\auth-stub if node_modules is missing.
      5. Starts the auth stub (:4000), the API (:8081) and the executor (:8083), all pointed
         at the remote Kafka, waits for health on all three.
      6. Mints a 1-hour JWT for account 1 and prints ready-to-paste curl commands, including
         one to get a token from the auth stub instead.
      7. Tails api / executor / auth-stub / postgres logs together until Ctrl+C. Kafka's own
         logs live on the Linux box (docker-compose logs -f kafka there).
         Ctrl+C stops only the tail; the services keep running. Use -Stop to shut them down.

.PARAMETER TrustMePassword   Password for leapcapstoneteam1-720d03.TM. Prompted for (masked) if omitted, which is the normal way to run this.
.PARAMETER KafkaHost         Address of the Linux box running Kafka in Docker (infra/kafka/docker-compose.yml). Prompted for if omitted - always asked fresh, never cached, since it can change between sessions.
.PARAMETER JwtSecret         HS256 secret the API verifies tokens with. Default is a dev value.
.PARAMETER KafkaHome         Where the Kafka distribution's CLI tools (kafka-topics etc.) are cached. Default C:\kafka. No broker runs from here - Kafka itself lives on -KafkaHost.
.PARAMETER SkipBuild         Reuse the jars already in target\.
.PARAMETER ResetDb           Drop and recreate trading_platform before migrating.
.PARAMETER NoTail            Start everything and return without tailing logs.
.PARAMETER TailOnly          Skip setup; just attach the merged log tail to the running services.
.PARAMETER Stop              Stop the API, executor and auth stub started by a previous run, then exit. Kafka is untouched - it's managed on the Linux side, separately.

.EXAMPLE
    .\run-local.ps1                            # prompts for the TrustMe password and the Kafka host
.EXAMPLE
    .\run-local.ps1 -KafkaHost 10.8.65.2 -SkipBuild
.EXAMPLE
    .\run-local.ps1 -TailOnly                  # re-attach to the logs of a running stack
.EXAMPLE
    .\run-local.ps1 -Stop
#>
[CmdletBinding()]
param(
    [string]$TrustMePassword,
    [string]$KafkaHost,
    [string]$JwtSecret = "local-dev-secret-change-me",
    [string]$KafkaHome = "C:\kafka",
    [switch]$SkipBuild,
    [switch]$ResetDb,
    [switch]$NoTail,
    [switch]$TailOnly,
    [switch]$Stop
)

# Continue, not Stop: in Windows PowerShell 5.1 a native command writing to stderr (java
# -version, mvn warnings) would otherwise be promoted to a terminating error. Every step
# checks $LASTEXITCODE explicitly instead.
$ErrorActionPreference = "Continue"
$RepoRoot   = $PSScriptRoot
$KeyFile    = Join-Path $RepoRoot "leapcapstoneteam1-720d03.TM"
$LogDir     = Join-Path $RepoRoot "logs\local"
$PidFile    = Join-Path $LogDir "pids.json"
$KafkaVer   = "3.8.0"
$KafkaUrl   = "https://archive.apache.org/dist/kafka/$KafkaVer/kafka_2.13-$KafkaVer.tgz"
$ApiPort    = 8081
$ExecPort   = 8083
$KafkaPort  = 9092
$AuthStubPort = 4000
$AuthStubDir  = Join-Path $RepoRoot "services\auth-stub"
$Topics     = @{ "orders"=3; "trade-events"=3; "market-data"=6; "orders.DLT"=3; "trade-events.DLT"=3; "market-data.DLT"=6 }

Set-Location $RepoRoot
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Say($msg, $color = "Cyan") { Write-Host ""; Write-Host "==> $msg" -ForegroundColor $color }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# $hostName defaults to loopback for the processes this script starts itself (API, executor,
# auth stub, local Postgres); Kafka reachability checks pass -KafkaHost explicitly since that
# broker runs on a different machine entirely.
function Test-Port($port, $hostName = "127.0.0.1") {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $r = $c.BeginConnect($hostName, $port, $null, $null)
        $ok = $r.AsyncWaitHandle.WaitOne(1500, $false)
        if ($ok) { $c.EndConnect($r) }
        $c.Close(); return $ok
    } catch { return $false }
}

function Wait-Until($label, [scriptblock]$test, $seconds = 120) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $seconds) {
        if (& $test) { Write-Host "    $label ready ($([int]$sw.Elapsed.TotalSeconds)s)" -ForegroundColor Green; return $true }
        Start-Sleep 2
    }
    Write-Host "    $label NOT ready after ${seconds}s" -ForegroundColor Red; return $false
}

function Get-Health($port) {
    try { (Invoke-RestMethod -Uri "http://localhost:$port/actuator/health" -TimeoutSec 5).status -eq "UP" } catch { $false }
}

function Read-Pids {
    if (Test-Path $PidFile) { Get-Content $PidFile -Raw | ConvertFrom-Json } else { $null }
}

function Stop-Tracked($name, $procId) {
    if ($procId) {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) { Stop-Process -Id $procId -Force; Write-Host "    stopped $name (pid $procId)" }
        else    { Write-Host "    $name (pid $procId) already gone" }
    }
}

# ------------------------------------------------------------------ -Stop
if ($Stop) {
    Say "Stopping services (Kafka is on Linux - not touched here)" Yellow
    $pids = Read-Pids
    if (-not $pids) { Write-Host "    nothing tracked in $PidFile"; exit 0 }
    Stop-Tracked "executor" $pids.executor
    Stop-Tracked "trade-api" $pids.api
    Stop-Tracked "auth-stub" $pids.authstub
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    exit 0
}

if ($TailOnly) {
    $kafkaLibs = Join-Path $KafkaHome "libs\*"
    Say "Attached to running services (PIDs in $PidFile)" Green
} else {

# ------------------------------------------------------------------ 1. prerequisites
Say "Checking prerequisites"
foreach ($tool in "java", "mvn", "python", "node", "npm") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool not on PATH" }
}
$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    $cand = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($cand) { $env:PSQL_BIN = $cand.FullName; $env:PATH = "$($cand.DirectoryName);$env:PATH" } else { Fail "psql not found; install PostgreSQL" }
}
cmd /c "python -c ""import trustme_secrets"" 2>nul" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "python module trustme_secrets missing (pip install trustme-secrets)" }
if (-not (Test-Path $KeyFile)) { Fail "TrustMe key file missing: $KeyFile" }
if (-not (Test-Path (Join-Path $AuthStubDir "server.js"))) { Fail "auth stub missing: $AuthStubDir" }
if (-not (Test-Port 5432)) { Fail "Postgres is not listening on 5432 (start the postgresql service)" }

if (-not $TrustMePassword) {
    $sec = Read-Host "TrustMe key file password" -AsSecureString
    $TrustMePassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if (-not $KafkaHost) {
    $KafkaHost = Read-Host "Kafka host (the Linux box running docker-compose in infra/kafka)"
}
if (-not $KafkaHost) { Fail "Kafka host is required (pass -KafkaHost or enter it when prompted)" }
Write-Host "    java: $((cmd /c "java -version 2>&1" | Select-Object -First 1))"
Write-Host "    key file, psql, python, postgres: ok"

$pyTrust = @("-X", "trustme_password=$TrustMePassword", "-X", "trustme_keyfile=$KeyFile")

# ------------------------------------------------------------------ 2. kafka (remote - Linux)
Say "Kafka CLI tools ($KafkaVer, cached at $KafkaHome) -> broker at ${KafkaHost}:${KafkaPort}"
$kafkaLibs = Join-Path $KafkaHome "libs\*"
$toolsLog4j = "file:" + ((Join-Path $KafkaHome "config\tools-log4j.properties") -replace "\\", "/")

# A file that only exists once the distribution is unpacked - used purely to decide whether
# to download again. No broker config is used from here; nothing in $KafkaHome ever runs a
# server, only the client-side CLI tools (kafka-topics / TopicCommand) below.
$kafkaMarker = Join-Path $KafkaHome "bin\kafka-topics.sh"
if (-not (Test-Path $kafkaMarker)) {
    Write-Host "    downloading $KafkaUrl (CLI tools only - no broker runs on this machine)"
    New-Item -ItemType Directory -Force -Path $KafkaHome | Out-Null
    $tgz = Join-Path $KafkaHome "kafka.tgz"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    (New-Object Net.WebClient).DownloadFile($KafkaUrl, $tgz)
    tar -xzf $tgz -C $KafkaHome --strip-components=1
    Remove-Item $tgz
}

if (-not (Wait-Until "kafka ${KafkaHost}:${KafkaPort}" { Test-Port $KafkaPort $KafkaHost } 30)) {
    Fail "Can't reach Kafka at ${KafkaHost}:${KafkaPort}. Is 'docker-compose up' running on that Linux box (infra/kafka/docker-compose.yml)? Is a firewall/security group blocking port $KafkaPort?"
}

Write-Host "    ensuring topics"
foreach ($t in $Topics.GetEnumerator()) {
    java "-Dlog4j.configuration=$toolsLog4j" -cp $kafkaLibs org.apache.kafka.tools.TopicCommand `
        --bootstrap-server "${KafkaHost}:$KafkaPort" --create --if-not-exists --topic $t.Key --partitions $t.Value --replication-factor 1 2>$null |
        Where-Object { $_ -match "Created" } | ForEach-Object { Write-Host "    $_" }
}

# ------------------------------------------------------------------ 3. database
Say "Database (scripts\apply_db.py)"
$dbArgs = @("scripts\apply_db.py")
if ($ResetDb) { $dbArgs += "--reset" }
& python @pyTrust @dbArgs 2>&1 | Where-Object { $_ -match "migrations :|seed       :|Database ready|FAILED|EDITED|ERROR" } | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { Fail "apply_db.py failed (a migration was edited after being applied? re-run with -ResetDb)" }

# ------------------------------------------------------------------ 4. build
$apiJar  = Join-Path $RepoRoot "sprint-06-api\target\sprint-06-api-0.0.1-SNAPSHOT.jar"
$execJar = Join-Path $RepoRoot "executor\target\trade-executor-0.0.1-SNAPSHOT.jar"
if ($SkipBuild -and (Test-Path $apiJar) -and (Test-Path $execJar)) {
    Say "Build skipped (-SkipBuild)"
} else {
    Say "Building (domain-engine -> eventbus -> api -> executor)"
    $steps = @(
        @("sprint-05-domain-engine\pom.xml", "install"),
        @("sprint-07\eventbus\pom.xml",      "install"),
        @("sprint-06-api\pom.xml",           "package"),
        @("executor\pom.xml",                "package"))
    foreach ($s in $steps) {
        Write-Host "    mvn -f $($s[0]) $($s[1])"
        & mvn -q -f $s[0] $s[1] -DskipTests 2>&1 | Where-Object { $_ -match "ERROR|BUILD FAILURE" } | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        if ($LASTEXITCODE -ne 0) { Fail "build failed in $($s[0])" }
    }
}

Say "Auth stub dependencies (services\auth-stub)"
if (-not (Test-Path (Join-Path $AuthStubDir "node_modules"))) {
    Write-Host "    npm install"
    Push-Location $AuthStubDir
    & npm install 2>&1 | Where-Object { $_ -match "error|ERR!" } | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) { Fail "npm install failed in $AuthStubDir" }
} else {
    Write-Host "    node_modules present, skipping npm install"
}

# ------------------------------------------------------------------ 5. services
Say "Starting services"
$prev = Read-Pids
if ($prev) {
    Stop-Tracked "old executor" $prev.executor; Stop-Tracked "old trade-api" $prev.api; Stop-Tracked "old auth-stub" $prev.authstub
    # Stop-Process returns before the listener is gone; give Windows a moment to release the ports.
    Wait-Until "ports $ApiPort/$ExecPort/$AuthStubPort released" { -not (Test-Port $ApiPort) -and -not (Test-Port $ExecPort) -and -not (Test-Port $AuthStubPort) } 20 | Out-Null
}
foreach ($p in $ApiPort, $ExecPort, $AuthStubPort) { if (Test-Port $p) { Fail "port $p is already in use by something this script did not start" } }

$jvmCommon = @("-Xmx512m", "-Dtrustme.password=$TrustMePassword", "-Dtrustme.key-file=$KeyFile")

# The API and the auth stub both read JWT_SECRET (API verifies tokens with it, overriding
# the TrustMe vault's jwt.secret so it's a value this script - and whoever calls the stub -
# knows; the stub signs with it). KAFKA_BOOTSTRAP_SERVERS has to be set before EITHER the API
# or the executor start: both run a Kafka producer (trade-api publishes ORDER_PLACED, the
# executor publishes/consumes everything else), and Spring only reads env vars present at
# JVM startup - setting it after the API was already launched (an earlier version of this
# script did exactly that) meant the API silently fell back to its localhost:9092 default,
# which happened to work only because Kafka used to run on this same machine.
$env:JWT_SECRET = $JwtSecret
$env:KAFKA_BOOTSTRAP_SERVERS = "${KafkaHost}:$KafkaPort"

$authStub = Start-Process -FilePath node -PassThru -WindowStyle Hidden -WorkingDirectory $AuthStubDir `
    -RedirectStandardOutput (Join-Path $LogDir "authstub.log") -RedirectStandardError (Join-Path $LogDir "authstub.err") `
    -ArgumentList @("server.js")
Write-Host "    auth-stub  pid $($authStub.Id)  -> http://localhost:$AuthStubPort"

$api = Start-Process -FilePath java -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "api.log") -RedirectStandardError (Join-Path $LogDir "api.err") `
    -ArgumentList ($jvmCommon + @("-jar", $apiJar))
Write-Host "    trade-api  pid $($api.Id)  -> http://localhost:$ApiPort"

$exe = Start-Process -FilePath java -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "executor.log") -RedirectStandardError (Join-Path $LogDir "executor.err") `
    -ArgumentList ($jvmCommon + @("-jar", $execJar))
Write-Host "    executor   pid $($exe.Id)  -> http://localhost:$ExecPort"

@{ api = $api.Id; executor = $exe.Id; authstub = $authStub.Id; started = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content $PidFile

$authStubUp = Wait-Until "auth-stub /health"        { Get-Health $AuthStubPort } 30
$apiUp  = Wait-Until "trade-api /actuator/health" { Get-Health $ApiPort } 150
$execUp = Wait-Until "executor  /actuator/health" { Get-Health $ExecPort } 150
if (-not ($apiUp -and $execUp -and $authStubUp)) { Write-Host "    check $LogDir\*.log for the failure" -ForegroundColor Red }

# ------------------------------------------------------------------ 6. token + cheat sheet
function New-Jwt($secret, $accountId, $ttlSec = 3600) {
    $b64 = { param($bytes) [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_") }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $h = & $b64 ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $p = & $b64 ([Text.Encoding]::UTF8.GetBytes(('{{"sub":"client-{0}","accountId":{0},"roles":["CLIENT"],"iss":"auth-service","iat":{1},"exp":{2}}}' -f $accountId, $now, ($now + $ttlSec))))
    $mac = New-Object Security.Cryptography.HMACSHA256 (,[Text.Encoding]::UTF8.GetBytes($secret))
    $s = & $b64 ($mac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$h.$p")))
    "$h.$p.$s"
}
$token = New-Jwt $JwtSecret 1
Set-Content (Join-Path $LogDir "token.txt") $token

Say "Ready" Green
Write-Host @"
  Trade API   http://localhost:$ApiPort      Executor  http://localhost:$ExecPort      Kafka ${KafkaHost}:$KafkaPort (Linux)
  Auth stub   http://localhost:$AuthStubPort
  Logs        $LogDir\{api,executor,authstub}.log        PIDs  $PidFile
  JWT (acct 1, 1h)  saved to $LogDir\token.txt

  # place an order (PowerShell; the -replace escapes quotes for curl.exe, which PS 5.1 otherwise strips)
  `$T = Get-Content '$LogDir\token.txt'
  `$body = '{"accountId":1,"symbol":"RELIANCE","side":"BUY","quantity":1,"price":1300.00,"idempotencyKey":"k-' + [DateTimeOffset]::Now.ToUnixTimeSeconds() + '"}'
  curl.exe -s -X POST localhost:$ApiPort/api/v1/orders -H "Authorization: Bearer `$T" -H "Content-Type: application/json" -d (`$body -replace '"','\"')
  curl.exe -s localhost:$ApiPort/api/v1/accounts/1/orders  -H "Authorization: Bearer `$T"
  curl.exe -s localhost:$ApiPort/api/v1/accounts/1/balance -H "Authorization: Bearer `$T"

  # or get a bearer token from the auth stub instead of the token.txt above (no accountId
  # claim on this one - see services/auth-stub/README.md - so it authenticates but the
  # per-account reach check is skipped)
  Invoke-RestMethod -Uri http://localhost:$AuthStubPort/login -Method Post -ContentType application/json -Body '{"username":"alice","password":"mission123"}'

  # watch a topic on the remote broker
  java -cp "$kafkaLibs" org.apache.kafka.tools.consumer.ConsoleConsumer --bootstrap-server ${KafkaHost}:$KafkaPort --topic trade-events --from-beginning

  # Kafka's own logs are on the Linux box, not here:
  #   docker-compose -f infra/kafka/docker-compose.yml logs -f kafka

  # stop the services on this machine (Kafka on Linux is separate - stop it there with docker-compose down)
  .\run-local.ps1 -Stop
"@

if ($NoTail) { exit 0 }
} # end of setup (skipped by -TailOnly)

# ------------------------------------------------------------------ 7. merged log tail
Say "Tailing local logs (Ctrl+C stops the tail only; services keep running). Kafka's logs are on the Linux box." Yellow
$pgLogDir = Get-ChildItem "C:\Program Files\PostgreSQL\*\data\log" -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
$sources = @(
    @{ tag = "API   "; color = "Green";   path = (Join-Path $LogDir "api.log") },
    @{ tag = "API!  "; color = "Red";     path = (Join-Path $LogDir "api.err") },
    @{ tag = "EXEC  "; color = "Cyan";    path = (Join-Path $LogDir "executor.log") },
    @{ tag = "EXEC! "; color = "Red";     path = (Join-Path $LogDir "executor.err") },
    @{ tag = "AUTH  "; color = "Yellow";  path = (Join-Path $LogDir "authstub.log") },
    @{ tag = "AUTH! "; color = "Red";     path = (Join-Path $LogDir "authstub.err") }
)
if ($pgLogDir) {
    $pgLatest = Get-ChildItem $pgLogDir.FullName -Filter *.log -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($pgLatest) { $sources += @{ tag = "PG    "; color = "DarkYellow"; path = $pgLatest.FullName } }
}
# Start each source at its current end so the tail shows what happens from now on; the
# JVM noise lines are dropped because they say nothing about the platform.
$skip = '^(WARNING: (Use --enable-native|Restricted methods|A restricted method|sun\.misc|Please consider))'
$offsets = @{}
foreach ($s in $sources) { $offsets[$s.path] = if (Test-Path $s.path) { (Get-Item $s.path).Length } else { 0 } }
try {
    while ($true) {
        foreach ($s in $sources) {
            if (-not (Test-Path $s.path)) { continue }
            $len = (Get-Item $s.path).Length
            if ($len -le $offsets[$s.path]) { continue }
            $fs = [IO.File]::Open($s.path, "Open", "Read", "ReadWrite")
            try {
                $fs.Seek($offsets[$s.path], "Begin") | Out-Null
                $sr = New-Object IO.StreamReader($fs)
                while (-not $sr.EndOfStream) {
                    $line = $sr.ReadLine()
                    if ($line -and $line -notmatch $skip) { Write-Host "[$($s.tag)] " -ForegroundColor $s.color -NoNewline; Write-Host $line }
                }
                $offsets[$s.path] = $fs.Position
            } finally { $fs.Close() }
        }
        Start-Sleep -Milliseconds 500
    }
} finally {
    Write-Host ""
    Write-Host "Tail stopped. Services still running; .\run-local.ps1 -Stop to shut down." -ForegroundColor Yellow
}
