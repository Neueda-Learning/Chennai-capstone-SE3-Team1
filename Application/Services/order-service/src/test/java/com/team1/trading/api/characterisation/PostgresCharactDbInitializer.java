package com.team1.trading.api.characterisation;

import app.trustme.TrustMe;
import com.team1.trading.api.config.VaultEnvironmentPostProcessor;
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
        props.put("spring.sql.init.schema-locations", "classpath:charact-schema.sql");
        return props;
    }

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
                keyFile = "../../../leapcapstoneteam1-720d03.TM";
            }
            String dbName = envOrSystem("CHARACT_DB_NAME", "charact.dbname");
            if (dbName == null) {
                dbName = "trading_charact";
            }

            Path keyPath = Paths.get(keyFile).toAbsolutePath().normalize();
            TrustMe vault = openVault(keyPath);
            Path dotenvPath = VaultEnvironmentPostProcessor.findDotEnv(Paths.get("").toAbsolutePath());
            Map<String, Object> dotenv = dotenvPath == null ? Map.of() : VaultEnvironmentPostProcessor.readDotEnv(dotenvPath);
            String host = secret(vault, dotenv, "PostGres_Host");
            String port = secret(vault, dotenv, "Postgres_Port");
            String user = secret(vault, dotenv, "PostGres_User");
            String password = secret(vault, dotenv, "PostGres");
            if (host == null || port == null || user == null || password == null) {
                throw new IllegalArgumentException(
                        "PostgreSQL credentials are not available from the TrustMe key file (" + keyPath
                                + ") or from POSTGRES_HOST/POSTGRES_PORT/POSTGRES_USER/POSTGRES_PASSWORD in the environment or .env.");
            }
            return new DbSettings(host.trim(), port.trim(), user.trim(), password, dbName);
        }

        private static TrustMe openVault(Path keyPath) {
            if (!Files.isRegularFile(keyPath)) {
                return null;
            }
            try {
                return VaultEnvironmentPostProcessor.openVault(keyPath, envOrSystem("TRUSTME_PASSWORD", "trustme.password"));
            } catch (RuntimeException e) {
                return null;
            }
        }

        private static String secret(TrustMe vault, Map<String, Object> dotenv, String name) {
            if (vault != null) {
                try {
                    String value = vault.fetch(name);
                    if (value != null && !value.isBlank()) {
                        return value;
                    }
                } catch (RuntimeException ignored) {
                    // fall back to the environment below
                }
            }
            String envName = VaultEnvironmentPostProcessor.envNameFor(name);
            String value = System.getenv(envName);
            if (value == null || value.isBlank()) {
                Object fromFile = dotenv.get(envName);
                value = fromFile == null ? null : fromFile.toString();
            }
            return value == null || value.isBlank() ? null : value;
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