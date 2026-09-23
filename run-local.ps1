<#
.SYNOPSIS
    One-shot local bring-up of the trading platform on Windows: Kafka, Postgres schema, the
    auth service (services\team1-nestjs), Trade API and Trade Executor, then a merged live
    tail of every log.

.DESCRIPTION
    Run from anywhere; the script cd's to the repo root it lives in. Windows PowerShell 5.1
    compatible. No Docker. By default Kafka runs as a plain local broker started by this
    script; pass -KafkaHosted to instead connect to a broker already running elsewhere
    (e.g. docker-compose in infra/kafka on a Linux box) - you'll be prompted for its address.

    What it does, in order:
      1. Checks java, mvn, python (+trustme_secrets), node, npm, psql, the TrustMe key file
         and services\team1-nestjs.
      2. Kafka 3.8.0 CLI tools: downloads to -KafkaHome if absent. Without -KafkaHosted,
         also formats KRaft storage once and starts a local broker, waiting for :9092. With
         -KafkaHosted, instead verifies the remote broker at -KafkaHost:9092 is reachable.
         Either way, creates the six contracted topics against whichever broker is in play.
      3. Applies migrations + seed to local Postgres via scripts\apply_db.py (-ResetDb rebuilds).
      4. Builds domain-engine, eventbus, sprint-06-api and executor, and the auth service
         (npm ci if node_modules is missing, then npm run build). -SkipBuild reuses the jars
         and dist\ when they are there.
      5. Starts the auth service (:3000), the API (:8081) and the executor (:8083), waits for
         health on all three. The auth service gets its database settings from the TrustMe
         vault, the same place apply_db.py reads them, and signs tokens with -JwtSecret, which
         the API verifies with.
      6. Mints a 1-hour JWT for account 1 and prints ready-to-paste commands, including the
         full onboarding flow against the auth service: register, log in, link a bank account,
         refresh, fund the wallet.
      7. Tails api / executor / auth / kafka (local mode only) / postgres logs together until
         Ctrl+C. Ctrl+C stops only the tail; the services keep running. Use -Stop to shut them
         down.

.PARAMETER TrustMePassword   Password for leapcapstoneteam1-720d03.TM. Prompted for (masked) if omitted, which is the normal way to run this.
.PARAMETER JwtSecret         HS256 secret the auth service signs tokens with and the API verifies them with. At least 32 characters (the auth service refuses a shorter one). Default is a dev value.
.PARAMETER KafkaHosted       Connect to a Kafka broker running elsewhere instead of starting one locally. Prompts for -KafkaHost if it isn't passed. No broker is started or stopped on this machine in this mode - only the CLI tools run here, to create topics and let you inspect it.
.PARAMETER KafkaHost         Address of the remote broker, used only with -KafkaHosted. Prompted for if omitted - always asked fresh, never cached, since it can change between sessions.
.PARAMETER KafkaHome         Where Kafka lives / gets installed - the broker files in local mode, just the CLI tools with -KafkaHosted. Default C:\kafka.
.PARAMETER SkipBuild         Reuse the jars already in target\.
.PARAMETER ResetDb           Drop and recreate trading_platform before migrating.
.PARAMETER NoTail            Start everything and return without tailing logs.
.PARAMETER TailOnly          Skip setup; just attach the merged log tail to the running services.
.PARAMETER Stop              Stop the API, executor, auth service and (local mode only) Kafka started by a previous run, then exit.

.EXAMPLE
    .\run-local.ps1                            # prompts for the TrustMe password; Kafka runs locally
.EXAMPLE
    .\run-local.ps1 -SkipBuild                 # fast restart after a stop
.EXAMPLE
    .\run-local.ps1 -KafkaHosted -KafkaHost 10.8.65.2   # connect to a remote broker instead
.EXAMPLE
    .\run-local.ps1 -TailOnly                  # re-attach to the logs of a running stack
.EXAMPLE
    .\run-local.ps1 -Stop
