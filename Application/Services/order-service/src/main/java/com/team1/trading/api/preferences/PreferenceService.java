package com.team1.trading.api.preferences;

import com.team1.trading.api.preferences.PreferenceMapper.PreferenceRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PreferenceService {

    private static final Logger log = LoggerFactory.getLogger(PreferenceService.class);

    private final PreferenceMapper mapper;

    public PreferenceService(PreferenceMapper mapper) {
        this.mapper = mapper;
    }

    public PreferencesResponse get(Long accountId) {
        return toResponse(mapper.find(accountId).orElseThrow(PreferencesNotFoundException::new));
    }

    @Transactional
    public PreferencesResponse put(Long accountId, PreferencesRequest request) {
        if (!mapper.findOwnedAccountIds(accountId).contains(request.defaultAccountId())) {
            throw new PreferencesInvalidException("Default account is not one of your accounts");
        }
        String channel = request.channel().name();
        if (mapper.update(accountId, request.defaultAccountId(), channel) == 0) {
            try {
                mapper.insert(accountId, request.defaultAccountId(), channel);
            } catch (DuplicateKeyException raced) {
                mapper.update(accountId, request.defaultAccountId(), channel);
            }
        }
        log.info("[preferences] stored accountId={} channel={}", accountId, channel);
        return get(accountId);
    }

    private static PreferencesResponse toResponse(PreferenceRow row) {
        ChannelKind channel = row.getChannel() == null ? null : ChannelKind.valueOf(row.getChannel());
        return new PreferencesResponse(row.getAccountId(), row.getDefaultAccountId(), channel, row.getUpdatedAt());
    }
}
