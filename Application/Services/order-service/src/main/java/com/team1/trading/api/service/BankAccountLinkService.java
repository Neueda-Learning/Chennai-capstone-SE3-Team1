package com.team1.trading.api.service;

import com.team1.trading.api.dto.LinkBankAccountRequest;
import com.team1.trading.api.dto.LinkedBankAccountResponse;
import com.team1.trading.api.exception.BankAccountLinkConflictException;
import com.team1.trading.api.exception.BankAccountLinkConflictException.Reason;
import com.team1.trading.api.mapper.BankAccountMapper;
import com.team1.trading.api.mapper.ClientMapper;
import com.team1.trading.api.mapper.UserMapper;
import com.team1.trading.api.mapper.UserMapper.UserRow;
import com.team1.trading.api.security.JwtAuthenticationException;
import com.team1.trading.domain.entity.BankAccount;
import com.team1.trading.domain.entity.Client;
import com.team1.trading.domain.exception.AccountNotFoundException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BankAccountLinkService {

    private final UserMapper userMapper;
    private final ClientMapper clientMapper;
    private final BankAccountMapper bankAccountMapper;

    public BankAccountLinkService(UserMapper userMapper, ClientMapper clientMapper,
                                  BankAccountMapper bankAccountMapper) {
        this.userMapper = userMapper;
        this.clientMapper = clientMapper;
        this.bankAccountMapper = bankAccountMapper;
    }

    @Transactional
    public LinkedBankAccountResponse link(String userId, LinkBankAccountRequest request) {
        UserRow user = userMapper.findForUpdate(userId)
                .orElseThrow(() -> new JwtAuthenticationException("token subject has no users row"));
        if (user.getAccountId() != null) {
            throw new BankAccountLinkConflictException(Reason.USER_ALREADY_LINKED);
        }

        String accountNumber = request.getAccountNumber();
        BankAccount bankAccount = bankAccountMapper.findByAccountNumberForUpdate(accountNumber)
                .orElseThrow(() -> new AccountNotFoundException(null));
        if (bankAccount.isClaimed()) {
            throw new BankAccountLinkConflictException(Reason.ACCOUNT_ALREADY_CLAIMED);
        }

        Client client = new Client(null, user.getUsername());
        try {
            clientMapper.save(client);
        } catch (DuplicateKeyException e) {
            throw new BankAccountLinkConflictException(Reason.ALREADY_ON_FILE);
        }
        Long clientId = client.getClientId();

        if (bankAccountMapper.claim(accountNumber, clientId) == 0) {
            throw new BankAccountLinkConflictException(Reason.ACCOUNT_ALREADY_CLAIMED);
        }
        if (userMapper.linkAccount(userId, clientId) == 0) {
            throw new BankAccountLinkConflictException(Reason.USER_ALREADY_LINKED);
        }

        return new LinkedBankAccountResponse(clientId, bankAccount.getAccountNumber(),
                bankAccount.getBankName(), bankAccount.getIfscCode(), client.getAccountState());
    }
}
