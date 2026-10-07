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
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:preferencesctx;DB_CLOSE_DELAY=-1")
@Import({PreferenceService.class})
class PreferenceServiceTest {

    @Autowired
    private PreferenceService service;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("Nothing stored yet reads as PRF-404")
    void readBeforeAnythingIsStored() {
        assertThatThrownBy(() -> service.get(1L))
                .isInstanceOf(PreferencesNotFoundException.class)
                .hasFieldOrPropertyWithValue("code", "PRF-404");
    }

    @Test
    @DisplayName("A saved preference reads back, and the row is in customer_preferences")
    void saveThenReadBack() {
        PreferencesResponse saved = service.put(1L, new PreferencesRequest(1L, ChannelKind.PUSH));

        assertThat(saved.accountId()).isEqualTo(1L);
        assertThat(saved.defaultAccountId()).isEqualTo(1L);
        assertThat(saved.channel()).isEqualTo(ChannelKind.PUSH);
        assertThat(saved.updatedAt()).isNotNull();
        assertThat(service.get(1L)).isEqualTo(saved);

        String stored = jdbc.queryForObject(
                "SELECT channel FROM customer_preferences WHERE account_id = 1", String.class);
        assertThat(stored).isEqualTo("PUSH");
    }

    @Test
    @DisplayName("A second PUT replaces the first and leaves one row")
    void putReplaces() {
        service.put(1L, new PreferencesRequest(1L, ChannelKind.PUSH));
        service.put(1L, new PreferencesRequest(1L, ChannelKind.PUSH));

        assertThat(service.get(1L).channel()).isEqualTo(ChannelKind.PUSH);
        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM customer_preferences WHERE account_id = 1", Integer.class);
        assertThat(rows).isEqualTo(1);
    }

    @Test
    @DisplayName("A default account that is not the customer's own is PRF-422 and nothing is written")
    void defaultAccountMustBeOwn() {
        assertThatThrownBy(() -> service.put(1L, new PreferencesRequest(2L, ChannelKind.PUSH)))
                .isInstanceOf(PreferencesInvalidException.class)
                .hasFieldOrPropertyWithValue("code", "PRF-422");

        Integer rows = jdbc.queryForObject("SELECT COUNT(*) FROM customer_preferences", Integer.class);
        assertThat(rows).isZero();
    }

    @Test
    @DisplayName("One customer's preference is not visible under another account")
    void preferencesAreKeyedByAccount() {
        service.put(1L, new PreferencesRequest(1L, ChannelKind.PUSH));

        assertThatThrownBy(() -> service.get(2L)).isInstanceOf(PreferencesNotFoundException.class);
    }
}
