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
        StandardEnvironment env = environment(Map.of("trustme.key-file", "does-not-exist.TM"));

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
}
