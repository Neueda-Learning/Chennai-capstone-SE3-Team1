package com.team1.trading.api.service;

import com.team1.trading.domain.entity.Client;
import com.team1.trading.api.exception.EmailInUseException;
import com.team1.trading.api.mapper.ClientMapper;
import com.team1.trading.api.mapper.UserMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

@Service
public class ClientService {

    private final ClientMapper clientMapper;
    private final UserMapper userMapper;

    public ClientService(ClientMapper clientMapper, UserMapper userMapper) {
        this.clientMapper = clientMapper;
        this.userMapper = userMapper;
    }

    public Optional<Client> getClientById(Long clientId) {

        return clientMapper.findById(clientId);
    }

    public List<Client> getAllClients() {

        return clientMapper.findAll();
    }

    public Optional<Client> getClientByAccountNumber(String accountNumber) {
        return clientMapper.findByAccountNumber(accountNumber);
    }

    /**
     * Email and phone live only on auth_db.users (migration 021) - clients carries neither.
     * Every current client has one (created only via bank-account linking, which always creates
     * the user first); empty only for data pre-dating that migration.
     */
    public Optional<UserMapper.ContactRow> getContactByClientId(Long clientId) {
        return userMapper.findContactByAccountId(clientId);
    }

    /**
     * Updates the client's name and, in the same transaction, the email/phone of the user who
     * owns this client - the only place either is stored. The email is stored the way
     * registration stores it: trimmed and lower-cased.
     */
    @Transactional
    public boolean updateClientProfile(Long clientId, String name, String email, String phone) {
        String normalisedEmail = email.trim().toLowerCase(Locale.ROOT);
        Client client = new Client(clientId, name);
        try {
            if (clientMapper.updateProfile(client) == 0) {
                return false;
            }
            // 0 rows is fine: a client from data pre-dating migration 021 may have no user.
            userMapper.updateContact(clientId, normalisedEmail, phone);
        } catch (DuplicateKeyException e) {
            throw new EmailInUseException(clientId);
        }
        return true;
    }

    public boolean activateClient(Long clientId) {
        return clientMapper.updateAccountState(clientId, "ACTIVE") > 0;
    }

    public boolean suspendClient(Long clientId) {
        return clientMapper.updateAccountState(clientId, "SUSPENDED") > 0;
    }

    public boolean closeClient(Long clientId) {
        return clientMapper.updateAccountState(clientId, "CLOSED") > 0;
    }
}
