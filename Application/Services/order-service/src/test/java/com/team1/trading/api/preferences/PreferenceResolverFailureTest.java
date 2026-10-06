package com.team1.trading.api.preferences;

import com.team1.trading.api.preferences.PreferenceMapper.ResolutionRow;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PreferenceResolverFailureTest {

    private final PreferenceMapper mapper = mock(PreferenceMapper.class);
    private final PreferenceResolver resolver = new DatabasePreferenceResolver(mapper);

    @Test
    @DisplayName("A database failure is a PreferenceResolutionException, not an empty result")
    void databaseFailure() {
        when(mapper.findForResolution(1L)).thenThrow(new DataAccessResourceFailureException("connection refused"));

        assertThatThrownBy(() -> resolver.resolve(1L))
                .isInstanceOf(PreferenceResolutionException.class)
                .hasCauseInstanceOf(DataAccessResourceFailureException.class);
    }

    @Test
    @DisplayName("A stored channel the code does not recognise is a resolution failure")
    void unknownStoredChannel() {
        ResolutionRow row = new ResolutionRow();
        row.setChannel("CARRIER_PIGEON");
        row.setEmail("someone@example.com");
        when(mapper.findForResolution(1L)).thenReturn(Optional.of(row));

        assertThatThrownBy(() -> resolver.resolve(1L)).isInstanceOf(PreferenceResolutionException.class);
    }

    @Test
    @DisplayName("The failure message carries no contact detail")
    void failureMessageHoldsNoAddress() {
        ResolutionRow row = new ResolutionRow();
        row.setChannel("CARRIER_PIGEON");
        row.setEmail("someone@example.com");
        when(mapper.findForResolution(1L)).thenReturn(Optional.of(row));

        assertThatThrownBy(() -> resolver.resolve(1L))
                .satisfies(e -> assertThat(e.getMessage()).doesNotContain("someone@example.com"));
    }
}
