package com.team1.trading.api.preferences;

import com.team1.trading.api.preferences.PreferenceMapper.ResolutionRow;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class DatabasePreferenceResolver implements PreferenceResolver {

    private final PreferenceMapper mapper;

    public DatabasePreferenceResolver(PreferenceMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public Optional<ResolvedChannel> resolve(long accountId) {
        Optional<ResolutionRow> found;
        try {
            found = mapper.findForResolution(accountId);
        } catch (DataAccessException e) {
            throw new PreferenceResolutionException("preference read failed", e);
        }
        if (found.isEmpty()) {
            return Optional.empty();
        }
        ResolutionRow row = found.get();
        if (row.getChannel() == null) {
            return Optional.empty();
        }
        if (row.getEmail() == null) {
            throw new PreferenceResolutionException("stored preference has no users row");
        }
        ChannelKind kind = parse(row.getChannel());
        return Optional.of(new ResolvedChannel(kind, "account:" + accountId));
    }

    private static ChannelKind parse(String channel) {
        try {
            return ChannelKind.valueOf(channel);
        } catch (IllegalArgumentException e) {
            throw new PreferenceResolutionException("stored channel is not recognised");
        }
    }
}
