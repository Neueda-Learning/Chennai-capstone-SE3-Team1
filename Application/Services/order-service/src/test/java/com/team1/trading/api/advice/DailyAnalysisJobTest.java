package com.team1.trading.api.advice;

import com.team1.trading.api.advice.DailyAnalysisJob.Outcome;
import com.team1.trading.api.advice.DailyAnalysisJob.Settings;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:dailyanalysis;DB_CLOSE_DELAY=-1")
class DailyAnalysisJobTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Autowired
    private EtlRunMapper ledger;
    @Autowired
    private JdbcTemplate jdbc;
    @TempDir
    private Path repo;

    private FakeRunner runner;

    static class FakeRunner implements EtlRunner {
        final List<List<String>> commands = new ArrayList<>();
        int exitCode = 0;

        @Override
        public Result run(List<String> command, Path workdir, Duration timeout) {
            commands.add(command);
            return new Result(exitCode, List.of("INFO daily: warehouse: 150 of 150 symbols", "INFO published"));
        }
    }

    @BeforeEach
    void setUp() throws IOException {
        jdbc.update("DELETE FROM etl_daily_runs");
        runner = new FakeRunner();
        Files.createDirectories(repo.resolve("Application/ETL/etl-live"));
        Files.writeString(repo.resolve(DailyAnalysisJob.SCRIPT), "# stand-in");
        Files.writeString(repo.resolve("vault.TM"), "key");
    }

    private DailyAnalysisJob jobAt(String istDateTime) {
        Clock clock = Clock.fixed(LocalDateTime.parse(istDateTime).atZone(IST).toInstant(), IST);
        Settings settings = new Settings("python", repo, "s3cret", repo.resolve("vault.TM"), LocalTime.of(16, 30), IST,
                Duration.ofMinutes(45), 3);
        return new DailyAnalysisJob(ledger, runner, settings, clock);
    }

    private Map<String, Object> row(String day) {
        return jdbc.queryForMap("SELECT * FROM etl_daily_runs WHERE run_day = ?", java.sql.Date.valueOf(day));
    }

    @Test
    @DisplayName("The analysis day turns over at the cutoff: before 16:30 it is yesterday's, from 16:30 today's")
    void analysisDay() {
        assertThat(jobAt("2026-10-07T10:00:00").analysisDay()).isEqualTo(LocalDate.of(2026, 10, 6));
        assertThat(jobAt("2026-10-07T16:29:59").analysisDay()).isEqualTo(LocalDate.of(2026, 10, 6));
        assertThat(jobAt("2026-10-07T16:30:00").analysisDay()).isEqualTo(LocalDate.of(2026, 10, 7));
        assertThat(jobAt("2026-10-08T01:00:00").analysisDay()).isEqualTo(LocalDate.of(2026, 10, 7));
    }

    @Test
    @DisplayName("The first check of a day runs the ETL once, for that day, and records the outcome")
    void runsOnceAndRecords() {
        Outcome outcome = jobAt("2026-10-07T17:00:00").runIfDue("startup");

        assertThat(outcome).isEqualTo(Outcome.SUCCEEDED);
        assertThat(runner.commands).singleElement().satisfies(command -> {
            assertThat(command).containsSubsequence("--day", "2026-10-07");
            assertThat(command).contains("-X", "trustme_password=s3cret");
            assertThat(command.get(command.indexOf("--db") + 1)).endsWith("warehouse.duckdb");
            assertThat(command).anyMatch(part -> part.endsWith("daily.py"));
        });
        Map<String, Object> row = row("2026-10-07");
        assertThat(row.get("STATUS")).isEqualTo("SUCCEEDED");
        assertThat(row.get("TRIGGER_SOURCE")).isEqualTo("startup");
        assertThat(row.get("EXIT_CODE")).isEqualTo(0);
        assertThat((String) row.get("MESSAGE")).contains("150 of 150 symbols");
    }

    @Test
    @DisplayName("A restart the same analysis day reuses what was published and does not run the ETL again")
    void restartSameDayUsesTheCachedRun() {
        jobAt("2026-10-07T17:00:00").runIfDue("startup");

        assertThat(jobAt("2026-10-07T21:00:00").runIfDue("startup")).isEqualTo(Outcome.ALREADY_DONE);
        assertThat(jobAt("2026-10-08T09:30:00").runIfDue("startup"))
                .as("the next morning is still the 7th's analysis day").isEqualTo(Outcome.ALREADY_DONE);
        assertThat(runner.commands).hasSize(1);
    }

    @Test
    @DisplayName("The first check after the next cutoff runs the next day")
    void nextDayRunsAgain() {
        jobAt("2026-10-07T17:00:00").runIfDue("startup");

        assertThat(jobAt("2026-10-08T16:45:00").runIfDue("schedule")).isEqualTo(Outcome.SUCCEEDED);
        assertThat(runner.commands).hasSize(2);
        assertThat(runner.commands.get(1)).containsSubsequence("--day", "2026-10-08");
    }

    @Test
    @DisplayName("Published from stored data (exit 3) closes the day: quota is not spent again")
    void partialClosesTheDay() {
        runner.exitCode = 3;
        assertThat(jobAt("2026-10-07T17:00:00").runIfDue("startup")).isEqualTo(Outcome.PARTIAL);

        assertThat(jobAt("2026-10-07T17:15:00").runIfDue("schedule")).isEqualTo(Outcome.ALREADY_DONE);
        assertThat(runner.commands).hasSize(1);
    }

    @Test
    @DisplayName("A failed day is retried on the next check, up to three attempts")
    void failedIsRetriedUpToTheLimit() {
        runner.exitCode = 1;
        for (int attempt = 1; attempt <= 3; attempt++) {
            assertThat(jobAt("2026-10-07T17:00:00").runIfDue("schedule")).isEqualTo(Outcome.FAILED);
        }
        assertThat(jobAt("2026-10-07T17:00:00").runIfDue("schedule")).isEqualTo(Outcome.GAVE_UP);
        assertThat(runner.commands).hasSize(3);
        assertThat(row("2026-10-07").get("ATTEMPTS")).isEqualTo(3);
    }

    @Test
    @DisplayName("A run in progress is not started twice; one left behind by a dead process is taken over")
    void runningIsNotDuplicated() {
        ledger.claimNew(LocalDate.of(2026, 10, 7), "startup", LocalDateTime.of(2026, 10, 7, 17, 0));

        assertThat(jobAt("2026-10-07T17:10:00").runIfDue("schedule")).isEqualTo(Outcome.ALREADY_RUNNING);
        assertThat(runner.commands).isEmpty();

        assertThat(jobAt("2026-10-07T18:30:00").runIfDue("schedule")).isEqualTo(Outcome.SUCCEEDED);
        assertThat(runner.commands).hasSize(1);
    }

    @Test
    @DisplayName("Without an ETL folder the job is off and runs nothing")
    void noFolderNoRun() {
        assertThat(DailyAnalysisJob.resolveWorkdir("", repo.resolve("elsewhere/vault.TM").toString())).isNull();
        assertThat(DailyAnalysisJob.resolveWorkdir("", repo.resolve("vault.TM").toString())).isEqualTo(repo);
        assertThat(DailyAnalysisJob.resolveWorkdir(repo.toString(), "")).isEqualTo(repo);

        DailyAnalysisJob off = new DailyAnalysisJob(ledger, runner, new Settings("python", null, "", null,
                LocalTime.of(16, 30), IST, Duration.ofMinutes(45), 3), Clock.system(IST));
        assertThat(off.runIfDue("startup")).isEqualTo(Outcome.DISABLED);
        assertThat(runner.commands).isEmpty();
    }
}
