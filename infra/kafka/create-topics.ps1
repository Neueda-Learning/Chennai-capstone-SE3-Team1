# Creates the six contracted topics (three source + three dead-letter) on the
# team's broker. Idempotent: safe to run as many times as you like.
#
# Run from the repository root with the broker up:
#   infra\kafka\create-topics.ps1
#
# The bash sibling (create-topics.sh) is the equivalent for Git Bash / macOS.

$ErrorActionPreference = "Stop"

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    $candidate = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
    if (Test-Path $candidate) { $docker = $candidate } else { throw "docker not found on PATH" }
    $docker = (Get-Command $candidate).Source
} else {
    $docker = $docker.Source
}

$composeFile = "infra/kafka/docker-compose.yml"

$topics = @(
    @{ Name = "orders";                    Partitions = 3; Retention = "604800000"  },
    @{ Name = "trade-events";              Partitions = 3; Retention = "2592000000" },
    @{ Name = "market-data";               Partitions = 6; Retention = "86400000"   },
    @{ Name = "orders.DLT";                Partitions = 3; Retention = "604800000"  },
    @{ Name = "trade-events.DLT";          Partitions = 3; Retention = "2592000000" },
    @{ Name = "market-data.DLT";           Partitions = 6; Retention = "86400000"   }
)

foreach ($t in $topics) {
    & $docker compose -f $composeFile exec -T kafka /opt/kafka/bin/kafka-topics.sh `
        --bootstrap-server localhost:9092 --create --if-not-exists `
        --topic $t.Name --partitions $t.Partitions --replication-factor 1 `
        --config "retention.ms=$($t.Retention)"
    if ($LASTEXITCODE -ne 0) { throw "kafka-topics.sh failed for $($t.Name) with exit $LASTEXITCODE" }
}

Write-Host "--- catalogue ---"
& $docker compose -f $composeFile exec -T kafka /opt/kafka/bin/kafka-topics.sh `
    --bootstrap-server localhost:9092 --list
if ($LASTEXITCODE -ne 0) { throw "topic list failed with exit $LASTEXITCODE" }

Write-Host "--- detail ---"
& $docker compose -f $composeFile exec -T kafka /opt/kafka/bin/kafka-topics.sh `
    --bootstrap-server localhost:9092 --describe
if ($LASTEXITCODE -ne 0) { throw "topic describe failed with exit $LASTEXITCODE" }