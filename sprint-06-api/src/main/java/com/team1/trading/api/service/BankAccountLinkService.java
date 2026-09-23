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
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Second step of onboarding: a registered user links a bank account, which is what gives them a
 * trading account.
 *
 * <p>Registration (the auth service) creates only a {@code users} row with a null
 * {@code account_id}. This service creates the {@code clients} row, then the {@code bank_account}
 * row that names it, and points {@code users.account_id} at the new client, all in one
 * transaction, so a failure part-way leaves the user exactly as unlinked as before.
 */
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

    /**
     * @param userId the verified token's {@code sub}; never taken from the request body
     */
    @Transactional
    public LinkedBankAccountResponse link(String userId, LinkBankAccountRequest request) {
        // A valid token for a user that no longer exists is as good as no token.
        UserRow user = userMapper.findForUpdate(userId)
                .orElseThrow(() -> new JwtAuthenticationException("token subject has no users row"));
        if (user.getAccountId() != null) {
            throw new BankAccountLinkConflictException(Reason.USER_ALREADY_LINKED);
        }

        Client client = new Client(null, request.getAccountHolderName(), user.getEmail(),
                request.getPhone());
        BankAccount bankAccount;
        // clients first: bank_account.client_id is a foreign key to the row it creates.
        try {
            clientMapper.save(client);
            bankAccount = new BankAccount(client.getClientId(), request.getAccountNumber(),
                    request.getAccountHolderName(), request.getPhone(), user.getEmail(),
                    request.getBankName(), request.getIfscCode());
            bankAccountMapper.save(bankAccount);
        } catch (DuplicateKeyException e) {
            throw new BankAccountLinkConflictException(Reason.ALREADY_ON_FILE);
        }
        Long clientId = client.getClientId();

        if (userMapper.linkAccount(userId, clientId) == 0) {
            // Unreachable while the row lock above holds; kept so the guard never fails open.
            throw new BankAccountLinkConflictException(Reason.USER_ALREADY_LINKED);
        }

        return new LinkedBankAccountResponse(clientId, bankAccount.getAccountNumber(),
                bankAccount.getBankName(), bankAccount.getIfscCode(), client.getAccountState());
    }
}
