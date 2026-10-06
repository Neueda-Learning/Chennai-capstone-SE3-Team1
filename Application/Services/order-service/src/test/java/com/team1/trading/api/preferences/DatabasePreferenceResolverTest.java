package com.team1.trading.api.preferences;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:preferenceresolver;DB_CLOSE_DELAY=-1")
@Import(DatabasePreferenceResolver.class)
class DatabasePreferenceResolverTest {

    @Autowired
    private PreferenceResolver resolver;

    @Autowired
    private JdbcTemplate jdbc;

    private void store(long accountId, String channel) {
        jdbc.update("INSERT INTO customer_preferences (account_id, default_account_id, channel) VALUES (?, ?, ?)",
                accountId, accountId, channel);
    }

    @Test
    @DisplayName("No preference row resolves to empty, not an exception")
    void noPreferenceRow() {
        assertThat(resolver.resolve(1L)).isEmpty();
    }

    @Test
    @DisplayName("A preference row with a NULL channel resolves to empty")
    void nullChannel() {
        store(1L, null);

        assertThat(resolver.resolve(1L)).isEmpty();
    }

    @Test
    @DisplayName("EMAIL resolves to the address on auth_db.users")
    void emailFromUsers() {
        store(1L, "EMAIL");

        Optional<ResolvedChannel> resolved = resolver.resolve(1L);

        assertThat(resolved).contains(new ResolvedChannel(ChannelKind.EMAIL, "aarav.mehta@example.com"));
    }

    @Test
    @DisplayName("A changed email is used on the very next call, because nothing is cached")
    void changedEmailIsPickedUpImmediately() {
        store(1L, "EMAIL");
        assertThat(resolver.resolve(1L).orElseThrow().address()).isEqualTo("aarav.mehta@example.com");

        jdbc.update("UPDATE users SET email = 'aarav.new@example.com' WHERE account_id = 1");

        assertThat(resolver.resolve(1L).orElseThrow().address()).isEqualTo("aarav.new@example.com");
    }

    @Test
    @DisplayName("PUSH resolves to an in-app address and needs no contact detail")
    void pushNeedsNoContactDetail() {
        store(1L, "PUSH");

        assertThat(resolver.resolve(1L)).contains(new ResolvedChannel(ChannelKind.PUSH, "account:1"));
    }

    @Test
    @DisplayName("channel_contact_override wins over the profile address when set")
    void overrideWins() {
        store(1L, "EMAIL");
        jdbc.update("UPDATE customer_preferences SET channel_contact_override = 'alerts@example.com' WHERE account_id = 1");

        assertThat(resolver.resolve(1L).orElseThrow().address()).isEqualTo("alerts@example.com");
    }

    @Test
    @DisplayName("A stored preference with no users row behind it is a resolution failure")
    void preferenceWithoutUsersRow() {
        store(99L, "EMAIL");

        assertThatThrownBy(() -> resolver.resolve(99L)).isInstanceOf(PreferenceResolutionException.class);
    }
}
