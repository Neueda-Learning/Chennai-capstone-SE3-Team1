package com.team1.trading.api.service;

import com.team1.trading.api.conditional.ConditionInvalidException;
import com.team1.trading.api.conditional.ConditionText;
import com.team1.trading.api.conditional.ConditionalOrderLimitException;
import com.team1.trading.api.dto.ConditionSpec;
import com.team1.trading.api.dto.ConditionalOrderRequest;
import com.team1.trading.api.dto.OrderResponse;
import com.team1.trading.api.dto.OrderStatusResponse;
import com.team1.trading.api.event.OrderPlacedEvent;
import com.team1.trading.api.mapper.AccountMapper;
import com.team1.trading.api.mapper.AccountMapper.AccountRow;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.mapper.InstrumentMapper.InstrumentRow;
import com.team1.trading.api.mapper.OrderMapper;
import com.team1.trading.api.mapper.OrderMapper.ConditionRow;
import com.team1.trading.api.mapper.OrderMapper.OrderInsert;
import com.team1.trading.api.mapper.OrderMapper.OrderRow;
import com.team1.trading.api.mapper.PositionMapper;
import com.team1.trading.api.mapper.PositionMapper.PositionRow;
import com.team1.trading.domain.dto.PlaceOrderRequest;
import com.team1.trading.domain.entity.Client;
import com.team1.trading.domain.entity.Instrument;
import com.team1.trading.domain.entity.Order;
import com.team1.trading.domain.entity.types.ConditionType;
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

@Service
public class OrderService {

    /** Conditional orders one account may have waiting at once. */
    public static final int MAX_PENDING_CONDITIONAL = 25;

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

    @Transactional
    public OrderResponse placeOrder(PlaceOrderRequest request, Long tokenAccountId) {
        Order order = validated(request, tokenAccountId);
        String orderUuid = insert(order, request.getIdempotencyKey());

        applicationEventPublisher.publishEvent(OrderPlacedEvent.of(
                orderUuid, request.getAccountId(), request.getSymbol(), request.getSide(), request.getQuantity(),
                request.getPrice(), request.getIdempotencyKey(), order.getCreatedAt()));

        return new OrderResponse(displayId(orderUuid), OrderStatus.NEW, "Order accepted",
                request.getSymbol(), request.getSide(), request.getQuantity(), request.getPrice());
    }

    /**
     * Places an order that waits in the book as PENDING until its condition is met (ADR 0012). It passes every
     * check placeOrder makes, now, and is not published: the conditional-order poller releases it later.
     */
    @Transactional
    public OrderResponse placeConditionalOrder(ConditionalOrderRequest request, Long tokenAccountId) {
        PlaceOrderRequest plain = request.toOrder();
        Order order = validated(plain, tokenAccountId);
        if (orderMapper.countPending(plain.getAccountId()) >= MAX_PENDING_CONDITIONAL) {
            throw new ConditionalOrderLimitException("An account can have at most " + MAX_PENDING_CONDITIONAL
                    + " conditional orders waiting; cancel one to place another");
        }
        ConditionSpec c = request.getCondition();
        try {
            order.holdUntil(c.type(), c.triggerPrice(), c.shortWindow(), c.longWindow(), c.bandWidth(),
                    order.getCreatedAt().plusDays(request.expiryDays()));
        } catch (IllegalArgumentException e) {
            throw new ConditionInvalidException(e.getMessage());
        }
        String orderUuid = insert(order, plain.getIdempotencyKey());
        String when = ConditionText.describe(order.getConditionType(), order.getTriggerPrice(),
                order.getShortWindow(), order.getLongWindow(), order.getBandWidth());
        return new OrderResponse(displayId(orderUuid), OrderStatus.PENDING, "Held until " + when.substring(5),
                plain.getSymbol(), plain.getSide(), plain.getQuantity(), plain.getPrice());
    }

    /** Where one order stands, including the condition of a conditional order still in the book. */
    @Transactional(readOnly = true)
    public OrderStatusResponse getOrder(String orderId, Long tokenAccountId) {
        String orderUuid = toOrderUuid(orderId);
        OrderRow row = orderMapper.findByUuid(orderUuid)
                .orElseThrow(() -> new OrderNotFoundException(displayId(orderUuid)));
        if (tokenAccountId == null || !tokenAccountId.equals(row.getAccountId())) {
            throw new AccountNotActiveException(row.getAccountId(), "TOKEN");
        }
        OrderStatusResponse.ConditionView condition = orderMapper.findCondition(orderUuid)
                .map(OrderService::toView).orElse(null);
        return new OrderStatusResponse(displayId(orderUuid), row.getAccountId(), row.getSymbol(), row.getSide(),
                row.getQuantity(), row.getPrice(), row.getExecutedPrice(), row.getStatus(), row.getReason(),
                row.getCreatedAt(), condition);
    }

