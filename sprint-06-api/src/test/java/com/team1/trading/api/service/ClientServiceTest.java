package com.team1.trading.api.service;

import com.team1.trading.api.exception.EmailInUseException;
import com.team1.trading.api.mapper.ClientMapper;
import com.team1.trading.api.mapper.UserMapper;
import com.team1.trading.domain.entity.Client;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DuplicateKeyException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ClientServiceTest {

    @Mock
    private ClientMapper clientMapper;
    @Mock
    private UserMapper userMapper;

    @InjectMocks
    private ClientService clientService;

    @Test
    void a_profile_update_writes_the_same_normalised_email_to_the_client_and_its_user() {
        given(clientMapper.updateProfile(any())).willReturn(1);

        boolean updated = clientService.updateClientProfile(3L, "Rohan Iyer", "  Rohan.Iyer@Example.COM ", "+919812345003");

        assertThat(updated).isTrue();
        ArgumentCaptor<Client> client = ArgumentCaptor.forClass(Client.class);
        verify(clientMapper).updateProfile(client.capture());
        assertThat(client.getValue().getEmail()).isEqualTo("rohan.iyer@example.com");
        verify(userMapper).updateEmailForAccount(3L, "rohan.iyer@example.com");
    }

    @Test
    void an_unknown_client_updates_nothing_and_leaves_users_alone() {
        given(clientMapper.updateProfile(any())).willReturn(0);

        assertThat(clientService.updateClientProfile(99L, "X", "x@example.com", "1")).isFalse();
        verify(userMapper, never()).updateEmailForAccount(anyLong(), anyString());
    }

    @Test
    void an_email_another_client_holds_is_acc_409() {
        willThrow(new DuplicateKeyException("clients_email_key")).given(clientMapper).updateProfile(any());

        assertThatThrownBy(() -> clientService.updateClientProfile(3L, "X", "aarav.mehta@example.com", "1"))
                .isInstanceOf(EmailInUseException.class)
                .hasFieldOrPropertyWithValue("code", "ACC-409")
                .hasMessage("Email already in use");
    }

    @Test
    void an_email_another_user_holds_is_acc_409() {
        given(clientMapper.updateProfile(any())).willReturn(1);
        willThrow(new DuplicateKeyException("uq_users_email")).given(userMapper).updateEmailForAccount(anyLong(), anyString());

        assertThatThrownBy(() -> clientService.updateClientProfile(3L, "X", "someone@example.com", "1"))
                .isInstanceOf(EmailInUseException.class);
    }
}
