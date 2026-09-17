package com.team1.trading.api.service;

import com.team1.trading.api.dto.OrderResponse;
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
import com.team1.trading.domain.entity.Client;
import com.team1.trading.domain.entity.Instrument;
import com.team1.trading.domain.entity.Order;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import com.team1.trading.domain.entity.types.OrderType;
import com.team1.trading.domain.exception.AccountNotActiveException;
import com.team1.trading.domain.exception.AccountNotFoundException;
import com.team1.trading.domain.exception.DuplicateOrderException;
import com.team1.trading.domain.exception.InsufficientFundsException;
import com.team1.trading.domain.exception.InsufficientHoldingsException;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import com.team1.trading.domain.exception.InvalidOrderException;
import com.team1.trading.domain.exception.OrderNotCancellableException;
import com.team1.trading.domain.exception.OrderNotFoundException;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.UUID;

/**
 * Order placement and cancellation for contracts/trade-api.yaml.
 *
 * <p>The business rules are the domain's own behaviour and exceptions: the account and
 * instrument entities decide {@code canTrade}/{@code canAfford}/{@code isTradable}, and every
 * rejection is a {@code DomainException} from the shared jar. This service orders those checks
 * exactly as the contract's rule table does - first failure wins - and then files the order at
 * {@code NEW}. The synchronous fill (the cash move and the position change) is not done here any
 * more: pricing is the Trade Executor's job, driven by an {@code ORDER_PLACED} event published
 * once this transaction has committed (see {@link com.team1.trading.api.event.KafkaOrderEventPublisher}).
 */
@Service
public class OrderService {

    private final AccountMapper accountMapper;
    private final InstrumentMapper instrumentMapper;
    private final OrderMapper orderMapper;
    private final PositionMapper positionMapper;
    private final ApplicationEventPublisher applicationEventPublisher;

    public OrderService(AccountMapper accountMapper, InstrumentMapper instrumentMapper,
                        OrderMapper orderMapper, PositionMapper positionMapper,
                        ApplicationEventPublisher applicationEventPublisher) {
        this.accountMapper = accountMapper;
        this.instrumentMapper = instrumentMapper;
        this.orderMapper = orderMapper;
        this.positionMapper = positionMapper;
        this.applicationEventPublisher = applicationEventPublisher;
    }

    /**
     * Validates rules 1 to 8 in order, then files the order at {@code NEW} and returns it. The
     * fill is not this endpoint's job: there is no execution price in the request, pricing is the
     * Trade Executor's, and the order leaves as {@code ORDER_PLACED} on the {@code orders} topic
     * once the transaction that wrote it has committed (rules 9 and 10 move to the executor).
     *
     * <p>Rule 8 is enforced by the {@code uq_orders_idempotency_key} constraint, not by a read
     * then a write, so two concurrent requests with the same key cannot both pass a pre-check.
     * That constraint only covers orders still in the live book, though: since migration 010 a
     * settled order is deleted from it and its key lives on in order_history. A key already
     * used by a settled order therefore has to be caught by an explicit read.
     */
    @Transactional
    public OrderResponse placeOrder(PlaceOrderRequest request, Long tokenAccountId) {
        Long accountId = request.getAccountId();

        AccountRow accountRow = accountMapper.findRow(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId));          // rule 1
        if (tokenAccountId != null && !tokenAccountId.equals(accountId)) {
            throw new AccountNotActiveException(accountId, "TOKEN");
        }
        Client client = toClient(accountRow);
        if (!client.canTrade()) {                                                     // rule 2
            throw new AccountNotActiveException(accountId, client.getAccountState());
        }

        InstrumentRow instrumentRow = instrumentMapper.findRowBySymbol(request.getSymbol())
                .orElseThrow(() -> new InstrumentNotFoundException(request.getSymbol())); // rule 3
        Instrument instrument = new Instrument(instrumentRow.getInstrumentId(),
                instrumentRow.getInstrumentName(), instrumentRow.isActive(), instrumentRow.getUpdatedOn());
        if (!instrument.isTradable()) {
            throw new InstrumentNotFoundException(request.getSymbol());               // rule 3
        }

        Integer quantity = request.getQuantity();
        if (quantity == null || quantity <= 0) {                                      // rule 4
            throw new InvalidOrderException("quantity", quantity);
        }
        BigDecimal price = request.getPrice();
        if (price == null || price.signum() <= 0) {                                   // rule 5
            throw new InvalidOrderException("price", price);
        }

        BigDecimal cost = money(BigDecimal.valueOf(quantity).multiply(price));
        if (request.getSide() == OrderSide.BUY) {                                     // rule 6
            if (cost.compareTo(client.getWalletBalance()) > 0) {
                throw new InsufficientFundsException(accountId, cost, client.getWalletBalance());
            }
        } else {                                                                      // rule 7
            int heldQuantity = positionMapper.findHeld(accountId, request.getSymbol())
                    .map(PositionRow::getQuantity).orElse(0);
            if (heldQuantity < quantity) {
                throw new InsufficientHoldingsException(accountId, request.getSymbol(),
                        BigDecimal.valueOf(quantity), BigDecimal.valueOf(heldQuantity));
            }
        }

