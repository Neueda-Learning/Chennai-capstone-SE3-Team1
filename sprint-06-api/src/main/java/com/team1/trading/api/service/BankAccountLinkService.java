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

/**
 * Second step of onboarding: a registered user claims an existing bank account, which is what
 * gives them a trading account.
 *
 * <p>Bank accounts exist before anyone owns them (migration 017: {@code client_id} NULL means
 * unclaimed; migrations 019 and 020 dropped its phone/email/name columns, so it carries no
 * identity of its own beyond {@code client_id}). Registration (the auth service) creates only a
 * {@code users} row with a null {@code account_id}. This service, in one transaction, creates the
 * {@code clients} row from the claiming user's username and email, claims the bank account for it
 * and points {@code users.account_id} at the new client, so a failure part-way leaves the user and
 * the bank account exactly as they were.
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

        String accountNumber = request.getAccountNumber();
        BankAccount bankAccount = bankAccountMapper.findByAccountNumberForUpdate(accountNumber)
                .orElseThrow(() -> new AccountNotFoundException(null));
        if (bankAccount.isClaimed()) {
            throw new BankAccountLinkConflictException(Reason.ACCOUNT_ALREADY_CLAIMED);
        }

        // The bank account carries no name; the new client is named from the claiming user's
        // username instead, and its email is the user's, which is unique. Phone starts null;
        // the client sets it themselves via their profile.
        Client client = new Client(null, user.getUsername(), user.getEmail(), null);
        try {
            clientMapper.save(client);
        } catch (DuplicateKeyException e) {
            throw new BankAccountLinkConflictException(Reason.ALREADY_ON_FILE);
        }
        Long clientId = client.getClientId();

        // Guarded on client_id IS NULL; unreachable while the row lock above holds, kept so the
        // claim never fails open.
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
