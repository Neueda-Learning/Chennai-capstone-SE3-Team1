package com.team1.trading.api.service;

import com.team1.trading.api.event.OrderPlacedEvent;
import com.team1.trading.api.mapper.AccountMapper;
import com.team1.trading.api.mapper.AccountMapper.AccountRow;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.mapper.InstrumentMapper.InstrumentRow;
import com.team1.trading.api.mapper.OrderMapper;
import com.team1.trading.api.mapper.OrderMapper.OrderInsert;
import com.team1.trading.api.mapper.OrderMapper.OrderRow;
import com.team1.trading.api.mapper.PositionMapper;
import com.team1.trading.api.mapper.PositionMapper.PositionRow;
import com.team1.trading.domain.dto.PlaceOrderRequest;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import com.team1.trading.domain.exception.AccountNotActiveException;
import com.team1.trading.domain.exception.AccountNotFoundException;
import com.team1.trading.domain.exception.DuplicateOrderException;
import com.team1.trading.domain.exception.InsufficientFundsException;
import com.team1.trading.domain.exception.InsufficientHoldingsException;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import com.team1.trading.domain.exception.InvalidOrderException;
import com.team1.trading.domain.exception.OrderNotCancellableException;
import com.team1.trading.domain.exception.OrderNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Unit tests of the order rules and the acceptance (write at NEW, publish {@code ORDER_PLACED}),
 * against mocked mappers. The rule table of contracts/trade-api.yaml is exercised in order - the
 * first failure wins - and every rejection is the domain's own exception, so the HTTP layer needs
 * no container to be proven correct here.
 */
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    private static final Long ACCOUNT_ID = 1L;
    private static final String SYMBOL = "ACME";
    private static final String IDEMPOTENCY_KEY = "6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e";

    @Mock
    private AccountMapper accountMapper;
    @Mock
    private InstrumentMapper instrumentMapper;
    @Mock
    private OrderMapper orderMapper;
    @Mock
    private PositionMapper positionMapper;
    @Mock
    private ApplicationEventPublisher applicationEventPublisher;

    private OrderService orderService;

    @BeforeEach
    void setUp() {
        orderService = new OrderService(accountMapper, instrumentMapper, orderMapper, positionMapper,
                applicationEventPublisher);
    }

    private AccountRow activeAccount() {
        AccountRow row = new AccountRow();
        row.setClientId(ACCOUNT_ID);
        row.setAccountNumber("ACC-000001");
        row.setName("Priya Menon");
        row.setCreatedOn(LocalDateTime.of(2026, 1, 1, 8, 0));
        row.setAccountState("ACTIVE");
        row.setWalletBalance(new BigDecimal("2500.00"));
        row.setVersion(7);
        row.setUpdatedOn(LocalDateTime.of(2026, 9, 28, 9, 0));
        return row;
    }

    private InstrumentRow tradableInstrument() {
        InstrumentRow row = new InstrumentRow();
        row.setInstrumentId(SYMBOL);
        row.setInstrumentName("ACME Corp");
        row.setActive(true);
        row.setUpdatedOn(null);
        return row;
    }

    private PlaceOrderRequest buyRequest(Integer quantity, BigDecimal price) {
        return new PlaceOrderRequest(ACCOUNT_ID, SYMBOL, OrderSide.BUY, quantity, price, IDEMPOTENCY_KEY);
    }

    private PlaceOrderRequest sellRequest(Integer quantity, BigDecimal price) {
        return new PlaceOrderRequest(ACCOUNT_ID, SYMBOL, OrderSide.SELL, quantity, price, IDEMPOTENCY_KEY);
    }

    @Nested
    @DisplayName("Rules 1 to 8, first failure wins")
    class BusinessRulesTests {

        @Test
        @DisplayName("Rule 1: a missing account is ACC-404 before anything else is read")
        void missingAccount() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.empty());

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), ACCOUNT_ID))
                    .isInstanceOf(AccountNotFoundException.class)
                    .hasMessage("Account not found");
            verify(instrumentMapper, never()).findRowBySymbol(any());
            verify(applicationEventPublisher, never()).publishEvent(any());
        }

        @Test
        @DisplayName("A token that cannot reach the account is ACC-403")
        void tokenCannotReachAccount() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), 5L))
                    .isInstanceOf(AccountNotActiveException.class)
                    .hasMessage("Account not active");
            verify(instrumentMapper, never()).findRowBySymbol(any());
        }

        @Test
        @DisplayName("A user with no linked bank account (null accountId claim) is ACC-403")
        void unlinkedUserCannotTrade() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), null))
                    .isInstanceOf(AccountNotActiveException.class)
                    .hasMessage("Account not active");
            verify(instrumentMapper, never()).findRowBySymbol(any());
            verify(orderMapper, never()).insert(any());
        }

        @Test
        @DisplayName("Rule 2: a non-active account is ACC-403")
        void inactiveAccount() {
            AccountRow row = activeAccount();
            row.setAccountState("SUSPENDED");
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(row));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), ACCOUNT_ID))
                    .isInstanceOf(AccountNotActiveException.class)
                    .hasMessage("Account not active");
            verify(instrumentMapper, never()).findRowBySymbol(any());
        }

        @Test
        @DisplayName("Rule 3: an unknown instrument is INS-404")
        void missingInstrument() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.empty());

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), ACCOUNT_ID))
                    .isInstanceOf(InstrumentNotFoundException.class)
                    .hasMessage("Instrument not found");
        }

        @Test
        @DisplayName("Rule 3: a deactivated instrument is INS-404 too")
        void untradableInstrument() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            InstrumentRow row = tradableInstrument();
            row.setActive(false);
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(row));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), ACCOUNT_ID))
                    .isInstanceOf(InstrumentNotFoundException.class)
                    .hasMessage("Instrument not found");
        }

        @Test
        @DisplayName("Rule 4: a zero quantity is VAL-422")
        void zeroQuantity() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(tradableInstrument()));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(0, new BigDecimal("25.00")), ACCOUNT_ID))
                    .isInstanceOf(InvalidOrderException.class)
                    .hasMessage("Invalid input");
        }

        @Test
        @DisplayName("Rule 5: a zero price is VAL-422")
        void zeroPrice() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(tradableInstrument()));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, BigDecimal.ZERO), ACCOUNT_ID))
                    .isInstanceOf(InvalidOrderException.class)
                    .hasMessage("Invalid input");
            verify(applicationEventPublisher, never()).publishEvent(any());
        }

        @Test
        @DisplayName("Rule 6: a buy that costs more than the cash balance is ORD-400")
        void insufficientFunds() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(tradableInstrument()));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("26.00")), ACCOUNT_ID))
                    .isInstanceOf(InsufficientFundsException.class)
                    .hasMessage("Insufficient funds");
            verify(orderMapper, never()).insert(any());
            verify(applicationEventPublisher, never()).publishEvent(any());
        }

        @Test
        @DisplayName("Rule 7: a sell without enough held quantity is ORD-409")
        void insufficientHoldings() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(tradableInstrument()));
            given(positionMapper.findHeld(ACCOUNT_ID, SYMBOL)).willReturn(Optional.empty());

            assertThatThrownBy(() -> orderService.placeOrder(sellRequest(100, new BigDecimal("25.00")), ACCOUNT_ID))
                    .isInstanceOf(InsufficientHoldingsException.class)
                    .hasMessage("Insufficient holdings");
            verify(orderMapper, never()).insert(any());
            verify(applicationEventPublisher, never()).publishEvent(any());
        }

        @Test
        @DisplayName("Rule 8: a reused idempotency key is ORD-409, surfaced by the unique constraint")
        void duplicateIdempotencyKey() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(tradableInstrument()));
            given(orderMapper.insert(any())).willThrow(new DataIntegrityViolationException(
                    "statement", runtime("ERROR: duplicate key value violates unique constraint "
                    + "\"uq_orders_idempotency_key\"\nDetail: Key (idempotency_key) already exists.")));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), ACCOUNT_ID))
                    .isInstanceOf(DuplicateOrderException.class)
                    .hasMessage("Duplicate order");
            verify(accountMapper, never()).updateCashGuarded(any());
            verify(applicationEventPublisher, never()).publishEvent(any());
        }

        @Test
        @DisplayName("A data-integrity failure that is not the idempotency key is not masked")
        void unrelatedConstraintViolationRethrown() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(tradableInstrument()));
            given(orderMapper.insert(any())).willThrow(new DataIntegrityViolationException(
                    "statement", runtime("ERROR: some other constraint violated")));

            assertThatThrownBy(() -> orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), ACCOUNT_ID))
                    .isInstanceOf(DataIntegrityViolationException.class)
                    .isNotInstanceOf(DuplicateOrderException.class);
        }

        private RuntimeException runtime(String message) {
            return new RuntimeException(message);
        }
    }

    @Nested
    @DisplayName("Order acceptance: written at NEW and published ORDER_PLACED")
    class AcceptanceTests {

        @Test
        @DisplayName("A funded buy files the order NEW, publishes ORDER_PLACED and never touches cash or positions")
        void acceptedBuyWritesNewAndPublishes() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(tradableInstrument()));
            given(orderMapper.insert(any())).willReturn(1);

            var response = orderService.placeOrder(buyRequest(100, new BigDecimal("25.00")), ACCOUNT_ID);

            assertThat(response.getOrderId()).startsWith("ORD-");
            assertThat(response.getStatus()).isEqualTo(OrderStatus.NEW);
            assertThat(response.getMessage()).isEqualTo("Order accepted");
            assertThat(response.getSymbol()).isEqualTo(SYMBOL);
            assertThat(response.getSide()).isEqualTo(OrderSide.BUY);
            assertThat(response.getQuantity()).isEqualTo(100);
            assertThat(response.getPrice()).isEqualByComparingTo(new BigDecimal("25.00"));

            ArgumentCaptor<OrderInsert> insertCaptor = ArgumentCaptor.forClass(OrderInsert.class);
            verify(orderMapper).insert(insertCaptor.capture());
            OrderInsert insert = insertCaptor.getValue();
            assertThat(insert.getStatus()).isEqualTo("NEW");
            assertThat(insert.getExecutedPrice()).isNull();
            assertThat(insert.getOrderType()).isEqualTo("HOLDING");
            assertThat(insert.getSide()).isEqualTo(OrderSide.BUY);
            assertThat(insert.getIdempotencyKey()).isEqualTo(IDEMPOTENCY_KEY);

            ArgumentCaptor<OrderPlacedEvent> eventCaptor = ArgumentCaptor.forClass(OrderPlacedEvent.class);
            verify(applicationEventPublisher).publishEvent(eventCaptor.capture());
            OrderPlacedEvent event = eventCaptor.getValue();
            assertThat(event.orderUuid()).isEqualTo(response.getOrderId().substring("ORD-".length()));
            assertThat(event.accountId()).isEqualTo(ACCOUNT_ID);
            assertThat(event.symbol()).isEqualTo(SYMBOL);
            assertThat(event.side()).isEqualTo(OrderSide.BUY);
            assertThat(event.quantity()).isEqualTo(100);
            assertThat(event.price()).isEqualByComparingTo(new BigDecimal("25.00"));
            assertThat(event.idempotencyKey()).isEqualTo(IDEMPOTENCY_KEY);
            assertThat(event.key()).isEqualTo("1");

            verify(accountMapper, never()).updateCashGuarded(any());
            verify(positionMapper, never()).upsertBuy(any());
            verify(positionMapper, never()).upsertBuyHolding(any());
            verify(positionMapper, never()).reduceSell(any());
            verify(positionMapper, never()).reduceSellHolding(any());
        }

        @Test
        @DisplayName("An accepted sell still checks rule 7, files the order NEW and publishes a SELL event")
        void acceptedSellWritesNewAndPublishes() {
            given(accountMapper.findRow(ACCOUNT_ID)).willReturn(Optional.of(activeAccount()));
            given(instrumentMapper.findRowBySymbol(SYMBOL)).willReturn(Optional.of(tradableInstrument()));
            PositionRow held = new PositionRow();
            held.setQuantity(100);
            held.setPricePerUnit(new BigDecimal("20.00"));
            given(positionMapper.findHeld(ACCOUNT_ID, SYMBOL)).willReturn(Optional.of(held));
            given(orderMapper.insert(any())).willReturn(1);

            var response = orderService.placeOrder(sellRequest(40, new BigDecimal("25.00")), ACCOUNT_ID);

            assertThat(response.getStatus()).isEqualTo(OrderStatus.NEW);
            assertThat(response.getMessage()).isEqualTo("Order accepted");

            ArgumentCaptor<OrderPlacedEvent> eventCaptor = ArgumentCaptor.forClass(OrderPlacedEvent.class);
            verify(applicationEventPublisher).publishEvent(eventCaptor.capture());
            assertThat(eventCaptor.getValue().side()).isEqualTo(OrderSide.SELL);

            verify(accountMapper, never()).updateCashGuarded(any());
            verify(positionMapper, never()).reduceSell(any());
            verify(positionMapper, never()).reduceSellHolding(any());
            verify(positionMapper, never()).upsertBuy(any());
            verify(positionMapper, never()).upsertBuyHolding(any());
        }
    }

    @Nested
    @DisplayName("Order cancellation, a guarded transition")
    class CancelTests {

        private OrderRow newOrderRow() {
            OrderRow row = new OrderRow();
            row.setOrderUuid("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e");
            row.setClientId(ACCOUNT_ID);
            row.setAccountId(ACCOUNT_ID);
            row.setSymbol(SYMBOL);
            row.setSide(OrderSide.BUY);
            row.setQuantity(100);
            row.setPrice(new BigDecimal("25.00"));
            row.setExecutedPrice(null);
            row.setStatus(OrderStatus.NEW);
            row.setIdempotencyKey(IDEMPOTENCY_KEY);
            row.setCreatedAt(LocalDateTime.of(2026, 9, 28, 9, 0));
            return row;
        }

        @Test
        @DisplayName("The ORD- id the API hands out is accepted, not rejected as a bad UUID")
        void cancelAcceptsTheDisplayId() {
            given(orderMapper.findByUuid("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e"))
                    .willReturn(Optional.of(newOrderRow()));
            given(orderMapper.deleteIfNew("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e")).willReturn(1);

            // every response carries orderId as ORD-<uuid>, so echoing it back is the normal case
            var response = orderService.cancel("ORD-6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e", ACCOUNT_ID);

            assertThat(response.getStatus()).isEqualTo(OrderStatus.CANCELLED);
            verify(orderMapper).deleteIfNew("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e");
        }

        @Test
        @DisplayName("An id that is not a UUID is ORD-409, never an internal error")
        void cancelRejectsAMalformedId() {
            assertThatThrownBy(() -> orderService.cancel("not-an-order", ACCOUNT_ID))
                    .isInstanceOf(OrderNotFoundException.class);
            // it must not reach the database and fail there as a 500
            verify(orderMapper, never()).findByUuid(any());
            verify(orderMapper, never()).deleteIfNew(any());
        }

        @Test
        @DisplayName("Cancelling a NEW order moves it to order_history and out of the live book")
        void cancelNewOrder() {
            given(orderMapper.findByUuid("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e"))
                    .willReturn(Optional.of(newOrderRow()));
            given(orderMapper.deleteIfNew("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e")).willReturn(1);

            var response = orderService.cancel("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e", ACCOUNT_ID);

            assertThat(response.getOrderId()).isEqualTo("ORD-6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e");
            assertThat(response.getStatus()).isEqualTo(OrderStatus.CANCELLED);
            assertThat(response.getMessage()).isEqualTo("Order cancelled");
        }

        @Test
        @DisplayName("An unknown order is ORD-409 OrderNotFoundException")
        void cancelUnknownOrder() {
            // a well-formed id that matches nothing, so this exercises the lookup rather
            // than the id check that cancelRejectsAMalformedId covers
            String absent = "00000000-0000-4000-8000-000000000000";
            given(orderMapper.findByUuid(absent)).willReturn(Optional.empty());

            assertThatThrownBy(() -> orderService.cancel(absent, ACCOUNT_ID))
                    .isInstanceOf(OrderNotFoundException.class)
                    .hasMessage("Order not found");
        }

        @Test
        @DisplayName("A token that cannot reach the order's account is ACC-403")
        void cancelWrongToken() {
            given(orderMapper.findByUuid("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e"))
                    .willReturn(Optional.of(newOrderRow()));

            assertThatThrownBy(() -> orderService.cancel("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e", 5L))
                    .isInstanceOf(AccountNotActiveException.class)
                    .hasMessage("Account not active");
            verify(orderMapper, never()).deleteIfNew(any());
        }

        @Test
        @DisplayName("A user with no linked bank account (null accountId claim) cannot cancel: ACC-403")
        void cancelWithoutLinkedAccount() {
            given(orderMapper.findByUuid("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e"))
                    .willReturn(Optional.of(newOrderRow()));

            assertThatThrownBy(() -> orderService.cancel("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e", null))
                    .isInstanceOf(AccountNotActiveException.class)
                    .hasMessage("Account not active");
            verify(orderMapper, never()).deleteIfNew(any());
        }

        @Test
        @DisplayName("A terminal order cannot cancel: the guard reports zero rows and ORD-409 carries the state")
        void cancelFilledOrder() {
            OrderRow row = newOrderRow();
            row.setStatus(OrderStatus.FILLED);
            given(orderMapper.findByUuid("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e"))
                    .willReturn(Optional.of(row));
            given(orderMapper.deleteIfNew("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e")).willReturn(0);

            assertThatThrownBy(() -> orderService.cancel("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e", ACCOUNT_ID))
                    .isInstanceOf(OrderNotCancellableException.class)
                    .hasMessage("Order is not cancellable")
                    .isInstanceOfSatisfying(OrderNotCancellableException.class,
                            e -> assertThat(e.getStatus()).isEqualTo("FILLED"));
        }
    }
}