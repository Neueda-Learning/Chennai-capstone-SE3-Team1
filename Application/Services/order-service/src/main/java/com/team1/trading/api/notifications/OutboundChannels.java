package com.team1.trading.api.notifications;

import com.team1.trading.api.preferences.ChannelKind;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

import java.util.regex.Pattern;

@Component
public class OutboundChannels implements ChannelSender {

    static final Pattern EMAIL_ADDRESS = Pattern.compile("^[^\s@<>,;\"]+@[^\s@<>,;\"]+$");

    private static final Logger log = LoggerFactory.getLogger(OutboundChannels.class);

    private final JavaMailSender mailSender;
    private final String from;

    @Autowired
    public OutboundChannels(ObjectProvider<SmtpSettings> settings) {
        SmtpSettings smtp = settings.getIfAvailable();
        if (smtp == null) {
            this.mailSender = null;
            this.from = null;
            log.warn("[notifications] SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM are not all in the vault; email notifications will be recorded as FAILED");
        } else {
            this.mailSender = smtp.createSender();
            this.from = smtp.from();
        }
    }

    OutboundChannels(JavaMailSender mailSender, String from) {
        this.mailSender = mailSender;
        this.from = from;
    }

    @Override
    public void send(ChannelKind kind, String address, String subject, String body) {
        switch (kind) {
            case EMAIL -> sendEmail(address, subject, body);
            case PUSH -> log.debug("Push message for the in-app inbox recorded");
        }
    }

    private void sendEmail(String address, String subject, String body) {
        if (address == null || !EMAIL_ADDRESS.matcher(address).matches()) {
            throw new ChannelDeliveryException("INVALID_ADDRESS");
        }
        if (mailSender == null) {
            throw new ChannelDeliveryException("EMAIL_NOT_CONFIGURED");
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(address);
        message.setSubject(subject);
        message.setText(body);
        try {
            mailSender.send(message);
        } catch (MailException e) {
            throw new ChannelDeliveryException("EMAIL_REFUSED", e);
        }
    }
}
