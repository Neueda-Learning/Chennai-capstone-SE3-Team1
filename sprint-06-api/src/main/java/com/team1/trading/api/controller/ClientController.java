package com.team1.trading.api.controller;

import com.team1.trading.domain.entity.Client;
import com.team1.trading.api.dto.CreateClientRequest;
import com.team1.trading.api.dto.ClientResponse;
import com.team1.trading.api.security.AccessGuard;
import com.team1.trading.api.service.ClientService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Optional;

/**
 * Pre-v1 client routes. Every one needs a verified token ({@code JwtVerificationFilter}); a
 * customer reaches only their own client, and creating clients, listing them all and changing
 * an account's state are for admins.
 */
@RestController
@RequestMapping("/api/clients")
public class ClientController {

    private final ClientService clientService;
    private final AccessGuard accessGuard;

    public ClientController(ClientService clientService, AccessGuard accessGuard) {
        this.clientService = clientService;
        this.accessGuard = accessGuard;
    }

    /** Admin only: a customer's client is created by linking a bank account. */
    @PostMapping
    public ResponseEntity<ClientResponse> addClient(@Valid @RequestBody CreateClientRequest request) {
        accessGuard.requireAdmin();
        Client client = clientService.createClient(
                request.getName(),
                request.getEmail(),
                request.getPhone()
        );
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(mapToResponse(client));
    }

    @GetMapping("/{clientId}")
    public ResponseEntity<ClientResponse> getClient(@PathVariable Long clientId) {
        accessGuard.requireOwnerOrAdmin(clientId);
        return clientService.getClientById(clientId)
                .map(client -> ResponseEntity.ok(mapToResponse(client)))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping
    public List<ClientResponse> getAllClients() {
        accessGuard.requireAdmin();
        return clientService.getAllClients().stream()
                .map(this::mapToResponse)
                .toList();
    }

    @GetMapping("/account/{accountNumber}")
    public ResponseEntity<ClientResponse> getClientByAccountNumber(@PathVariable String accountNumber) {
        Optional<Client> client = clientService.getClientByAccountNumber(accountNumber);
        accessGuard.requireOwnerOrAdmin(client.map(Client::getClientId));
        return client
                .map(found -> ResponseEntity.ok(mapToResponse(found)))
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{clientId}/profile")
    public ResponseEntity<Void> updateProfile(@PathVariable Long clientId,
                                               @Valid @RequestBody CreateClientRequest request) {
        accessGuard.requireOwnerOrAdmin(clientId);
        boolean updated = clientService.updateClientProfile(
                clientId,
                request.getName(),
                request.getEmail(),
                request.getPhone()
        );
        return updated ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    /** Admin only, like suspend and close: a suspended customer must not lift their own suspension. */
    @PutMapping("/{clientId}/activate")
    public ResponseEntity<Void> activateClient(@PathVariable Long clientId) {
        accessGuard.requireAdmin();
        boolean updated = clientService.activateClient(clientId);
        return updated ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    @PutMapping("/{clientId}/suspend")
    public ResponseEntity<Void> suspendClient(@PathVariable Long clientId) {
        accessGuard.requireAdmin();
        boolean updated = clientService.suspendClient(clientId);
        return updated ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    @PutMapping("/{clientId}/close")
    public ResponseEntity<Void> closeClient(@PathVariable Long clientId) {
        accessGuard.requireAdmin();
        boolean updated = clientService.closeClient(clientId);
        return updated ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }

    private ClientResponse mapToResponse(Client client) {
        return new ClientResponse(
                client.getClientId(),
                client.getName(),
                client.getEmail(),
                client.getPhone(),
                client.getCreatedOn(),
                client.getAccountState(),
                client.getWalletBalance()
        );
    }
}
