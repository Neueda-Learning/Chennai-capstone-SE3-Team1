package com.team1.trading.api.controller;

import com.team1.trading.api.dto.OrderResponse;
import com.team1.trading.api.dto.OrderStatusResponse;
import com.team1.trading.api.security.TokenAccountIdResolver;
import com.team1.trading.api.service.OrderService;
import com.team1.trading.domain.dto.PlaceOrderRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    private final OrderService orderService;
    private final TokenAccountIdResolver tokenAccountIdResolver;

    public OrderController(OrderService orderService, TokenAccountIdResolver tokenAccountIdResolver) {
        this.orderService = orderService;
        this.tokenAccountIdResolver = tokenAccountIdResolver;
    }

    @PostMapping
    public ResponseEntity<OrderResponse> placeOrder(@Valid @RequestBody PlaceOrderRequest request,
                                                    @RequestHeader(value = "Authorization", required = false)
                                                    String authorization) {
        return ResponseEntity.ok(orderService.placeOrder(request, tokenAccountIdResolver.resolve(authorization)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<OrderStatusResponse> getOrder(@PathVariable("id") String id,
                                                        @RequestHeader(value = "Authorization", required = false)
                                                        String authorization) {
        return ResponseEntity.ok(orderService.getOrder(id.trim(), tokenAccountIdResolver.resolve(authorization)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<OrderResponse> cancelOrder(@PathVariable("id") String id,
                                                     @RequestHeader(value = "Authorization", required = false)
                                                     String authorization) {
        return ResponseEntity.ok(orderService.cancel(id.trim(), tokenAccountIdResolver.resolve(authorization)));
    }
}