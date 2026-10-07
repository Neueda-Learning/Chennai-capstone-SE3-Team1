package com.team1.trading.api.advice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Starts the ETL with ProcessBuilder, streams its output into this service's log, and enforces the timeout. */
@Component
class ProcessEtlRunner implements EtlRunner {

    static final int KEEP_LINES = 6;

    private static final Logger log = LoggerFactory.getLogger(ProcessEtlRunner.class);

    @Override
    public Result run(List<String> command, Path workdir, Duration timeout) {
        Process process;
        try {
            process = new ProcessBuilder(command).directory(workdir.toFile()).redirectErrorStream(true).start();
        } catch (IOException e) {
            return new Result(Result.COULD_NOT_START, List.of("could not start " + command.get(0) + ": " + e.getMessage()));
        }
        Deque<String> tail = new ArrayDeque<>();
        Thread reader = new Thread(() -> {
            try (BufferedReader out = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = out.readLine()) != null) {
                    log.info("[etl] {}", line);
                    synchronized (tail) {
                        if (!line.isBlank()) {
                            tail.addLast(line);
                            if (tail.size() > KEEP_LINES) {
                                tail.removeFirst();
                            }
                        }
                    }
                }
            } catch (IOException e) {
                log.debug("[etl] output stream closed: {}", e.getMessage());
            }
        }, "etl-output");
        reader.setDaemon(true);
        reader.start();
        try {
            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();
                return new Result(Result.TIMED_OUT, List.of("timed out after " + timeout.toMinutes() + " minutes"));
            }
            reader.join(5_000);
        } catch (InterruptedException e) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            return new Result(Result.TIMED_OUT, List.of("interrupted"));
        }
        synchronized (tail) {
            return new Result(process.exitValue(), List.copyOf(tail));
        }
    }
}