    public static OrderStatusResponse.ConditionView toView(ConditionRow c) {
        ConditionType type = ConditionType.valueOf(c.getType());
        return new OrderStatusResponse.ConditionView(c.getType(),
                ConditionText.describe(type, c.getTriggerPrice(), c.getShortWindow(), c.getLongWindow(),
                        c.getBandWidth()),
                c.getTriggerPrice(), c.getShortWindow(), c.getLongWindow(), c.getBandWidth(), c.getState(),
                c.getExpiresAt(), c.getLastCheckedAt(), c.getTriggeredAt(), c.getTriggerReason());
    }

    /** Every check an order must pass before it may enter the book, whether it is sent now or held. */
    private Order validated(PlaceOrderRequest request, Long tokenAccountId) {
        Long accountId = request.getAccountId();

        AccountRow accountRow = accountMapper.findRow(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId));
        if (tokenAccountId == null || !tokenAccountId.equals(accountId)) {
            throw new AccountNotActiveException(accountId, "TOKEN");
        }
        Client client = toClient(accountRow);
        if (!client.canTrade()) {
            throw new AccountNotActiveException(accountId, client.getAccountState());
        }

        InstrumentRow instrumentRow = instrumentMapper.findRowBySymbol(request.getSymbol())
                .orElseThrow(() -> new InstrumentNotFoundException(request.getSymbol()));
        Instrument instrument = new Instrument(instrumentRow.getInstrumentId(),
                instrumentRow.getInstrumentName(), instrumentRow.isActive(), instrumentRow.getUpdatedOn());
        if (!instrument.isTradable()) {
            throw new InstrumentNotFoundException(request.getSymbol());
        }

        Integer quantity = request.getQuantity();
        if (quantity == null || quantity <= 0) {
            throw new InvalidOrderException("quantity", quantity);
        }
        BigDecimal price = request.getPrice();
        if (price == null || price.signum() <= 0) {
            throw new InvalidOrderException("price", price);
        }

        BigDecimal cost = money(BigDecimal.valueOf(quantity).multiply(price));
        if (request.getSide() == OrderSide.BUY) {
            if (cost.compareTo(client.getWalletBalance()) > 0) {
                throw new InsufficientFundsException(accountId, cost, client.getWalletBalance());
            }
        } else {
            int heldQuantity = positionMapper.findHeld(accountId, request.getSymbol())
                    .map(PositionRow::getQuantity).orElse(0);
            if (heldQuantity < quantity) {
                throw new InsufficientHoldingsException(accountId, request.getSymbol(),
                        BigDecimal.valueOf(quantity), BigDecimal.valueOf(heldQuantity));
            }
        }

        if (orderMapper.countSettledWithIdempotencyKey(request.getIdempotencyKey()) > 0) {
            throw new DuplicateOrderException(request.getIdempotencyKey());
        }

        return new Order(accountId, accountId, request.getSymbol(), OrderType.HOLDING,
                request.getSide(), BigDecimal.valueOf(quantity), price, request.getIdempotencyKey());
    }

    private String insert(Order order, String idempotencyKey) {
        String orderUuid = UUID.randomUUID().toString();
        try {
            orderMapper.insert(toInsert(order, orderUuid));
        } catch (DataIntegrityViolationException e) {
            if (isIdempotencyViolation(e)) {
                throw new DuplicateOrderException(idempotencyKey);
            }
            throw e;
        }
        return orderUuid;
    }

    @Transactional
    public OrderResponse cancel(String orderId, Long tokenAccountId) {
        String orderUuid = toOrderUuid(orderId);
        OrderRow row = orderMapper.findByUuid(orderUuid)
                .orElseThrow(() -> new OrderNotFoundException(displayId(orderUuid)));
        if (tokenAccountId == null || !tokenAccountId.equals(row.getAccountId())) {
            throw new AccountNotActiveException(row.getAccountId(), "TOKEN");
        }
        if (orderMapper.deleteIfNew(orderUuid) == 0) {
            throw new OrderNotCancellableException(displayId(orderUuid), row.getStatus().name());
        }
        orderMapper.archiveCancelled(row);
        return new OrderResponse(displayId(orderUuid), OrderStatus.CANCELLED, "Order cancelled",
                row.getSymbol(), row.getSide(), row.getQuantity(), row.getPrice());
    }

    private static Client toClient(AccountRow row) {
        return new Client(row.getClientId(), row.getName(),
                row.getCreatedOn(), row.getAccountState(), row.getWalletBalance());
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
        if (order.isConditional()) {
            insert.setConditionType(order.getConditionType().name());
            insert.setTriggerPrice(order.getTriggerPrice());
            insert.setShortWindow(order.getShortWindow());
            insert.setLongWindow(order.getLongWindow());
            insert.setBandWidth(order.getBandWidth());
            insert.setExpiresAt(order.getExpiresAt());
        }
        return insert;
    }

    private static final String ORDER_ID_PREFIX = "ORD-";

    private static String displayId(String orderUuid) {
        return ORDER_ID_PREFIX + orderUuid;
    }

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