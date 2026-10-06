package com.team1.trading.api.notifications;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration
public class NotificationMailConfig {

    @Bean
    SmtpSettings smtpSettings(Environment environment) {
        return SmtpSettings.fromVault(environment).orElse(null);
    }
}
