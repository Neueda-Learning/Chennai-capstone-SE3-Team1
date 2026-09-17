<#
.SYNOPSIS
    One-shot local bring-up of the trading platform on Windows: Kafka, Postgres schema,
    Trade API and Trade Executor, then a merged live tail of every log.

.DESCRIPTION
    Run from anywhere; the script cd's to the repo root it lives in. Windows PowerShell 5.1
    compatible. No Docker.

    What it does, in order:
      1. Checks java, mvn, python (+trustme_secrets), psql, and the TrustMe key file.
      2. Kafka 3.8.0: downloads to -KafkaHome if absent, formats KRaft storage once, starts the
         broker, waits for :9092, creates the six contracted topics.
      3. Applies migrations + seed to local Postgres via scripts\apply_db.py (-ResetDb rebuilds).
      4. Builds domain-engine, eventbus, sprint-06-api and executor (-SkipBuild reuses jars).
      5. Starts the API (:8081) and the executor (:8083), waits for /actuator/health.
      6. Mints a 1-hour JWT for account 1 and prints ready-to-paste curl commands.
      7. Tails api / executor / kafka / postgres logs together until Ctrl+C.
         Ctrl+C stops only the tail; the services keep running. Use -Stop to shut them down.

.PARAMETER TrustMePassword   Password for leapcapstoneteam1-720d03.TM. Prompted for (masked) if omitted, which is the normal way to run this.
.PARAMETER JwtSecret         HS256 secret the API verifies tokens with. Default is a dev value.
.PARAMETER KafkaHome         Where Kafka lives / gets installed. Default C:\kafka.
.PARAMETER SkipBuild         Reuse the jars already in target\.
.PARAMETER ResetDb           Drop and recreate trading_platform before migrating.
.PARAMETER NoTail            Start everything and return without tailing logs.
.PARAMETER TailOnly          Skip setup; just attach the merged log tail to the running services.
.PARAMETER Stop              Stop the API, executor and Kafka started by a previous run, then exit.

.EXAMPLE
    .\run-local.ps1                       # prompts for the TrustMe password
.EXAMPLE
    .\run-local.ps1 -SkipBuild            # fast restart after a stop
.EXAMPLE
    .\run-local.ps1 -TailOnly             # re-attach to the logs of a running stack
.EXAMPLE
    .\run-local.ps1 -Stop
#>
[CmdletBinding()]
param(
    [string]$TrustMePassword,
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
$Topics     = @{ "orders"=3; "trade-events"=3; "market-data"=6; "orders.DLT"=3; "trade-events.DLT"=3; "market-data.DLT"=6 }

Set-Location $RepoRoot
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Say($msg, $color = "Cyan") { Write-Host ""; Write-Host "==> $msg" -ForegroundColor $color }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

function Test-Port($port) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $r = $c.BeginConnect("127.0.0.1", $port, $null, $null)
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
    Say "Stopping services" Yellow
    $pids = Read-Pids
    if (-not $pids) { Write-Host "    nothing tracked in $PidFile"; exit 0 }
    Stop-Tracked "executor" $pids.executor
    Stop-Tracked "trade-api" $pids.api
    Stop-Tracked "kafka" $pids.kafka
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    exit 0
}

