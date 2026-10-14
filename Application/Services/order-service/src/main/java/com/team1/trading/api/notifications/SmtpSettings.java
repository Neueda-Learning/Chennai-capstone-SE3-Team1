package com.team1.trading.api.notifications;

import org.springframework.core.env.Environment;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.util.Optional;
import java.util.Properties;

public record SmtpSettings(String host, int port, String user, String password, String from) {

    static final int PORT = 587;
    private static final int TIMEOUT_MS = 10_000;

    static Optional<SmtpSettings> fromVault(Environment env) {
        String host = secret(env, "SMTP_HOST");
        String user = secret(env, "SMTP_USER");
        String password = secret(env, "SMTP_PASS");
        String from = secret(env, "SMTP_FROM");
        if (host.isEmpty() || user.isEmpty() || password.isEmpty() || from.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new SmtpSettings(host, PORT, user, password, from));
    }

    private static String secret(Environment env, String name) {
        try {
            String value = env.getProperty("trustme.secret." + name);
            return value == null ? "" : value;
        } catch (RuntimeException notInVault) {
            return "";
        }
    }

    JavaMailSenderImpl createSender() {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(host);
        sender.setPort(port);
        sender.setUsername(user);
        sender.setPassword(password);
        Properties props = sender.getJavaMailProperties();
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.starttls.required", "true");
        props.put("mail.smtp.connectiontimeout", String.valueOf(TIMEOUT_MS));
        props.put("mail.smtp.timeout", String.valueOf(TIMEOUT_MS));
        props.put("mail.smtp.writetimeout", String.valueOf(TIMEOUT_MS));
        return sender;
    }

    @Override
    public String toString() {
        return "SmtpSettings[host=" + host + ", port=" + port + ", user=***, password=***, from=" + from + "]";
    }
}