#>
[CmdletBinding()]
param(
    [string]$TrustMePassword,
    [string]$JwtSecret = "local-dev-secret-change-me-0123456789abcdef",
    [switch]$KafkaHosted,
    [string]$KafkaHost,
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
$AuthPort   = 3000
$AuthDir    = Join-Path $RepoRoot "services\team1-nestjs"
$AuthMain   = Join-Path $AuthDir "dist\main.js"
$Topics     = @{ "orders"=3; "trade-events"=3; "market-data"=6; "orders.DLT"=3; "trade-events.DLT"=3; "market-data.DLT"=6 }

Set-Location $RepoRoot
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Say($msg, $color = "Cyan") { Write-Host ""; Write-Host "==> $msg" -ForegroundColor $color }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# $hostName defaults to loopback for the processes this script starts itself (API, executor,
# auth, local Postgres, and a local Kafka broker); a -KafkaHosted reachability check passes
# it explicitly since that broker runs on a different machine entirely.
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

# The auth service is NestJS (terminus), not Spring: /health answers {"status":"ok"} with a 200,
# and a 503 - which Invoke-RestMethod throws on - when it is not healthy.
function Get-AuthHealth {
    try { (Invoke-RestMethod -Uri "http://localhost:$AuthPort/health" -TimeoutSec 5).status -eq "ok" } catch { $false }
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
    Say "Stopping services" Yellow
    $pids = Read-Pids
    if (-not $pids) { Write-Host "    nothing tracked in $PidFile"; exit 0 }
    Stop-Tracked "executor" $pids.executor
    Stop-Tracked "trade-api" $pids.api
    Stop-Tracked "auth" $pids.auth
    Stop-Tracked "auth-stub" $pids.authstub   # pids.json written by a version that ran the stub
    if ($pids.kafka) { Stop-Tracked "kafka" $pids.kafka } else { Write-Host "    kafka: nothing tracked locally (was -KafkaHosted, or something else was already listening)" }
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
if (-not (Test-Path (Join-Path $AuthDir "package.json"))) { Fail "auth service missing: $AuthDir" }
if (-not (Test-Port 5432)) { Fail "Postgres is not listening on 5432 (start the postgresql service)" }
# The auth service validates its config at startup and refuses a JWT_SECRET under 32 characters;
# failing here says why, instead of a health check that just never goes green.
if ($JwtSecret.Length -lt 32) { Fail "-JwtSecret must be at least 32 characters (the auth service refuses a shorter one)" }

if (-not $TrustMePassword) {
    $sec = Read-Host "TrustMe key file password" -AsSecureString
    $TrustMePassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if ($KafkaHosted -and -not $KafkaHost) {
    $KafkaHost = Read-Host "Kafka host (the box running docker-compose in infra/kafka)"
}
if ($KafkaHosted -and -not $KafkaHost) { Fail "Kafka host is required with -KafkaHosted (pass -KafkaHost or enter it when prompted)" }
Write-Host "    java: $((cmd /c "java -version 2>&1" | Select-Object -First 1))"
Write-Host "    key file, psql, python, postgres: ok"

$pyTrust = @("-X", "trustme_password=$TrustMePassword", "-X", "trustme_keyfile=$KeyFile")

# The auth service is Node, so it can't open the TrustMe vault itself: read the database
# settings here, through the same resolver apply_db.py uses (vault, then .env, then defaults),
# and hand them to its process only. One value per line: host, port, dbname, user, password.
$dbLines = & python @pyTrust -c "import sys; sys.path.insert(0, 'scripts'); from db_config import DbConfig; c = DbConfig.resolve(); print(c.host); print(c.port); print(c.dbname); print(c.user); print(c.password)" 2>$null
if ($LASTEXITCODE -ne 0 -or @($dbLines).Count -lt 5) { Fail "could not read the database settings from the TrustMe vault (wrong password?)" }
$Db = @{ host = $dbLines[0]; port = $dbLines[1]; name = $dbLines[2]; user = $dbLines[3]; password = $dbLines[4] }
Write-Host "    database settings: $($Db.user)@$($Db.host):$($Db.port)/$($Db.name) (from the vault)"

# ------------------------------------------------------------------ 2. kafka
if ($KafkaHosted) { Say "Kafka CLI tools ($KafkaVer, cached at $KafkaHome) -> broker at ${KafkaHost}:${KafkaPort}" }
else { Say "Kafka $KafkaVer at $KafkaHome" }
$kafkaLibs = Join-Path $KafkaHome "libs\*"
$kafkaCfg  = Join-Path $KafkaHome "config\kraft\server.properties"
$kafkaLog4j = "file:" + ((Join-Path $KafkaHome "config\log4j.properties") -replace "\\", "/")
$toolsLog4j = "file:" + ((Join-Path $KafkaHome "config\tools-log4j.properties") -replace "\\", "/")

# Same distribution either way - -KafkaHosted just never starts a broker from it, only uses
# the CLI tools (kafka-topics / TopicCommand) that come along with it.
if (-not (Test-Path $kafkaCfg)) {
    Write-Host "    downloading $KafkaUrl"
    New-Item -ItemType Directory -Force -Path $KafkaHome | Out-Null
    $tgz = Join-Path $KafkaHome "kafka.tgz"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    (New-Object Net.WebClient).DownloadFile($KafkaUrl, $tgz)
    tar -xzf $tgz -C $KafkaHome --strip-components=1
    Remove-Item $tgz
}

if ($KafkaHosted) {
    # No broker runs on this machine; -KafkaHost is expected to already be running one
    # (docker-compose up in infra/kafka). Nothing here is tracked in pids.json / -Stop.
    $kafkaPid = $null
    if (-not (Wait-Until "kafka ${KafkaHost}:${KafkaPort}" { Test-Port $KafkaPort $KafkaHost } 30)) {
        Fail "Can't reach Kafka at ${KafkaHost}:${KafkaPort}. Is 'docker-compose up' running there (infra/kafka/docker-compose.yml)? Is a firewall/security group blocking port $KafkaPort?"
    }
    $KafkaBootstrap = "${KafkaHost}:$KafkaPort"
} else {
    # The bundled .bat wrappers call wmic, which newer Windows builds no longer ship, so the
    # broker and tools are launched straight from the jars instead.
    $kafkaDataDir = "C:\tmp\kraft-combined-logs"      # log.dirs default in server.properties
    $existing = Read-Pids
    if ($existing -and (Get-Process -Id $existing.kafka -ErrorAction SilentlyContinue) -and (Test-Port $KafkaPort)) {
        Write-Host "    broker already running (pid $($existing.kafka))"
        $kafkaPid = $existing.kafka
    } elseif (Test-Port $KafkaPort) {
        Write-Host "    something else already listens on $KafkaPort; using it" -ForegroundColor Yellow
        $kafkaPid = $null
    } else {
        if (-not (Test-Path (Join-Path $kafkaDataDir "meta.properties"))) {
            Write-Host "    formatting KRaft storage"
            $id = (java "-Dlog4j.configuration=$toolsLog4j" -cp $kafkaLibs kafka.tools.StorageTool random-uuid 2>$null | Select-Object -Last 1).Trim()
            java "-Dlog4j.configuration=$toolsLog4j" -cp $kafkaLibs kafka.tools.StorageTool format -t $id -c $kafkaCfg | Out-Null
        }
        $kp = Start-Process -FilePath java -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $LogDir "kafka.log") -RedirectStandardError (Join-Path $LogDir "kafka.err") `
            -ArgumentList @("-Xms256m", "-Xmx512m", "-Dlog4j.configuration=$kafkaLog4j", "-Dkafka.logs.dir=$LogDir", "-cp", $kafkaLibs, "kafka.Kafka", $kafkaCfg)
        $kafkaPid = $kp.Id
        Write-Host "    broker starting (pid $kafkaPid)"
        if (-not (Wait-Until "kafka :$KafkaPort" { Test-Port $KafkaPort } 90)) { Fail "see $LogDir\kafka.log" }
    }
    $KafkaBootstrap = "localhost:$KafkaPort"
}

Write-Host "    ensuring topics"
foreach ($t in $Topics.GetEnumerator()) {
    java "-Dlog4j.configuration=$toolsLog4j" -cp $kafkaLibs org.apache.kafka.tools.TopicCommand `
        --bootstrap-server $KafkaBootstrap --create --if-not-exists --topic $t.Key --partitions $t.Value --replication-factor 1 2>$null |
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

Say "Auth service (services\team1-nestjs)"
Push-Location $AuthDir
try {
    if (-not (Test-Path (Join-Path $AuthDir "node_modules"))) {
        Write-Host "    npm ci"
        & npm ci --no-audit --no-fund 2>&1 | Where-Object { $_ -match "error|ERR!" } | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        if ($LASTEXITCODE -ne 0) { Fail "npm ci failed in $AuthDir" }
    } else {
        Write-Host "    node_modules present, skipping npm ci"
    }
    if ($SkipBuild -and (Test-Path $AuthMain)) {
        Write-Host "    build skipped (-SkipBuild), using dist\main.js"
    } else {
        Write-Host "    npm run build"
        & npm run build 2>&1 | Where-Object { $_ -match "error" } | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $AuthMain)) { Fail "auth service build failed in $AuthDir" }
    }
} finally {
    Pop-Location
}

# ------------------------------------------------------------------ 5. services
Say "Starting services"
$prev = Read-Pids
if ($prev) {
    Stop-Tracked "old executor" $prev.executor; Stop-Tracked "old trade-api" $prev.api
    Stop-Tracked "old auth" $prev.auth; Stop-Tracked "old auth-stub" $prev.authstub
    # Stop-Process returns before the listener is gone; give Windows a moment to release the ports.
    Wait-Until "ports $ApiPort/$ExecPort/$AuthPort released" { -not (Test-Port $ApiPort) -and -not (Test-Port $ExecPort) -and -not (Test-Port $AuthPort) } 20 | Out-Null
}
foreach ($p in $ApiPort, $ExecPort, $AuthPort) { if (Test-Port $p) { Fail "port $p is already in use by something this script did not start" } }

$jvmCommon = @("-Xmx512m", "-Dtrustme.password=$TrustMePassword", "-Dtrustme.key-file=$KeyFile")

# The API and the auth service both read JWT_SECRET (the auth service signs tokens with it;
# the API verifies them with it, overriding the TrustMe vault's jwt.secret so the two always
# agree). KAFKA_BOOTSTRAP_SERVERS has to be set before EITHER the API
# or the executor start: both run a Kafka producer (trade-api publishes ORDER_PLACED, the
# executor publishes/consumes everything else), and Spring only reads env vars present at
# JVM startup - setting it after the API was already launched (an earlier version of this
# script did exactly that) meant the API silently fell back to its localhost:9092 default,
# which happened to work only because Kafka used to run on this same machine.
$env:JWT_SECRET = $JwtSecret
$env:KAFKA_BOOTSTRAP_SERVERS = $KafkaBootstrap

# The auth service's settings go into this process's environment only for as long as it takes
# to start it (Start-Process hands the child a copy), then come straight back out, so the
# database password is not left behind in the PowerShell session that ran this script.
$authEnv = @{
    PORT = "$AuthPort"; NODE_ENV = "development"; JWT_ISSUER = "auth-service"
    DB_HOST = $Db.host; DB_PORT = $Db.port; DB_NAME = $Db.name; DB_USERNAME = $Db.user; DB_PASSWORD = $Db.password
}
foreach ($k in $authEnv.Keys) { Set-Item -Path "Env:$k" -Value $authEnv[$k] }
try {
    $authStub = Start-Process -FilePath node -PassThru -WindowStyle Hidden -WorkingDirectory $AuthDir `
        -RedirectStandardOutput (Join-Path $LogDir "auth.log") -RedirectStandardError (Join-Path $LogDir "auth.err") `
        -ArgumentList @("dist\main.js")
} finally {
    foreach ($k in $authEnv.Keys) { Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue }
}
# On some machines `node` on PATH is a .cmd/.bat shim (nvm-windows, Volta, corepack, ...)
# rather than node.exe directly - Start-Process then launches it via cmd.exe, and the PID
# above is the wrapper's, not the real Node process underneath. Stopping that PID later
# kills an empty shell and leaves the actual auth service running, still bound to the port,
# which looks exactly like -Stop or a restart silently not touching it. Detect that and
# track the real child node.exe instead - confirmed against a real shim in testing that a
# single short sleep isn't reliably long enough for the child to appear, so this polls.
$authStubId = $authStub.Id
$authStubProc = Get-Process -Id $authStub.Id -ErrorAction SilentlyContinue
if ($authStubProc -and $authStubProc.ProcessName -ne "node") {
    $child = $null
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while (-not $child -and $sw.Elapsed.TotalSeconds -lt 5) {
        $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($authStub.Id)" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq "node.exe" } | Select-Object -First 1
        if (-not $child) { Start-Sleep -Milliseconds 200 }
    }
    if ($child) {
        Write-Host "    auth       node on PATH is a shim ($($authStubProc.ProcessName)); tracking its child node.exe instead"
        $authStubId = $child.ProcessId
    } else {
        Write-Host "    auth       node on PATH is a shim ($($authStubProc.ProcessName)) and no node.exe child appeared within 5s; tracking the shim's own pid, which -Stop may not actually kill" -ForegroundColor Yellow
    }
}
Write-Host "    auth       pid $authStubId  -> http://localhost:$AuthPort  (OpenAPI docs: /docs)"

$api = Start-Process -FilePath java -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "api.log") -RedirectStandardError (Join-Path $LogDir "api.err") `
    -ArgumentList ($jvmCommon + @("-jar", $apiJar))
Write-Host "    trade-api  pid $($api.Id)  -> http://localhost:$ApiPort"

$exe = Start-Process -FilePath java -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "executor.log") -RedirectStandardError (Join-Path $LogDir "executor.err") `
    -ArgumentList ($jvmCommon + @("-jar", $execJar))
Write-Host "    executor   pid $($exe.Id)  -> http://localhost:$ExecPort"

@{ kafka = $kafkaPid; api = $api.Id; executor = $exe.Id; auth = $authStubId; started = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content $PidFile

$authStubUp = Wait-Until "auth      /health"        { Get-AuthHealth } 60
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

$logsList = if ($KafkaHosted) { "api,executor,auth" } else { "api,executor,auth,kafka" }
Say "Ready" Green
Write-Host @"
  Trade API   http://localhost:$ApiPort      Executor  http://localhost:$ExecPort      Kafka $KafkaBootstrap$(if ($KafkaHosted) { " (remote)" })
  Auth        http://localhost:$AuthPort      (OpenAPI docs http://localhost:$AuthPort/docs)
  Logs        $LogDir\{$logsList}.log        PIDs  $PidFile
  JWT (acct 1, 1h)  saved to $LogDir\token.txt

  # place an order (PowerShell; the -replace escapes quotes for curl.exe, which PS 5.1 otherwise strips)
  `$T = Get-Content '$LogDir\token.txt'
  `$body = '{"accountId":1,"symbol":"RELIANCE","side":"BUY","quantity":1,"price":1300.00,"idempotencyKey":"k-' + [DateTimeOffset]::Now.ToUnixTimeSeconds() + '"}'
  curl.exe -s -X POST localhost:$ApiPort/api/v1/orders -H "Authorization: Bearer `$T" -H "Content-Type: application/json" -d (`$body -replace '"','\"')
  curl.exe -s localhost:$ApiPort/api/v1/accounts/1/orders  -H "Authorization: Bearer `$T"
  curl.exe -s localhost:$ApiPort/api/v1/accounts/1/balance -H "Authorization: Bearer `$T"

  # onboard a new user end to end through the auth service (PowerShell): register, log in, claim
  # one of the seeded unclaimed bank accounts, refresh, fund the wallet. To run it again, change the
  # username and email and claim another unclaimed account: IN45ICIC0000008901234,
  # IN45SBIN0000009012345, IN45AXIS0000010123456, IN45KKBK0000011234567, IN45YESB0000012345678.
  # Seeded users can't log in: their password hashes are placeholders.
  `$A = 'http://localhost:$AuthPort'; `$API = 'http://localhost:$ApiPort'
  Invoke-RestMethod "`$A/auth/register" -Method Post -ContentType application/json -Body '{"username":"priya.menon","email":"priya.menon@example.com","password":"Correct-Horse-Battery-9"}'
  `$S = Invoke-RestMethod "`$A/auth/login" -Method Post -ContentType application/json -Body '{"username":"priya.menon","password":"Correct-Horse-Battery-9"}'
  `$H = @{ Authorization = "Bearer `$(`$S.accessToken)" }   # accountId null: account routes are ACC-403 until the link
  `$L = Invoke-RestMethod "`$API/api/v1/bank-accounts" -Method Post -Headers `$H -ContentType application/json -Body '{"accountNumber":"IN45HDFC0000007890123"}'
  `$S = Invoke-RestMethod "`$A/auth/refresh" -Method Post -ContentType application/json -Body (@{ refreshToken = `$S.refreshToken } | ConvertTo-Json)
  `$H = @{ Authorization = "Bearer `$(`$S.accessToken)" }   # now carries the new accountId
  Invoke-RestMethod "`$API/api/v1/accounts/`$(`$L.accountId)/transfers" -Method Post -Headers `$H -ContentType application/json -Body (@{ direction = 'BANK_TO_WALLET'; amount = 10000; idempotencyKey = [guid]::NewGuid().ToString() } | ConvertTo-Json)
  Invoke-RestMethod "`$API/api/v1/accounts/`$(`$L.accountId)/balance" -Headers `$H

  # watch a topic
  java -cp "$kafkaLibs" org.apache.kafka.tools.consumer.ConsoleConsumer --bootstrap-server $KafkaBootstrap --topic trade-events --from-beginning

  # stop everything$(if ($KafkaHosted) { " (Kafka is remote - not stopped here; manage it on that box separately)" })
  .\run-local.ps1 -Stop
"@

if ($NoTail) { exit 0 }
} # end of setup (skipped by -TailOnly)

# ------------------------------------------------------------------ 7. merged log tail
Say "Tailing logs (Ctrl+C stops the tail only; services keep running)" Yellow
$pgLogDir = Get-ChildItem "C:\Program Files\PostgreSQL\*\data\log" -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
$sources = @(
    @{ tag = "API   "; color = "Green";   path = (Join-Path $LogDir "api.log") },
    @{ tag = "API!  "; color = "Red";     path = (Join-Path $LogDir "api.err") },
    @{ tag = "EXEC  "; color = "Cyan";    path = (Join-Path $LogDir "executor.log") },
    @{ tag = "EXEC! "; color = "Red";     path = (Join-Path $LogDir "executor.err") },
    @{ tag = "AUTH  "; color = "Yellow";  path = (Join-Path $LogDir "auth.log") },
    @{ tag = "AUTH! "; color = "Red";     path = (Join-Path $LogDir "auth.err") },
    @{ tag = "KAFKA "; color = "Magenta"; path = (Join-Path $LogDir "kafka.log") },
    @{ tag = "KAFKA!"; color = "Red";     path = (Join-Path $LogDir "kafka.err") }
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