if ($TailOnly) {
    $kafkaLibs = Join-Path $KafkaHome "libs\*"
    Say "Attached to running services (PIDs in $PidFile)" Green
} else {

# ------------------------------------------------------------------ 1. prerequisites
Say "Checking prerequisites"
foreach ($tool in "java", "mvn", "python") {
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
if (-not (Test-Port 5432)) { Fail "Postgres is not listening on 5432 (start the postgresql service)" }

if (-not $TrustMePassword) {
    $sec = Read-Host "TrustMe key file password" -AsSecureString
    $TrustMePassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
Write-Host "    java: $((cmd /c "java -version 2>&1" | Select-Object -First 1))"
Write-Host "    key file, psql, python, postgres: ok"

$pyTrust = @("-X", "trustme_password=$TrustMePassword", "-X", "trustme_keyfile=$KeyFile")

# ------------------------------------------------------------------ 2. kafka
Say "Kafka $KafkaVer at $KafkaHome"
$kafkaLibs = Join-Path $KafkaHome "libs\*"
$kafkaCfg  = Join-Path $KafkaHome "config\kraft\server.properties"
$kafkaLog4j = "file:" + ((Join-Path $KafkaHome "config\log4j.properties") -replace "\\", "/")
$toolsLog4j = "file:" + ((Join-Path $KafkaHome "config\tools-log4j.properties") -replace "\\", "/")

if (-not (Test-Path $kafkaCfg)) {
    Write-Host "    downloading $KafkaUrl"
    New-Item -ItemType Directory -Force -Path $KafkaHome | Out-Null
    $tgz = Join-Path $KafkaHome "kafka.tgz"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    (New-Object Net.WebClient).DownloadFile($KafkaUrl, $tgz)
    tar -xzf $tgz -C $KafkaHome --strip-components=1
    Remove-Item $tgz
}

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

Write-Host "    ensuring topics"
foreach ($t in $Topics.GetEnumerator()) {
    java "-Dlog4j.configuration=$toolsLog4j" -cp $kafkaLibs org.apache.kafka.tools.TopicCommand `
        --bootstrap-server "localhost:$KafkaPort" --create --if-not-exists --topic $t.Key --partitions $t.Value --replication-factor 1 2>$null |
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

# ------------------------------------------------------------------ 5. services
Say "Starting services"
$prev = Read-Pids
if ($prev) {
    Stop-Tracked "old executor" $prev.executor; Stop-Tracked "old trade-api" $prev.api
    # Stop-Process returns before the listener is gone; give Windows a moment to release the ports.
    Wait-Until "ports $ApiPort/$ExecPort released" { -not (Test-Port $ApiPort) -and -not (Test-Port $ExecPort) } 20 | Out-Null
}
foreach ($p in $ApiPort, $ExecPort) { if (Test-Port $p) { Fail "port $p is already in use by something this script did not start" } }

$jvmCommon = @("-Xmx512m", "-Dtrustme.password=$TrustMePassword", "-Dtrustme.key-file=$KeyFile")

$env:JWT_SECRET = $JwtSecret
$api = Start-Process -FilePath java -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "api.log") -RedirectStandardError (Join-Path $LogDir "api.err") `
    -ArgumentList ($jvmCommon + @("-jar", $apiJar))
Write-Host "    trade-api  pid $($api.Id)  -> http://localhost:$ApiPort"

$env:KAFKA_BOOTSTRAP_SERVERS = "localhost:$KafkaPort"
$exe = Start-Process -FilePath java -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir "executor.log") -RedirectStandardError (Join-Path $LogDir "executor.err") `
    -ArgumentList ($jvmCommon + @("-jar", $execJar))
Write-Host "    executor   pid $($exe.Id)  -> http://localhost:$ExecPort"

@{ kafka = $kafkaPid; api = $api.Id; executor = $exe.Id; started = (Get-Date).ToString("s") } | ConvertTo-Json | Set-Content $PidFile

$apiUp  = Wait-Until "trade-api /actuator/health" { Get-Health $ApiPort } 150
$execUp = Wait-Until "executor  /actuator/health" { Get-Health $ExecPort } 150
if (-not ($apiUp -and $execUp)) { Write-Host "    check $LogDir\*.log for the failure" -ForegroundColor Red }

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
  Trade API   http://localhost:$ApiPort      Executor  http://localhost:$ExecPort      Kafka localhost:$KafkaPort
  Logs        $LogDir\{api,executor,kafka}.log        PIDs  $PidFile
  JWT (acct 1, 1h)  saved to $LogDir\token.txt

  # place an order (PowerShell; the -replace escapes quotes for curl.exe, which PS 5.1 otherwise strips)
  `$T = Get-Content '$LogDir\token.txt'
  `$body = '{"accountId":1,"symbol":"RELIANCE","side":"BUY","quantity":1,"price":1300.00,"idempotencyKey":"k-' + [DateTimeOffset]::Now.ToUnixTimeSeconds() + '"}'
  curl.exe -s -X POST localhost:$ApiPort/api/v1/orders -H "Authorization: Bearer `$T" -H "Content-Type: application/json" -d (`$body -replace '"','\"')
  curl.exe -s localhost:$ApiPort/api/v1/accounts/1/orders  -H "Authorization: Bearer `$T"
  curl.exe -s localhost:$ApiPort/api/v1/accounts/1/balance -H "Authorization: Bearer `$T"

  # watch a topic
  java -cp "$kafkaLibs" org.apache.kafka.tools.consumer.ConsoleConsumer --bootstrap-server localhost:$KafkaPort --topic trade-events --from-beginning

  # stop everything
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
