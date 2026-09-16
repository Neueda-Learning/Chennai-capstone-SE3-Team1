package com.team1.executor.mapper;

import com.team1.executor.model.AccountRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.math.BigDecimal;
import java.util.Optional;

@Mapper
public interface AccountMapper {

    Optional<AccountRow> findByClientId(Long clientId);

    Optional<AccountRow> findByClientIdForUpdate(Long clientId);

    int updateWalletBalanceGuarded(
            @Param("clientId") Long clientId,
            @Param("cashDelta") BigDecimal cashDelta,
            @Param("expectedVersion") Integer expectedVersion
    );
}