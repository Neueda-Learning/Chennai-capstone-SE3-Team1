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
    @DisplayName("PUSH resolves to an in-app address and needs no contact detail")
    void pushNeedsNoContactDetail() {
        store(1L, "PUSH");

        assertThat(resolver.resolve(1L)).contains(new ResolvedChannel(ChannelKind.PUSH, "account:1"));
    }

    @Test
    @DisplayName("A stored preference with no users row behind it is a resolution failure")
    void preferenceWithoutUsersRow() {
        store(99L, "PUSH");

        assertThatThrownBy(() -> resolver.resolve(99L)).isInstanceOf(PreferenceResolutionException.class);
    }
}
