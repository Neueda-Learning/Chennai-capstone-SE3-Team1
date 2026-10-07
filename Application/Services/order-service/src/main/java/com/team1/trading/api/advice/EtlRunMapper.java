package com.team1.trading.api.advice;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Optional;

/** The etl_daily_runs ledger (migration 033): one row per analysis day. */
@Mapper
public interface EtlRunMapper {

    @Select("""
            SELECT run_day AS runDay, status, trigger_source AS triggerSource, attempts, started_at AS startedAt,
                   finished_at AS finishedAt, exit_code AS exitCode, message
            FROM etl_daily_runs
            WHERE run_day = #{day}
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    Optional<RunRow> find(@Param("day") LocalDate day);

    /** First claim of the day. A duplicate key means another start or check got there first. */
    @Insert("""
            INSERT INTO etl_daily_runs (run_day, status, trigger_source, attempts, started_at)
            VALUES (#{day}, 'RUNNING', #{trigger}, 1, #{now})
            """)
    int claimNew(@Param("day") LocalDate day, @Param("trigger") String trigger, @Param("now") LocalDateTime now);

    /** Re-claim a day whose run failed, or whose RUNNING row was left by a process that died, within the attempt limit. */
    @Update("""
            UPDATE etl_daily_runs
            SET status = 'RUNNING', trigger_source = #{trigger}, attempts = attempts + 1, started_at = #{now},
                finished_at = NULL, exit_code = NULL, message = NULL
            WHERE run_day = #{day}
              AND attempts < #{maxAttempts}
              AND (status = 'FAILED' OR (status = 'RUNNING' AND started_at < #{abandonedBefore}))
            """)
    int reclaim(@Param("day") LocalDate day, @Param("trigger") String trigger, @Param("now") LocalDateTime now,
                @Param("maxAttempts") int maxAttempts, @Param("abandonedBefore") LocalDateTime abandonedBefore);

    @Update("""
            UPDATE etl_daily_runs
            SET status = #{status}, finished_at = #{now}, exit_code = #{exitCode, jdbcType=INTEGER},
                message = #{message, jdbcType=VARCHAR}
            WHERE run_day = #{day} AND status = 'RUNNING'
            """)
    int finish(@Param("day") LocalDate day, @Param("status") String status,
               @Param("exitCode") Integer exitCode, @Param("message") String message,
               @Param("now") LocalDateTime now);

    class RunRow {
        private LocalDate runDay;
        private String status;
        private String triggerSource;
        private int attempts;
        private LocalDateTime startedAt;
        private LocalDateTime finishedAt;
        private Integer exitCode;
        private String message;

        public LocalDate getRunDay() { return runDay; }
        public void setRunDay(LocalDate runDay) { this.runDay = runDay; }
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
        public String getTriggerSource() { return triggerSource; }
        public void setTriggerSource(String triggerSource) { this.triggerSource = triggerSource; }
        public int getAttempts() { return attempts; }
        public void setAttempts(int attempts) { this.attempts = attempts; }
        public LocalDateTime getStartedAt() { return startedAt; }
        public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
        public LocalDateTime getFinishedAt() { return finishedAt; }
        public void setFinishedAt(LocalDateTime finishedAt) { this.finishedAt = finishedAt; }
        public Integer getExitCode() { return exitCode; }
        public void setExitCode(Integer exitCode) { this.exitCode = exitCode; }
        public String getMessage() { return message; }
        public void setMessage(String message) { this.message = message; }
    }
}
