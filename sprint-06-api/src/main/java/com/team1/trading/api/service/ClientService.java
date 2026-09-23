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

    public Client createClient(String name, String email, String phone) {
        Client client = new Client(null, name, email, phone);
        clientMapper.save(client);
        return client;
    }

    /**
     * Updates the client's contact details and, in the same transaction, the email of the user
     * who owns this client, so the two never disagree. The email is stored the way registration
     * stores it: trimmed and lower-cased.
     */
    @Transactional
    public boolean updateClientProfile(Long clientId, String name, String email, String phone) {
        String normalisedEmail = email.trim().toLowerCase(Locale.ROOT);
        Client client = new Client(clientId, name, normalisedEmail, phone);
        try {
            if (clientMapper.updateProfile(client) == 0) {
                return false;
            }
            // 0 rows is fine: a client an admin created outside onboarding has no user.
            userMapper.updateEmailForAccount(clientId, normalisedEmail);
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
