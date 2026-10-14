package com.team1.trading.api.notifications;

import com.team1.trading.api.preferences.ChannelKind;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mail.MailSendException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mock.env.MockEnvironment;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class OutboundChannelsTest {

    @Test
    @DisplayName("An email is sent to the resolved address from the configured sender")
    void emailIsSent() {
        JavaMailSender mail = mock(JavaMailSender.class);
        OutboundChannels channels = new OutboundChannels(mail, "no-reply@trading.test");

        channels.send(ChannelKind.EMAIL, "aarav.mehta@example.com", "Your order was filled", "body");

        var captor = org.mockito.ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mail).send(captor.capture());
        assertThat(captor.getValue().getTo()).containsExactly("aarav.mehta@example.com");
        assertThat(captor.getValue().getFrom()).isEqualTo("no-reply@trading.test");
        assertThat(captor.getValue().getSubject()).isEqualTo("Your order was filled");
    }

    @Test
    @DisplayName("An address that could inject headers or recipients is refused before the mail library sees it")
    void unsafeAddressesRefused() {
        JavaMailSender mail = mock(JavaMailSender.class);
        OutboundChannels channels = new OutboundChannels(mail, "no-reply@trading.test");

        for (String bad : List.of("a@b.com\r\nBcc: victim@x.com", "a@b.com, c@d.com", "a b@c.com", "no-at-sign", "", " ")) {
            assertThatThrownBy(() -> channels.send(ChannelKind.EMAIL, bad, "s", "b"))
                    .isInstanceOf(ChannelDeliveryException.class)
                    .extracting(e -> ((ChannelDeliveryException) e).getCode()).isEqualTo("INVALID_ADDRESS");
        }
        verifyNoInteractions(mail);
    }

    @Test
    @DisplayName("With no mail server configured an email is FAILED-worthy, never reported as sent")
    void emailNotConfigured() {
        OutboundChannels channels = new OutboundChannels(null, null);

        assertThatThrownBy(() -> channels.send(ChannelKind.EMAIL, "a@b.com", "s", "b"))
                .isInstanceOf(ChannelDeliveryException.class)
                .extracting(e -> ((ChannelDeliveryException) e).getCode()).isEqualTo("EMAIL_NOT_CONFIGURED");
    }

    @Test
    @DisplayName("A mail server that refuses the message is EMAIL_REFUSED")
    void mailServerRefuses() {
        JavaMailSender mail = mock(JavaMailSender.class);
        doThrow(new MailSendException("refused")).when(mail).send(any(SimpleMailMessage.class));
        OutboundChannels channels = new OutboundChannels(mail, "no-reply@trading.test");

        assertThatThrownBy(() -> channels.send(ChannelKind.EMAIL, "a@b.com", "s", "b"))
                .isInstanceOf(ChannelDeliveryException.class)
                .extracting(e -> ((ChannelDeliveryException) e).getCode()).isEqualTo("EMAIL_REFUSED");
    }

    @Test
    @DisplayName("PUSH is the in-app inbox and always succeeds")
    void pushAlwaysSucceeds() {
        OutboundChannels channels = new OutboundChannels(null, null);

        assertThatCode(() -> channels.send(ChannelKind.PUSH, "account:1", "s", "b")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("The mail server is the one the auth service uses for OTPs: SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM from the vault, port 587 with required STARTTLS")
    void usesTheSameSmtpSecretsAsTheAuthService() {
        MockEnvironment env = new MockEnvironment()
                .withProperty("trustme.secret.SMTP_HOST", "smtp.example.com")
                .withProperty("trustme.secret.SMTP_USER", "mailer")
                .withProperty("trustme.secret.SMTP_PASS", "s3cret")
                .withProperty("trustme.secret.SMTP_FROM", "Trading <no-reply@example.com>");

        SmtpSettings settings = SmtpSettings.fromVault(env).orElseThrow();

        assertThat(settings.host()).isEqualTo("smtp.example.com");
        assertThat(settings.port()).isEqualTo(587);
        assertThat(settings.from()).isEqualTo("Trading <no-reply@example.com>");
        var sender = settings.createSender();
        assertThat(sender.getJavaMailProperties()).containsEntry("mail.smtp.starttls.required", "true");
        assertThat(sender.getJavaMailProperties()).containsEntry("mail.smtp.auth", "true");
        assertThat(settings.toString()).doesNotContain("s3cret").doesNotContain("mailer");
    }

    @Test
    @DisplayName("Any missing SMTP secret, or a vault that refuses the lookup, means email is not configured")
    void missingSecretMeansNotConfigured() {
        MockEnvironment partial = new MockEnvironment()
                .withProperty("trustme.secret.SMTP_HOST", "smtp.example.com")
                .withProperty("trustme.secret.SMTP_USER", "mailer");
        assertThat(SmtpSettings.fromVault(partial)).isEmpty();

        MockEnvironment broken = new MockEnvironment() {
            @Override
            public String getProperty(String key) {
                throw new IllegalStateException("no such secret");
            }
        };
        assertThat(SmtpSettings.fromVault(broken)).isEmpty();
    }
}
