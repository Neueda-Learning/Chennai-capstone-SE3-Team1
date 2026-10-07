package com.team1.executor.config;

import app.trustme.TrustMe;
import org.apache.commons.logging.Log;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.boot.logging.DeferredLogFactory;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.PropertySource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Resolves {@code ${trustme.secret.NAME}}: the TrustMe vault first, then an environment variable,
 * then the repository's {@code .env} file. The vault is opened only when its key file exists and a
 * password is supplied ({@code -Dtrustme.password}, {@code -Dtrustme.password-file}, {@code TRUSTME_PASSWORD}
 * or {@code TRUSTME_PASSWORD_FILE}) or this machine already remembers the key. It never prompts, so a
 * machine without the vault starts from {@code .env} instead of waiting on the console. {@code trustme.enabled=false} (the test
 * profile) skips both the vault and {@code .env}.
 */
public class VaultEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    static final String PREFIX = "trustme.secret.";

    /** Vault secret name to the environment variable that stands in for it. */
    static final Map<String, String> ENV_NAMES = Map.of(
            "JWT_SECRET", "JWT_SECRET",
            "PostGres_Host", "POSTGRES_HOST",
            "Postgres_Port", "POSTGRES_PORT",
            "Postgres_DB", "POSTGRES_DB",
            "PostGres_User", "POSTGRES_USER",
            "PostGres", "POSTGRES_PASSWORD",
            "Fauxnance", "FAUXNANCE_API_KEY",
            "Fauxnance_Endpoint", "FAUXNANCE_BASE_URL",
            "AUTH_PRIVATE_KEY", "AUTH_PRIVATE_KEY");

    private static final int DOTENV_SEARCH_DEPTH = 5;

    private final Log log;

    public VaultEnvironmentPostProcessor(DeferredLogFactory logFactory) {
        this.log = logFactory.getLog(VaultEnvironmentPostProcessor.class);
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE;
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        boolean enabled = environment.getProperty("trustme.enabled", Boolean.class, true);
        if (enabled) {
            Path dotenv = findDotEnv(Paths.get("").toAbsolutePath());
            if (dotenv != null) {
                environment.getPropertySources().addLast(new MapPropertySource("dotenv", readDotEnv(dotenv)));
                log.info("Read fallback settings from " + dotenv);
            }
        }
        TrustMe vault = enabled ? openVault(environment) : null;
        environment.getPropertySources().addLast(new SecretSource(vault, environment, log));
    }

    public static String envNameFor(String secret) {
        return ENV_NAMES.getOrDefault(secret, secret.toUpperCase(Locale.ROOT));
    }

    private TrustMe openVault(ConfigurableEnvironment environment) {
        String keyFile = firstNonBlank(environment.getProperty("trustme.key-file"), environment.getProperty("TRUSTME_KEY_FILE"));
        if (keyFile == null) {
            log.info("No TrustMe key file configured; secrets come from environment variables and .env");
            return null;
        }
        Path keyPath = Paths.get(keyFile.trim()).toAbsolutePath().normalize();
        if (!Files.isRegularFile(keyPath)) {
            log.info("TrustMe key file " + keyPath + " not found; secrets come from environment variables and .env");
            return null;
        }
        try {
            String password = firstNonBlank(System.getProperty("trustme.password"), environment.getProperty("TRUSTME_PASSWORD"));
            String passwordFile = firstNonBlank(System.getProperty("trustme.password-file"), environment.getProperty("TRUSTME_PASSWORD_FILE"));
            if (password == null && passwordFile != null) {
                password = Files.readString(Paths.get(passwordFile.trim()), StandardCharsets.UTF_8).strip();
            }
            TrustMe vault = openVault(keyPath, password);
            log.info("Secrets come from the TrustMe vault, with environment variables and .env as fallback");
            return vault;
        } catch (IOException | RuntimeException e) {
            log.warn("TrustMe vault could not be opened (" + e.getMessage() + "); secrets come from environment variables and .env");
            return null;
        }
    }

    /**
     * Opens the key file without ever prompting. With no password, a key this machine already
     * remembers still opens it; otherwise the library would ask on the console, so it is pointed at
     * a password file that does not exist and fails at once instead.
     */
    public static TrustMe openVault(Path keyPath, String password) {
        if (password != null && !password.isEmpty()) {
            return TrustMe.using(keyPath, password);
        }
        String previous = System.getProperty("trustme.password-file");
        System.setProperty("trustme.password-file", keyPath.resolveSibling(".no-trustme-password").toString());
        try {
            return TrustMe.using(keyPath);
        } finally {
            if (previous == null) {
                System.clearProperty("trustme.password-file");
            } else {
                System.setProperty("trustme.password-file", previous);
            }
        }
    }

    public static Path findDotEnv(Path start) {
        Path dir = start;
        for (int i = 0; dir != null && i <= DOTENV_SEARCH_DEPTH; i++, dir = dir.getParent()) {
            Path candidate = dir.resolve(".env");
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    public static Map<String, Object> readDotEnv(Path file) {
        Map<String, Object> values = new LinkedHashMap<>();
        List<String> lines;
        try {
            lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return values;
        }
        for (String raw : lines) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            if (line.startsWith("export ")) {
                line = line.substring("export ".length()).strip();
            }
            int eq = line.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            String key = line.substring(0, eq).strip();
            String value = line.substring(eq + 1).strip();
            if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
                value = value.substring(1, value.length() - 1).replace("\\n", "\n");
            } else if (value.length() >= 2 && value.startsWith("'") && value.endsWith("'")) {
                value = value.substring(1, value.length() - 1);
            }
            values.put(key, value);
        }
        return values;
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    static final class SecretSource extends PropertySource<Object> {

        private final TrustMe vault;
        private final ConfigurableEnvironment environment;
        private final Log log;
        private final Map<String, String> resolved = new HashMap<>();

        SecretSource(TrustMe vault, ConfigurableEnvironment environment, Log log) {
            super("trustme-secrets-with-env-fallback", new Object());
            this.vault = vault;
            this.environment = environment;
            this.log = log;
        }

        @Override
        public synchronized Object getProperty(String name) {
            if (name == null || !name.startsWith(PREFIX) || name.length() == PREFIX.length()) {
                return null;
            }
            String secret = name.substring(PREFIX.length());
            if (!resolved.containsKey(secret)) {
                resolved.put(secret, resolve(secret));
            }
            return resolved.get(secret);
        }

        private String resolve(String secret) {
            String envName = envNameFor(secret);
            if (vault != null) {
                try {
                    String value = vault.fetch(secret);
                    if (value != null && !value.isBlank()) {
                        return value;
                    }
                } catch (RuntimeException e) {
                    log.warn("TrustMe secret " + secret + " unavailable (" + e.getMessage() + "); falling back to " + envName);
                }
            }
            String value = environment.getProperty(envName);
            if (value == null || value.isBlank()) {
                log.warn("Secret " + secret + " is not in the vault and " + envName + " is not set in the environment or .env");
                return null;
            }
            return value;
        }
    }
}
