package com.team1.trading.api.advice;

import com.team1.trading.api.advice.EtlRunMapper.RunRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Runs the ETL (warehouse refresh, then analysis publish) once per analysis day (ADR 0015).
 *
 * The analysis day turns over at the cutoff (16:30 IST by default, after the market closes): before it, the
 * day being served is yesterday's; from it, today's. Each check asks whether that day is done in
 * etl_daily_runs. On start-up that is what makes a restart the same day reuse what was published instead of
 * running again; through the day it is what starts the next run soon after the close.
 *
 * The run itself is a child process on a dedicated thread, so it never blocks the scheduler thread that the
 * conditional-order poller and the notification and alert sweeps share.
 */
@Component
public class DailyAnalysisJob {

    static final String SCRIPT = "Application/ETL/etl-live/daily.py";

    private static final Logger log = LoggerFactory.getLogger(DailyAnalysisJob.class);

    public enum Outcome { DISABLED, ALREADY_DONE, ALREADY_RUNNING, GAVE_UP, SUCCEEDED, PARTIAL, FAILED }

    private final EtlRunMapper ledger;
    private final EtlRunner runner;
    private final Settings settings;
    private final Clock clock;
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "daily-analysis");
        thread.setDaemon(true);
        return thread;
    });

    public record Settings(String python, Path workdir, String vaultPassword, Path vaultKeyFile, LocalTime cutoff,
                           ZoneId zone, Duration timeout, int maxAttempts) {
    }

    @Autowired
    public DailyAnalysisJob(EtlRunMapper ledger, EtlRunner runner,
                            @Value("${etl.daily.python:python}") String python,
                            @Value("${etl.daily.workdir:}") String workdir,
                            @Value("${trustme.password:}") String vaultPassword,
                            @Value("${trustme.key-file:}") String vaultKeyFile,
                            @Value("${etl.daily.cutoff:16:30}") String cutoff,
                            @Value("${etl.daily.zone:Asia/Kolkata}") String zone,
                            @Value("${etl.daily.timeout-minutes:45}") long timeoutMinutes,
                            @Value("${etl.daily.max-attempts:3}") int maxAttempts) {
        this(ledger, runner, new Settings(python, resolveWorkdir(workdir, vaultKeyFile), vaultPassword,
                vaultKeyFile.isBlank() ? null : Path.of(vaultKeyFile).toAbsolutePath().normalize(),
                LocalTime.parse(cutoff), ZoneId.of(zone), Duration.ofMinutes(timeoutMinutes), maxAttempts),
                Clock.system(ZoneId.of(zone)));
    }

    DailyAnalysisJob(EtlRunMapper ledger, EtlRunner runner, Settings settings, Clock clock) {
        this.ledger = ledger;
        this.runner = runner;
        this.settings = settings;
        this.clock = clock;
    }

    /** The analysis day being served at this moment: today from the cutoff on, yesterday before it. */
    public LocalDate analysisDay() {
        ZonedDateTime now = ZonedDateTime.now(clock).withZoneSameInstant(settings.zone());
        return now.toLocalTime().isBefore(settings.cutoff()) ? now.toLocalDate().minusDays(1) : now.toLocalDate();
    }

    /** Starts a check on the job's own thread, unless one is already in progress. Never blocks the caller. */
    public void trigger(String source) {
        if (busy.compareAndSet(false, true)) {
            worker.submit(() -> {
                try {
                    runIfDue(source);
                } catch (RuntimeException e) {
                    log.error("[etl] daily analysis check failed", e);
                } finally {
                    busy.set(false);
                }
            });
        }
    }

    /** One check, on the calling thread: run the ETL if the current analysis day is not done yet. */
    Outcome runIfDue(String source) {
        if (settings.workdir() == null) {
            log.warn("[etl] daily analysis is off: no ETL folder found (set etl.daily.workdir to the repository root)");
            return Outcome.DISABLED;
        }
        LocalDate day = analysisDay();
        LocalDateTime now = LocalDateTime.now(clock);
        Optional<RunRow> existing = ledger.find(day);
        if (existing.isPresent()) {
            String status = existing.get().getStatus();
            if ("SUCCEEDED".equals(status) || "PARTIAL".equals(status)) {
                return Outcome.ALREADY_DONE;
            }
            LocalDateTime abandonedBefore = now.minus(settings.timeout()).minusMinutes(15);
            if (ledger.reclaim(day, source, now, settings.maxAttempts(), abandonedBefore) == 0) {
                return "RUNNING".equals(status) ? Outcome.ALREADY_RUNNING : Outcome.GAVE_UP;
            }
        } else {
            try {
                ledger.claimNew(day, source, now);
            } catch (DuplicateKeyException e) {
                return Outcome.ALREADY_RUNNING;
            }
        }

        log.info("[etl] daily analysis for {} starting ({})", day, source);
        EtlRunner.Result result = runner.run(command(day), settings.workdir(), settings.timeout());
        Outcome outcome = switch (result.exitCode()) {
            case 0 -> Outcome.SUCCEEDED;
            case 3 -> Outcome.PARTIAL;
            default -> Outcome.FAILED;
        };
        String message = String.join(" | ", result.lastLines());
        ledger.finish(day, outcome.name(), result.exitCode(),
                message.length() > 500 ? message.substring(message.length() - 500) : message, LocalDateTime.now(clock));
        log.info("[etl] daily analysis for {} finished: {} (exit {})", day, outcome, result.exitCode());
        return outcome;
    }

    List<String> command(LocalDate day) {
        List<String> command = new ArrayList<>(List.of(settings.python()));
        if (settings.vaultPassword() != null && !settings.vaultPassword().isBlank()) {
            command.addAll(List.of("-X", "trustme_password=" + settings.vaultPassword()));
        }
        if (settings.vaultKeyFile() != null) {
            command.addAll(List.of("-X", "trustme_keyfile=" + settings.vaultKeyFile()));
        }
        command.addAll(List.of(settings.workdir().resolve(SCRIPT).toString(), "--day", day.toString(),
                "--db", settings.workdir().resolve("warehouse.duckdb").toString()));
        return command;
    }

    /** The repository root: etl.daily.workdir if set, else the folder holding the vault key, if the ETL is there. */
    static Path resolveWorkdir(String configured, String keyFile) {
        List<Path> candidates = new ArrayList<>();
        if (configured != null && !configured.isBlank()) {
            candidates.add(Path.of(configured));
        }
        if (keyFile != null && !keyFile.isBlank()) {
            Path parent = Path.of(keyFile).toAbsolutePath().normalize().getParent();
            if (parent != null) {
                candidates.add(parent);
            }
        }
        return candidates.stream().map(p -> p.toAbsolutePath().normalize())
                .filter(p -> Files.isRegularFile(p.resolve(SCRIPT))).findFirst().orElse(null);
    }
}
