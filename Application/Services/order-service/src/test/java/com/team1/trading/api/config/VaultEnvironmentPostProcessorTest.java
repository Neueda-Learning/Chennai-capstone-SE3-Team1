package com.team1.trading.api.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.logging.DeferredLogs;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class VaultEnvironmentPostProcessorTest {

    private StandardEnvironment environment(Map<String, Object> settings) {
        StandardEnvironment env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("test", settings));
        new VaultEnvironmentPostProcessor(new DeferredLogs()).postProcessEnvironment(env, new SpringApplication());
        return env;
    }

    @Test
    @DisplayName("With no key file, a vault secret resolves from its environment-variable name")
    void secretFallsBackToEnvironment() {
        StandardEnvironment env = environment(Map.of(
                "trustme.key-file", "does-not-exist.TM",
                "POSTGRES_HOST", "db.example",
                "JWT_SECRET", "a-fallback-secret-of-at-least-32-chars"));

        assertThat(env.getProperty("trustme.secret.PostGres_Host")).isEqualTo("db.example");
        assertThat(env.getProperty("trustme.secret.JWT_SECRET")).isEqualTo("a-fallback-secret-of-at-least-32-chars");
    }

    @Test
    @DisplayName("A secret that is in neither place stays unresolved, so a required placeholder still fails")
    void missingSecretIsNull() {
        // A blank value shadows whatever this machine's own .env says, so the test is the same everywhere.
        StandardEnvironment env = environment(Map.of("trustme.key-file", "does-not-exist.TM", "POSTGRES_PASSWORD", ""));

        assertThat(env.getProperty("trustme.secret.PostGres")).isNull();
    }

    @Test
    @DisplayName("Every vault secret has a conventional environment-variable name")
    void envNames() {
        assertThat(VaultEnvironmentPostProcessor.envNameFor("PostGres")).isEqualTo("POSTGRES_PASSWORD");
        assertThat(VaultEnvironmentPostProcessor.envNameFor("Fauxnance_Endpoint")).isEqualTo("FAUXNANCE_BASE_URL");
        assertThat(VaultEnvironmentPostProcessor.envNameFor("Something_New")).isEqualTo("SOMETHING_NEW");
    }

    @Test
    @DisplayName(".env lines are read as KEY=VALUE, ignoring comments, export and surrounding quotes")
    void readsDotEnv(@TempDir Path dir) throws IOException {
        Path file = dir.resolve(".env");
        Files.writeString(file, String.join("\n",
                "# a comment",
                "",
                "POSTGRES_HOST=localhost",
                "export POSTGRES_PORT=5432",
                "POSTGRES_PASSWORD=\"with spaces\"",
                "AUTH_PRIVATE_KEY=\"line1\\nline2\"",
                "FAUXNANCE_API_KEY='single'",
                "EMPTY="));

        Map<String, Object> values = VaultEnvironmentPostProcessor.readDotEnv(file);

        assertThat(values).containsEntry("POSTGRES_HOST", "localhost")
                .containsEntry("POSTGRES_PORT", "5432")
                .containsEntry("POSTGRES_PASSWORD", "with spaces")
                .containsEntry("AUTH_PRIVATE_KEY", "line1\nline2")
                .containsEntry("FAUXNANCE_API_KEY", "single")
                .containsEntry("EMPTY", "")
                .doesNotContainKey("# a comment");
    }

    @Test
    @DisplayName("The nearest .env is found by walking up from the working directory")
    void findsDotEnvUpwards(@TempDir Path dir) throws IOException {
        Path nested = Files.createDirectories(dir.resolve("a").resolve("b"));
        Path file = Files.writeString(dir.resolve(".env"), "X=1");

        assertThat(VaultEnvironmentPostProcessor.findDotEnv(nested)).isEqualTo(file);
    }

    @Test
    @DisplayName("trustme.enabled=false still resolves secrets from real settings, without the vault")
    void disabledStillFallsBack() {
        StandardEnvironment env = environment(Map.of(
                "trustme.enabled", "false",
                "FAUXNANCE_API_KEY", "key-from-env"));

        assertThat(env.getProperty("trustme.secret.Fauxnance")).isEqualTo("key-from-env");
        assertThat(env.getPropertySources().contains("dotenv")).isFalse();
    }

    @Test
    @DisplayName("Service addresses come from services.env, below the environment, and resolve in placeholders")
    void servicesConfigFillsPlaceholders(@TempDir Path dir) throws IOException {
        Path file = Files.writeString(dir.resolve("services.env"),
                "TRADE_API_PORT=8081\nKAFKA_HOST=kafka.example\nKAFKA_PORT=29092\nFRONTEND_PORT=4200\n");
        StandardEnvironment env = environment(Map.of(
                "trustme.key-file", "does-not-exist.TM",
                "SERVICES_CONFIG_FILE", file.toString(),
                "FRONTEND_PORT", "4300"));

        assertThat(env.getProperty("TRADE_API_PORT")).isEqualTo("8081");
        assertThat(env.getProperty("FRONTEND_PORT")).as("the environment overrides the file").isEqualTo("4300");
        assertThat(env.resolvePlaceholders("${KAFKA_BOOTSTRAP_SERVERS:${KAFKA_HOST}:${KAFKA_PORT}}"))
                .isEqualTo("kafka.example:29092");
    }

    @Test
    @DisplayName("services.env is read in the test profile too (trustme.enabled=false): it holds no secrets")
    void servicesConfigIsReadWhenTrustmeIsDisabled(@TempDir Path dir) throws IOException {
        Path file = Files.writeString(dir.resolve("services.env"), "EXECUTOR_PORT=8082\n");
        StandardEnvironment env = environment(Map.of("trustme.enabled", "false", "SERVICES_CONFIG_FILE", file.toString()));

        assertThat(env.getProperty("EXECUTOR_PORT")).isEqualTo("8082");
        assertThat(env.getPropertySources().contains("dotenv")).isFalse();
    }

    @Test
    @DisplayName("The nearest Application/Config/services.env is found by walking up from the working directory")
    void findsServicesConfigUpwards(@TempDir Path dir) throws IOException {
        Path nested = Files.createDirectories(dir.resolve("Application").resolve("Services").resolve("order-service"));
        Path file = Files.writeString(Files.createDirectories(dir.resolve("Application").resolve("Config"))
                .resolve("services.env"), "X=1");

        assertThat(VaultEnvironmentPostProcessor.findServicesConfig(nested, null)).isEqualTo(file);
        assertThat(VaultEnvironmentPostProcessor.findServicesConfig(nested, dir.resolve("missing.env").toString())).isNull();
    }

    @Test
    @DisplayName("The repository's real services.env defines every address the Spring services read")
    void realServicesConfigDefinesTheSpringKeys() {
        Path real = VaultEnvironmentPostProcessor.findServicesConfig(Path.of("").toAbsolutePath(), null);

        assertThat(real).as("Application/Config/services.env above the working directory").isNotNull();
        assertThat(VaultEnvironmentPostProcessor.readDotEnv(real).keySet()).contains(
                "TRADE_API_PORT", "EXECUTOR_PORT", "FRONTEND_HOST", "FRONTEND_PORT", "KAFKA_HOST", "KAFKA_PORT",
                "POSTGRES_HOST", "POSTGRES_PORT", "FAUXNANCE_BASE_URL");
    }

    @Test
    @DisplayName("A database address or market-data URL nothing else holds resolves from services.env behind ${trustme.secret.NAME}")
    void secretsWithAnAddressFallBackToServicesEnv(@TempDir Path dir) throws IOException {
        Path file = Files.writeString(dir.resolve("services.env"),
                "POSTGRES_HOST=db.config.test\nPOSTGRES_PORT=6543\nFAUXNANCE_BASE_URL=https://api.config.test\n");
        // trustme.enabled=false keeps this machine's own .env out of the test.
        StandardEnvironment env = environment(Map.of("trustme.enabled", "false", "SERVICES_CONFIG_FILE", file.toString()));

        assertThat(env.getProperty("trustme.secret.PostGres_Host")).isEqualTo("db.config.test");
        assertThat(env.getProperty("trustme.secret.Postgres_Port")).isEqualTo("6543");
        assertThat(env.getProperty("trustme.secret.Fauxnance_Endpoint")).isEqualTo("https://api.config.test");
    }
}
