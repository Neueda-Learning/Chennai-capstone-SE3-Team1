package com.team1.trading.api.controller;

import com.team1.trading.api.dto.TransferDirection;
import com.team1.trading.api.dto.TransferResponse;
import com.team1.trading.api.exception.TransferException;
import com.team1.trading.api.exception.TransferException.Reason;
import com.team1.trading.api.security.HeaderTokenAccountIdResolver;
import com.team1.trading.api.security.JwtValidator;
import com.team1.trading.api.security.TestJwtBuilder;
import com.team1.trading.api.service.WalletTransferService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code POST /api/v1/accounts/{id}/transfers} over HTTP with the real JWT filter and token
 * reader in front, so the account the service is asked about is the one the token carries.
 */
@WebMvcTest(controllers = WalletTransferController.class)
@Import({JwtValidator.class, HeaderTokenAccountIdResolver.class})
@TestPropertySource(properties = {
    "jwt.secret=" + TestJwtBuilder.TEST_SECRET,
    "jwt.issuer=" + TestJwtBuilder.TEST_ISSUER,
    "spring.datasource.url=jdbc:h2:mem:testdb",
    "spring.datasource.driver-class-name=org.h2.Driver"
})
class WalletTransferControllerWebTest {

    private static final String BODY = """
            {"direction":"BANK_TO_WALLET","amount":250.00,"idempotencyKey":"6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e"}
            """;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private WalletTransferService walletTransferService;

    private static String tokenFor(Long accountId) {
        return TestJwtBuilder.forAccount(accountId).buildWithTestSecret();
    }

    @Test
    void a_transfer_is_201_with_both_balances() throws Exception {
        given(walletTransferService.transfer(eq(7L), eq(7L), any())).willReturn(new TransferResponse(
                "0b1c", 7L, TransferDirection.BANK_TO_WALLET, new BigDecimal("250.00"),
                new BigDecimal("250.00"), new BigDecimal("750.00"), LocalDateTime.of(2026, 9, 23, 10, 0)));

        mockMvc.perform(post("/api/v1/accounts/7/transfers")
                        .header("Authorization", tokenFor(7L))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.direction").value("BANK_TO_WALLET"))
                .andExpect(jsonPath("$.walletBalance").value(250.00))
                .andExpect(jsonPath("$.bankBalance").value(750.00));

        verify(walletTransferService).transfer(eq(7L), eq(7L), any());
    }

    @Test
    void requires_a_token() throws Exception {
        mockMvc.perform(post("/api/v1/accounts/7/transfers")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH-401"));

        verifyNoInteractions(walletTransferService);
    }

    @Test
    void a_zero_amount_is_val_422() throws Exception {
        mockMvc.perform(post("/api/v1/accounts/7/transfers")
                        .header("Authorization", tokenFor(7L))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.replace("250.00", "0")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode").value("VAL-422"));

        verifyNoInteractions(walletTransferService);
    }

    @Test
    void more_than_two_decimal_places_is_val_422() throws Exception {
        mockMvc.perform(post("/api/v1/accounts/7/transfers")
                        .header("Authorization", tokenFor(7L))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.replace("250.00", "10.005")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode").value("VAL-422"));
    }

    @Test
    void an_unknown_direction_is_val_422_not_a_500() throws Exception {
        mockMvc.perform(post("/api/v1/accounts/7/transfers")
                        .header("Authorization", tokenFor(7L))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.replace("BANK_TO_WALLET", "SIDEWAYS")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode").value("VAL-422"))
                .andExpect(jsonPath("$.message").value("Invalid input"));

        verifyNoInteractions(walletTransferService);
    }

    @Test
    void insufficient_funds_is_trf_400() throws Exception {
        given(walletTransferService.transfer(eq(7L), eq(7L), any()))
                .willThrow(new TransferException(Reason.INSUFFICIENT_FUNDS, 7L, "bank balance cannot cover 250.00"));

        mockMvc.perform(post("/api/v1/accounts/7/transfers")
                        .header("Authorization", tokenFor(7L))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("TRF-400"))
                .andExpect(jsonPath("$.message").value("Insufficient funds"));
    }

    @Test
    void a_duplicate_transfer_is_trf_409() throws Exception {
        given(walletTransferService.transfer(eq(7L), eq(7L), any()))
                .willThrow(new TransferException(Reason.DUPLICATE_TRANSFER, 7L, "idempotencyKey=..."));

        mockMvc.perform(post("/api/v1/accounts/7/transfers")
                        .header("Authorization", tokenFor(7L))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.errorCode").value("TRF-409"));
    }
}
