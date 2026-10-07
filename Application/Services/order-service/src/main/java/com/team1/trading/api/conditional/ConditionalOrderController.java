package com.team1.trading.api.conditional;

import com.team1.trading.api.dto.ConditionalOrderRequest;
import com.team1.trading.api.dto.OrderResponse;
import com.team1.trading.api.security.AccessGuard;
import com.team1.trading.api.security.TokenAccountIdResolver;
import com.team1.trading.api.service.OrderService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class ConditionalOrderController {

    private final OrderService orders;
    private final ConditionalOrderQueries queries;
    private final TokenAccountIdResolver tokenAccountIdResolver;
    private final AccessGuard accessGuard;

    public ConditionalOrderController(OrderService orders, ConditionalOrderQueries queries,
                                      TokenAccountIdResolver tokenAccountIdResolver, AccessGuard accessGuard) {
        this.orders = orders;
        this.queries = queries;
        this.tokenAccountIdResolver = tokenAccountIdResolver;
        this.accessGuard = accessGuard;
    }

    /** Same checks and the same token rule as POST /api/v1/orders; the order is held as PENDING. */
    @PostMapping("/api/v1/orders/conditional")
    public ResponseEntity<OrderResponse> place(@Valid @RequestBody ConditionalOrderRequest request,
                                               @RequestHeader(value = "Authorization", required = false)
                                               String authorization) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(orders.placeConditionalOrder(request, tokenAccountIdResolver.resolve(authorization)));
    }

    @GetMapping("/api/v1/accounts/{accountId}/conditional-orders")
    public ResponseEntity<List<PendingOrderResponse>> pending(@PathVariable("accountId") Long accountId) {
        accessGuard.requireOwner(accountId);
        return ResponseEntity.ok(queries.pending(accountId));
    }
}
