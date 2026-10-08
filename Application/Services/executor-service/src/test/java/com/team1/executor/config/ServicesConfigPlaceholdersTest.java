package com.team1.executor.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.logging.DeferredLogs;
import org.springframework.core.env.PropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("application.yml reads its port and Kafka address from Application/Config/services.env")
class ServicesConfigPlaceholdersTest {

    @Test
    @DisplayName("server.port and the Kafka bootstrap servers resolve to the values in services.env")
    void applicationYmlResolvesAgainstTheRealConfig() throws Exception {
        Path configFile = VaultEnvironmentPostProcessor.findServicesConfig(Path.of("").toAbsolutePath(), null);
        assertThat(configFile).as("Application/Config/services.env above the working directory").isNotNull();
        Map<String, Object> config = VaultEnvironmentPostProcessor.readDotEnv(configFile);

        StandardEnvironment env = new StandardEnvironment();
        new VaultEnvironmentPostProcessor(new DeferredLogs()).postProcessEnvironment(env, new SpringApplication());
        List<PropertySource<?>> yml = new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml"));
        yml.forEach(source -> env.getPropertySources().addFirst(source));

        assertThat(env.getProperty("server.port")).isEqualTo(config.get("EXECUTOR_PORT").toString());
        assertThat(env.getProperty("spring.kafka.bootstrap-servers"))
                .isEqualTo(config.get("KAFKA_HOST") + ":" + config.get("KAFKA_PORT"));
    }
}
