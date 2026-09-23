package com.team1.trading.api.mapper;

import com.team1.trading.domain.entity.Client;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:clientctx;DB_CLOSE_DELAY=-1")
class ClientMapperTest {

    @Autowired
    private ClientMapper clientMapper;

    @Test
    @DisplayName("A client row maps onto Client's constructor without an account number column")
    void findById_mapsTheRow() {
        Client client = clientMapper.findById(1L).orElseThrow();

        assertThat(client.getClientId()).isEqualTo(1L);
        assertThat(client.getName()).isEqualTo("Aarav Mehta");
        assertThat(client.getEmail()).isEqualTo("aarav.mehta@example.com");
        assertThat(client.getAccountState()).isEqualTo("ACTIVE");
    }

    @Test
    @DisplayName("A bank account number finds its client through bank_account.client_id")
    void findByAccountNumber_goesThroughBankAccount() {
        Client client = clientMapper.findByAccountNumber("IN45ICIC0000002345678").orElseThrow();

        assertThat(client.getClientId()).isEqualTo(2L);
        assertThat(client.getName()).isEqualTo("Diya Sharma");
        assertThat(clientMapper.findByAccountNumber("NO-SUCH-ACCOUNT")).isEmpty();
    }

    @Test
    @DisplayName("save() writes the generated client_id back onto the entity")
    void save_setsTheGeneratedId() {
        Client client = new Client(null, "Priya Menon", "priya.menon@example.com", "+919812345099");

        clientMapper.save(client);

        assertThat(client.getClientId()).isNotNull();
        assertThat(clientMapper.findById(client.getClientId()))
                .hasValueSatisfying(stored -> assertThat(stored.getEmail()).isEqualTo("priya.menon@example.com"));
    }
}
