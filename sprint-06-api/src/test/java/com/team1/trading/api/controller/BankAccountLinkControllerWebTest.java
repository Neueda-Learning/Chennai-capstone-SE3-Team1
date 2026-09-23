package com.team1.trading.api.controller;

import com.team1.trading.api.dto.LinkedBankAccountResponse;
import com.team1.trading.api.exception.BankAccountLinkConflictException;
import com.team1.trading.api.exception.BankAccountLinkConflictException.Reason;
import com.team1.trading.api.security.JwtValidator;
import com.team1.trading.api.security.TestJwtBuilder;
import com.team1.trading.api.service.BankAccountLinkService;
import com.team1.trading.domain.exception.AccountNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code POST /api/v1/bank-accounts} over HTTP, with the real {@code JwtVerificationFilter}
 * in front of it: the route is reachable with a token that has no {@code accountId} yet, and
 * the user it links is the token's {@code sub}, never anything in the body.
 */
@WebMvcTest(controllers = BankAccountLinkController.class)
@Import(JwtValidator.class)
@TestPropertySource(properties = {
    "jwt.secret=" + TestJwtBuilder.TEST_SECRET,
    "jwt.issuer=" + TestJwtBuilder.TEST_ISSUER,
    "spring.datasource.url=jdbc:h2:mem:testdb",
    "spring.datasource.driver-class-name=org.h2.Driver"
})
class BankAccountLinkControllerWebTest {

    private static final String USER_ID = "8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f";
    private static final String BODY = """
            {"accountNumber": "IN45HDFC0000007890123"}
            """;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private BankAccountLinkService bankAccountLinkService;

    private static String unlinkedToken() {
        return TestJwtBuilder.forAccount(null).withSub(USER_ID).buildWithTestSecret();
    }

    @Test
    void links_for_a_registered_user_whose_token_has_no_account_yet() throws Exception {
        given(bankAccountLinkService.link(eq(USER_ID), any())).willReturn(new LinkedBankAccountResponse(
                42L, "IN45HDFC0000007890123", "HDFC Bank", "HDFC0007890", "ACTIVE"));

        mockMvc.perform(post("/api/v1/bank-accounts")
                        .header("Authorization", unlinkedToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accountId").value(42))
                .andExpect(jsonPath("$.accountNumber").value("IN45HDFC0000007890123"))
                .andExpect(jsonPath("$.accountState").value("ACTIVE"));

        verify(bankAccountLinkService).link(eq(USER_ID), any());
    }

    @Test
    void requires_a_token() throws Exception {
        mockMvc.perform(post("/api/v1/bank-accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH-401"));

        verifyNoInteractions(bankAccountLinkService);
    }

    @Test
    void rejects_a_malformed_account_number_with_val_422() throws Exception {
        mockMvc.perform(post("/api/v1/bank-accounts")
                        .header("Authorization", unlinkedToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.replace("IN45HDFC0000007890123", "in45-not valid")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode").value("VAL-422"));

        verifyNoInteractions(bankAccountLinkService);
    }

    @Test
    void an_unknown_account_number_is_acc_404() throws Exception {
        given(bankAccountLinkService.link(eq(USER_ID), any())).willThrow(new AccountNotFoundException(null));

        mockMvc.perform(post("/api/v1/bank-accounts")
                        .header("Authorization", unlinkedToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode").value("ACC-404"));
    }

    @Test
    void a_second_link_is_acc_409_with_the_catalogued_message() throws Exception {
        given(bankAccountLinkService.link(eq(USER_ID), any()))
                .willThrow(new BankAccountLinkConflictException(Reason.USER_ALREADY_LINKED));

        mockMvc.perform(post("/api/v1/bank-accounts")
                        .header("Authorization", unlinkedToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.errorCode").value("ACC-409"))
                .andExpect(jsonPath("$.message").value("Bank account could not be linked"));
    }
}
