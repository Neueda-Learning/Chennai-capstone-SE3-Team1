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
        String address = addressFor(kind, row, accountId);
        if (address == null || address.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(new ResolvedChannel(kind, address));
    }

    private static ChannelKind parse(String channel) {
        try {
            return ChannelKind.valueOf(channel);
        } catch (IllegalArgumentException e) {
            throw new PreferenceResolutionException("stored channel is not recognised");
        }
    }

    private static String addressFor(ChannelKind kind, ResolutionRow row, long accountId) {
        if (kind == ChannelKind.PUSH) {
            return "account:" + accountId;
        }
        if (row.getContactOverride() != null && !row.getContactOverride().isBlank()) {
            return row.getContactOverride();
        }
        return kind == ChannelKind.EMAIL ? row.getEmail() : row.getPhone();
    }
}
