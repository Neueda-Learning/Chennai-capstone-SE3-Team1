package com.team1.trading.api.controller;

import com.team1.trading.api.security.TestJwtBuilder;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Who may use the pre-v1 {@code /api/clients} and {@code /api/bank-accounts} routes, end to end:
 * real filter, guard, controllers, services and mappers over the H2 test data, where client 1
 * (Aarav) owns bank account IN45HDFC0000001234567 and client 2 (Diya) owns IN45ICIC0000002345678.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "jwt.secret=" + TestJwtBuilder.TEST_SECRET,
        "jwt.issuer=" + TestJwtBuilder.TEST_ISSUER,
        "spring.datasource.url=jdbc:h2:mem:legacyaccess;DB_CLOSE_DELAY=-1"
})
class LegacyRoutesAccessTest {

    private static final String AARAV_ACCOUNT = "IN45HDFC0000001234567";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    private static String customer(long accountId) {
        return TestJwtBuilder.forAccount(accountId).withRoles("CUSTOMER").buildWithTestSecret();
    }

    private static String unlinked() {
        return TestJwtBuilder.forAccount(null).withSub("unlinked-user").withRoles("CUSTOMER").buildWithTestSecret();
    }

    private static String admin() {
        return TestJwtBuilder.forAccount(null).withSub("an-admin").withRoles("ADMIN").buildWithTestSecret();
    }

    @Nested
    @DisplayName("/api/bank-accounts")
    class BankAccounts {

