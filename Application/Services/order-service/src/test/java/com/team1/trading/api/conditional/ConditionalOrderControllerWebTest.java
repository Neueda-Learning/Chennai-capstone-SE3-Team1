package com.team1.trading.api.conditional;

import com.team1.trading.api.controller.OrderController;
import com.team1.trading.api.dto.ConditionalOrderRequest;
import com.team1.trading.api.dto.OrderResponse;
import com.team1.trading.api.dto.OrderStatusResponse;
import com.team1.trading.api.security.AccessGuard;
import com.team1.trading.api.security.HeaderTokenAccountIdResolver;
import com.team1.trading.api.security.JwtClaims;
import com.team1.trading.api.security.JwtRequestContext;
import com.team1.trading.api.security.JwtVerificationFilter;
import com.team1.trading.api.service.OrderService;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import com.team1.trading.domain.exception.AccountNotActiveException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = {ConditionalOrderController.class, OrderController.class},
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtVerificationFilter.class))
@Import({AccessGuard.class, HeaderTokenAccountIdResolver.class})
@TestPropertySource(properties = {
        "jwt.secret=test-secret-key",
        "jwt.issuer=auth-service",
        "spring.datasource.url=jdbc:h2:mem:conditionalweb;DB_CLOSE_DELAY=-1"
})
class ConditionalOrderControllerWebTest {

    private static final String BODY = """
            {"accountId":1,"symbol":"TCS","side":"BUY","quantity":2,"price":3650.00,
             "idempotencyKey":"cond-key-0001",
             "condition":{"type":"PRICE_AT_OR_BELOW","triggerPrice":3500.00},"expiresInDays":10}""";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private OrderService orders;
    @MockitoBean
    private ConditionalOrderQueries queries;

    @AfterEach
    void clearContext() {
        JwtRequestContext.clear();
    }

    private static String bearer(long accountId) {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String header = encoder.encodeToString("{\"alg\":\"HS256\"}".getBytes(StandardCharsets.UTF_8));
        String claims = encoder.encodeToString(("{\"accountId\":" + accountId + "}").getBytes(StandardCharsets.UTF_8));
        return "Bearer " + header + "." + claims + ".signature";
    }

    private static void signedInAs(long accountId) {
        JwtRequestContext.setClaims(new JwtClaims("user-" + accountId, accountId, List.of("CUSTOMER"),
                Instant.now(), Instant.now().plusSeconds(900), "auth-service"));
    }

    @Test
    @DisplayName("POST a conditional order passes the body and the token's account to the service and answers 201 PENDING")
    void place() throws Exception {
        given(orders.placeConditionalOrder(any(), eq(1L))).willReturn(new OrderResponse("ORD-1", OrderStatus.PENDING,
                "Held until the price falls to 3500.00 or lower", "TCS", OrderSide.BUY, 2, new BigDecimal("3650.00")));

        mockMvc.perform(post("/api/v1/orders/conditional").header("Authorization", bearer(1))
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("PENDING")));

        ArgumentCaptor<ConditionalOrderRequest> request = ArgumentCaptor.forClass(ConditionalOrderRequest.class);
        verify(orders).placeConditionalOrder(request.capture(), eq(1L));
        assertThat(request.getValue().getCondition().triggerPrice()).isEqualByComparingTo("3500.00");
        assertThat(request.getValue().expiryDays()).isEqualTo(10);
    }

    @Test
    @DisplayName("A missing condition, a bad type, too long an expiry or an unknown field is VAL-422")
    void validation() throws Exception {
        for (String body : List.of(
                BODY.replace(",\n \"condition\":{\"type\":\"PRICE_AT_OR_BELOW\",\"triggerPrice\":3500.00}", ""),
                BODY.replace("PRICE_AT_OR_BELOW", "WHEN_I_FEEL_LIKE_IT"),
                BODY.replace("\"expiresInDays\":10", "\"expiresInDays\":365"),
                BODY.replace("\"expiresInDays\":10", "\"expiresInDays\":10,\"status\":\"NEW\""))) {
            mockMvc.perform(post("/api/v1/orders/conditional").header("Authorization", bearer(1))
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        }
        verifyNoInteractions(orders);
    }

    @Test
    @DisplayName("A refusal from the service keeps its code: another account in the body is ACC-403")
    void anotherAccount() throws Exception {
        given(orders.placeConditionalOrder(any(), eq(2L))).willThrow(new AccountNotActiveException(1L, "TOKEN"));

        mockMvc.perform(post("/api/v1/orders/conditional").header("Authorization", bearer(2))
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
    }

    @Test
    @DisplayName("The waiting list is the owner's only")
    void pendingList() throws Exception {
        signedInAs(1L);
        given(queries.pending(1L)).willReturn(List.of());
        mockMvc.perform(get("/api/v1/accounts/1/conditional-orders")).andExpect(status().isOk());

        signedInAs(2L);
        mockMvc.perform(get("/api/v1/accounts/1/conditional-orders"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
    }

    @Test
    @DisplayName("GET an order answers its status and condition with the token's account")
    void orderStatus() throws Exception {
        given(orders.getOrder("ORD-abc", 1L)).willReturn(new OrderStatusResponse("ORD-abc", 1L, "TCS", OrderSide.BUY,
                2, new BigDecimal("3650.00"), null, OrderStatus.PENDING, null, LocalDateTime.of(2026, 10, 7, 9, 0),
                new OrderStatusResponse.ConditionView("PRICE_AT_OR_BELOW", "when the price falls to 3500.00 or lower",
                        new BigDecimal("3500.00"), null, null, null, null, LocalDateTime.of(2026, 11, 6, 9, 0),
                        null, null, null)));

        mockMvc.perform(get("/api/v1/orders/ORD-abc").header("Authorization", bearer(1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("PENDING")))
                .andExpect(jsonPath("$.condition.description", is("when the price falls to 3500.00 or lower")));
    }
}
