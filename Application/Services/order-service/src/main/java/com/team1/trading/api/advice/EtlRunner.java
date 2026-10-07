package com.team1.trading.api.advice;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

/** Runs the ETL as a child process. An interface so the job can be tested without starting Python. */
public interface EtlRunner {

    /**
     * @param command    the full command line; it may carry the vault password, so it is never logged as is
     * @param workdir    the repository root, where the scripts expect to run
     * @param timeout    the process is killed after this long
     * @return the exit code, and the last lines it printed (for the ledger)
     */
    Result run(List<String> command, Path workdir, Duration timeout);

    record Result(int exitCode, List<String> lastLines) {
        public static final int TIMED_OUT = -1;
        public static final int COULD_NOT_START = -2;
    }
}