        @Test
        void the_owner_reads_their_own_bank_account() throws Exception {
            mockMvc.perform(get("/api/bank-accounts/account/" + AARAV_ACCOUNT).header("Authorization", customer(1)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.clientId").value(1));
        }

        @Test
        void another_customer_cannot_read_it() throws Exception {
            mockMvc.perform(get("/api/bank-accounts/account/" + AARAV_ACCOUNT).header("Authorization", customer(2)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.errorCode").value("ACC-403"));
        }

        @Test
        void a_customer_cannot_tell_an_unknown_account_number_from_someone_elses() throws Exception {
            mockMvc.perform(get("/api/bank-accounts/account/NOSUCHACCOUNT1").header("Authorization", customer(2)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.errorCode").value("ACC-403"));
        }

        @Test
        void an_admin_sees_an_unknown_account_number_as_not_found() throws Exception {
            mockMvc.perform(get("/api/bank-accounts/account/NOSUCHACCOUNT1").header("Authorization", admin()))
                    .andExpect(status().isNotFound());
        }

        @Test
        void an_admin_reads_anyones_bank_account() throws Exception {
            mockMvc.perform(get("/api/bank-accounts/client/2").header("Authorization", admin()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.accountNumber").value("IN45ICIC0000002345678"));
        }

        @Test
        void an_unclaimed_bank_account_is_admin_only() throws Exception {
            mockMvc.perform(get("/api/bank-accounts/account/IN45ICIC0000008901234").header("Authorization", customer(1)))
                    .andExpect(status().isForbidden());
            mockMvc.perform(get("/api/bank-accounts/account/IN45ICIC0000008901234").header("Authorization", admin()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.clientId").doesNotExist())
                    .andExpect(jsonPath("$.claimed").value(false));
        }

        @Test
        void an_admin_can_add_an_unclaimed_bank_account() throws Exception {
            mockMvc.perform(post("/api/bank-accounts").header("Authorization", admin())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"accountNumber":"IN45NEWW0000000000002",
                                     "bankName":"New Bank","ifscCode":"NEWW0000002"}
                                    """))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.claimed").value(false));
        }

        @Test
        void a_user_with_no_linked_account_reaches_none() throws Exception {
            mockMvc.perform(get("/api/bank-accounts/client/1").header("Authorization", unlinked()))
                    .andExpect(status().isForbidden());
        }

        @Test
        void a_customer_cannot_deposit_into_someone_elses_account() throws Exception {
            mockMvc.perform(put("/api/bank-accounts/" + AARAV_ACCOUNT + "/deposit").param("amount", "10")
                            .header("Authorization", customer(2)))
                    .andExpect(status().isForbidden());
        }

        @Test
        void the_owner_can_deposit_into_their_own_account() throws Exception {
            mockMvc.perform(put("/api/bank-accounts/IN45SBIN0000003456789/deposit").param("amount", "10")
                            .header("Authorization", customer(3)))
                    .andExpect(status().isOk());
        }

        @Test
        void a_withdrawal_larger_than_the_balance_is_trf_400_not_a_500() throws Exception {
            mockMvc.perform(put("/api/bank-accounts/IN45KKBK0000005678901/withdraw").param("amount", "999999999")
                            .header("Authorization", customer(5)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.errorCode").value("TRF-400"))
                    .andExpect(jsonPath("$.message").value("Insufficient funds"));
        }

        @Test
        void a_negative_or_zero_deposit_is_val_422() throws Exception {
            for (String amount : new String[] {"-10", "0", "1.001"}) {
                mockMvc.perform(put("/api/bank-accounts/IN45KKBK0000005678901/deposit").param("amount", amount)
                                .header("Authorization", customer(5)))
                        .andExpect(status().isUnprocessableEntity())
                        .andExpect(jsonPath("$.errorCode").value("VAL-422"));
            }
        }

        @Test
        void only_an_admin_lists_every_bank_account() throws Exception {
            mockMvc.perform(get("/api/bank-accounts").header("Authorization", customer(1)))
                    .andExpect(status().isForbidden());
            mockMvc.perform(get("/api/bank-accounts").header("Authorization", admin()))
                    .andExpect(status().isOk());
        }

        @Test
        void a_customer_cannot_create_a_bank_account_for_anyone() throws Exception {
            mockMvc.perform(post("/api/bank-accounts").header("Authorization", customer(1))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"clientId":1,"accountNumber":"IN45NEWW0000000000001",
                                     "bankName":"B","ifscCode":"HDFC0000001"}
                                    """))
                    .andExpect(status().isForbidden());
        }
    }

    @Nested
    @DisplayName("/api/clients")
    class Clients {

        @Test
        void needs_a_token() throws Exception {
            mockMvc.perform(get("/api/clients/1"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.errorCode").value("AUTH-401"));
        }

        @Test
        void the_owner_reads_their_own_client_and_no_one_elses() throws Exception {
            mockMvc.perform(get("/api/clients/1").header("Authorization", customer(1)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.name").value("Aarav Mehta"));
            mockMvc.perform(get("/api/clients/2").header("Authorization", customer(1)))
                    .andExpect(status().isForbidden());
        }

        @Test
        void lookup_by_account_number_is_owner_only_too() throws Exception {
            mockMvc.perform(get("/api/clients/account/" + AARAV_ACCOUNT).header("Authorization", customer(1)))
                    .andExpect(status().isOk());
            mockMvc.perform(get("/api/clients/account/" + AARAV_ACCOUNT).header("Authorization", customer(2)))
                    .andExpect(status().isForbidden());
        }

        @Test
        void only_an_admin_lists_every_client() throws Exception {
            mockMvc.perform(get("/api/clients").header("Authorization", customer(1)))
                    .andExpect(status().isForbidden());
            mockMvc.perform(get("/api/clients").header("Authorization", admin()))
                    .andExpect(status().isOk());
        }

        @Test
        void a_customer_cannot_change_their_own_account_state() throws Exception {
            // Client 4 is SUSPENDED in the test data: lifting that is not theirs to do.
            mockMvc.perform(put("/api/clients/4/activate").header("Authorization", customer(4)))
                    .andExpect(status().isForbidden());
            mockMvc.perform(put("/api/clients/1/close").header("Authorization", customer(1)))
                    .andExpect(status().isForbidden());
        }

        @Test
        void an_admin_changes_account_state() throws Exception {
            mockMvc.perform(put("/api/clients/5/suspend").header("Authorization", admin()))
                    .andExpect(status().isOk());
        }

        @Test
        void a_customer_updates_only_their_own_profile() throws Exception {
            String body = """
                    {"name":"Rohan Iyer","email":"rohan.iyer@example.com","phone":"+919812345003"}
                    """;
            mockMvc.perform(put("/api/clients/3/profile").header("Authorization", customer(3))
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isOk());
            mockMvc.perform(put("/api/clients/3/profile").header("Authorization", customer(2))
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isForbidden());
        }

        @Test
        void a_profile_email_change_reaches_the_user_too_normalised() throws Exception {
            mockMvc.perform(put("/api/clients/6/profile").header("Authorization", customer(6))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"Sanya Kapoor","email":"Sanya.K@Example.com","phone":"+919812345006"}
                                    """))
                    .andExpect(status().isOk());

            assertThat(jdbc.queryForObject("SELECT email FROM clients WHERE client_id = 6", String.class))
                    .isEqualTo("sanya.k@example.com");
            assertThat(jdbc.queryForObject("SELECT email FROM users WHERE account_id = 6", String.class))
                    .isEqualTo("sanya.k@example.com");
        }

        @Test
        void an_email_someone_else_holds_is_acc_409_and_changes_nothing() throws Exception {
            mockMvc.perform(put("/api/clients/2/profile").header("Authorization", customer(2))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"Diya Sharma","email":"aarav.mehta@example.com","phone":"+919812345002"}
                                    """))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.errorCode").value("ACC-409"))
                    .andExpect(jsonPath("$.message").value("Email already in use"));

            assertThat(jdbc.queryForObject("SELECT email FROM users WHERE account_id = 2", String.class))
                    .isEqualTo("diya.sharma@example.com");
        }

        @Test
        void a_customer_cannot_create_clients() throws Exception {
            mockMvc.perform(post("/api/clients").header("Authorization", customer(1))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"New","email":"new@example.com","phone":"+919800000001"}
                                    """))
                    .andExpect(status().isForbidden());
        }
    }
}
