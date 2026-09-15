package com.team1.trading.api.characterisation;

import app.trustme.TrustMe;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Provisions the dedicated PostgreSQL database the Sprint 7 characterisation tests run
 * against, then injects the datasource settings into the Spring test context.
 *
 * <p>Why a real database and not H2: Sprint 6's {@code PositionMapper} upserts use the
 * PostgreSQL-only {@code INSERT ... ON CONFLICT ... DO UPDATE} syntax. H2 (any mode,
 * including {@code MODE=PostgreSQL}) cannot parse that clause, and the Sprint 6 sources
 * must not be rewritten to appease H2, so the order placement path is pinned against the
 * same engine it runs on in production.
 *
 * <p>The connection settings come from the same TrustMe key file the Sprint 6 app uses, so
 * no database credentials are hard-coded or committed. Everything is overridable through
 * environment variables ({@code TRUSTME_KEY_FILE}, {@code CHARACT_DB_NAME}), which also
 * makes a plain local PostgreSQL the only external requirement.
 */
public class PostgresCharactDbInitializer
        implements ApplicationContextInitializer<ConfigurableApplicationContext> {

    static final String MAINTENANCE_DB = "postgres";

    @Override
    public void initialize(ConfigurableApplicationContext context) {
        try {
            DbSettings settings = DbSettings.resolve();
            ensureDatabase(settings);
            Map<String, Object> props = datasourceProperties(settings);
            context.getEnvironment().getPropertySources()
                    .addFirst(new MapPropertySource("characterisationDatasource", props));
        } catch (Exception e) {
            throw new IllegalStateException(
                    "Sprint 7 characterisation tests need a local PostgreSQL server (default "
                            + "localhost:5432) initialised with the team TrustMe key file so the "
                            + "order placement path can be pinned against the real engine. "
                            + "Detail: " + e.getMessage(), e);
        }
    }

    private void ensureDatabase(DbSettings s) throws Exception {
        String url = "jdbc:postgresql://" + s.host + ":" + s.port + "/" + MAINTENANCE_DB;
        try (Connection conn = DriverManager.getConnection(url, s.user, s.password);
             PreparedStatement lookup = conn.prepareStatement(
                     "SELECT 1 FROM pg_database WHERE datname = ?")) {
            conn.setAutoCommit(true);
            lookup.setString(1, s.dbName);
            try (ResultSet rs = lookup.executeQuery()) {
                if (rs.next()) {
                    return;
                }
            }
            try (Statement create = conn.createStatement()) {
                create.execute("CREATE DATABASE \"" + s.dbName + "\"");
            }
        }
    }

    private static Map<String, Object> datasourceProperties(DbSettings s) {
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("spring.datasource.url", "jdbc:postgresql://" + s.host + ":" + s.port + "/" + s.dbName);
        props.put("spring.datasource.username", s.user);
        props.put("spring.datasource.password", s.password);
        props.put("spring.datasource.driver-class-name", "org.postgresql.Driver");
        props.put("spring.jpa.database-platform", "org.hibernate.dialect.PostgreSQLDialect");
        return props;
    }

    /** Connection details for the characterisation database, from TrustMe or environment. */
    static final class DbSettings {
        final String host;
        final String port;
        final String user;
        final String password;
        final String dbName;

        DbSettings(String host, String port, String user, String password, String dbName) {
            this.host = host;
            this.port = port;
            this.user = user;
            this.password = password;
            this.dbName = dbName;
        }

        static DbSettings resolve() {
            String keyFile = envOrSystem("TRUSTME_KEY_FILE", "trustme.key-file");
            if (keyFile == null) {
                keyFile = "../leapcapstoneteam1-720d03.TM";
            }
            String dbName = envOrSystem("CHARACT_DB_NAME", "charact.dbname");
            if (dbName == null) {
                dbName = "trading_charact";
            }

            String host = null, port = null, user = null, password = null;
            Path keyPath = Paths.get(keyFile).toAbsolutePath().normalize();
            if (Files.isRegularFile(keyPath)) {
                // useKeyFile() sets the static default key file that the static get()
                // reads (using() merely builds an instance and does not register it).
                TrustMe.useKeyFile(keyPath);
                host = TrustMe.get("PostGres_Host");
                port = TrustMe.get("Postgres_Port");
                user = TrustMe.get("PostGres_User");
                password = TrustMe.get("PostGres");
            }
            if (host == null || host.isBlank()) host = envOrSystem("PostGres_Host", "PostGres_Host");
            if (port == null || port.isBlank()) port = envOrSystem("Postgres_Port", "Postgres_Port");
            if (user == null || user.isBlank()) user = envOrSystem("PostGres_User", "PostGres_User");
            if (password == null || password.isBlank()) password = envOrSystem("Postgres", "Postgres");
            if (host == null || port == null || user == null || password == null) {
                throw new IllegalArgumentException(
                        "PostgreSQL credentials are not available from the TrustMe key file ("
                                + keyPath + ") or the PostGres_* / Postgres_* environment variables.");
            }
            return new DbSettings(host.trim(), port.trim(), user.trim(), password, dbName);
        }

        private static String envOrSystem(String env, String sysProp) {
            String value = System.getenv(env);
            if (value == null || value.isBlank()) {
                value = System.getProperty(sysProp);
            }
            return value;
        }
    }
}