        if (orderMapper.countSettledWithIdempotencyKey(request.getIdempotencyKey()) > 0) {
            throw new DuplicateOrderException(request.getIdempotencyKey());            // rule 8
        }

        String orderUuid = UUID.randomUUID().toString();
        Order order = new Order(accountId, accountId, request.getSymbol(), OrderType.HOLDING,
                request.getSide(), BigDecimal.valueOf(quantity), price, request.getIdempotencyKey());
        try {
            orderMapper.insert(toInsert(order, orderUuid));                           // rule 8
        } catch (DataIntegrityViolationException e) {
            if (isIdempotencyViolation(e)) {
                throw new DuplicateOrderException(request.getIdempotencyKey());
            }
            throw e;
        }

        applicationEventPublisher.publishEvent(OrderPlacedEvent.of(
                orderUuid, accountId, request.getSymbol(), request.getSide(), quantity, price,
                request.getIdempotencyKey(), order.getCreatedAt()));

        return new OrderResponse(displayId(orderUuid), OrderStatus.NEW, "Order accepted",
                request.getSymbol(), request.getSide(), quantity, price);
    }

    /**
     * Cancels a {@code NEW} order with a guarded state transition inside the database. The
     * {@code WHERE status = 'NEW'} update races nothing: it is the whole transition, not a read
     * followed by a write.
     */
    @Transactional
    public OrderResponse cancel(String orderId, Long tokenAccountId) {
        String orderUuid = toOrderUuid(orderId);
        OrderRow row = orderMapper.findByUuid(orderUuid)
                .orElseThrow(() -> new OrderNotFoundException(displayId(orderUuid)));
        if (tokenAccountId != null && !tokenAccountId.equals(row.getAccountId())) {
            throw new AccountNotActiveException(row.getAccountId(), "TOKEN");
        }
        // Cancelling is terminal, so the order moves to order_history and leaves the live
        // book. The delete's rowcount is the guard: 0 means it had already settled.
        orderMapper.archiveCancelled(orderUuid);
        if (orderMapper.deleteIfNew(orderUuid) == 0) {
            throw new OrderNotCancellableException(displayId(orderUuid), row.getStatus().name());
        }
        return new OrderResponse(displayId(orderUuid), OrderStatus.CANCELLED, "Order cancelled",
                row.getSymbol(), row.getSide(), row.getQuantity(), row.getPrice());
    }

    private static Client toClient(AccountRow row) {
        return new Client(row.getClientId(), row.getAccountNumber(), row.getName(), row.getEmail(),
                row.getPhone(), row.getCreatedOn(), row.getAccountState(), row.getWalletBalance());
    }

    private static OrderInsert toInsert(Order order, String orderUuid) {
        OrderInsert insert = new OrderInsert();
        insert.setClientId(order.getClientId());
        insert.setAccountId(order.getAccountId());
        insert.setInstrumentId(order.getInstrumentId());
        insert.setOrderType(order.getOrderType().name());
        insert.setSide(order.getSide());
        insert.setQuantity(order.getQuantity().intValue());
        insert.setPrice(order.getPrice());
        insert.setExecutedPrice(order.getExecutedPrice());
        insert.setStatus(order.getStatus().name());
        insert.setIdempotencyKey(order.getIdempotencyKey());
        insert.setExternalOrderId(order.getExternalOrderId());
        insert.setOrderUuid(orderUuid);
        return insert;
    }

    private static final String ORDER_ID_PREFIX = "ORD-";

    private static String displayId(String orderUuid) {
        return ORDER_ID_PREFIX + orderUuid;
    }

    /**
     * Accepts an order id in the form the API hands out and returns the bare UUID.
     *
     * <p>Every response carries {@code orderId} as {@code ORD-<uuid>}, so a caller echoing
     * back what it was given is the normal case, not a mistake. The prefix used to reach the
     * UUID cast in SQL and fail as a 500; an id that is not a UUID at all is a lookup that
     * cannot match, which is ORD-409 rather than an internal error.
     */
    private static String toOrderUuid(String orderId) {
        String value = orderId == null ? "" : orderId.trim();
        if (value.regionMatches(true, 0, ORDER_ID_PREFIX, 0, ORDER_ID_PREFIX.length())) {
            value = value.substring(ORDER_ID_PREFIX.length());
        }
        try {
            return UUID.fromString(value).toString();
        } catch (IllegalArgumentException e) {
            throw new OrderNotFoundException(displayId(value));
        }
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    private static boolean isIdempotencyViolation(DataIntegrityViolationException e) {
        String detail = String.valueOf(e.getMostSpecificCause().getMessage());
        return detail.contains("uq_orders_idempotency_key") || detail.toLowerCase().contains("idempotency");
    }
}