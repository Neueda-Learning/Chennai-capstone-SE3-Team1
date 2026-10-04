package com.team1.trading.api.mapper;

import com.team1.trading.api.dto.PositionResponse;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/**
 * Parameterised MyBatis Mapper for portfolio_positions and portfolio_holding tables (OWASP A03 Compliant).
 */
@Mapper
public interface PositionMapper {

    /**
     * Marks every holding of one instrument to the given market price.
     *
     * <p>This is {@code PortfolioEntry.calculateOverallGains} written as SQL:
     * {@code (currentPrice - pricePerUnit) * quantity}. It is a recomputation from the
     * current price rather than an accumulation, which is what makes replaying the same
     * quote harmless - the answer depends only on the price, not on how many times it
     * arrived.
     *
     * <p>Every account holding the instrument is updated in one statement, because a quote
     * says nothing about whose holding it is. A holding of zero lands on zero gains by
     * arithmetic, so a position that has been sold off corrects itself.
     *
     * @return how many holdings the price moved
     */
    @Update("""
            UPDATE portfolio_holding
            SET overall_gains = round((#{price} - price_per_unit) * quantity, 2),
                updated_at    = now()
            WHERE instrument_id = #{symbol}
            """)
    int markToMarket(@Param("symbol") String symbol, @Param("price") BigDecimal price);

    /**
     * The same mark, applied to the intraday book.
     *
     * <p>The formula is unchanged and needs no special case for shorts: a negative quantity
     * flips the sign, so a short gains when the price falls, which is correct.
     *
     * @return how many positions the price moved
     */
    @Update("""
            UPDATE portfolio_positions
            SET overall_gains = round((#{price} - price_per_unit) * quantity, 2),
                updated_at    = now()
            WHERE instrument_id = #{symbol}
            """)
    int markPositionsToMarket(@Param("symbol") String symbol, @Param("price") BigDecimal price);

    /**
     * What the account holds of one instrument, for the sell-side sufficiency check.
     *
     * <p>Reads portfolio_holding because that is the book the Trade Executor settles every
     * fill into. portfolio_positions is reserved for intraday positions, which nothing
     * writes yet; validating against it made anything bought through this API unsellable.
     */
    @Select("""
            SELECT client_id AS accountId, instrument_id AS symbol, quantity, price_per_unit AS pricePerUnit
            FROM portfolio_holding
            WHERE client_id = #{accountId}
              AND instrument_id = #{symbol}
            """)
    Optional<PositionRow> findHeld(@Param("accountId") Long accountId, @Param("symbol") String symbol);

    /**
     * The delivery book: stock the account owns outright. Never negative, so a quantity of
     * zero means the holding was sold off and is left out.
     */
    @Select("""
            SELECT client_id AS accountId, instrument_id AS symbol, quantity,
                   price_per_unit AS averageCost, overall_gains AS overallGains
            FROM portfolio_holding
            WHERE client_id = #{accountId}
              AND quantity > 0
            ORDER BY instrument_id ASC
            """)
    List<PositionResponse> listHoldings(@Param("accountId") Long accountId);

    /**
     * The intraday book. Filtered on {@code <> 0} rather than {@code > 0}, because a short
     * is a negative quantity and is a real position, not an empty one.
     */
    @Select("""
            SELECT client_id AS accountId, instrument_id AS symbol, quantity,
                   price_per_unit AS averageCost, overall_gains AS overallGains
            FROM portfolio_positions
            WHERE client_id = #{accountId}
              AND quantity <> 0
            ORDER BY instrument_id ASC
            """)
    List<PositionResponse> listPositions(@Param("accountId") Long accountId);

    @Insert("""
            INSERT INTO portfolio_positions (client_id, instrument_id, quantity, price_per_unit, updated_at)
            VALUES (#{pos.accountId}, #{pos.symbol}, #{pos.quantity}, #{pos.price}, now())
            ON CONFLICT (client_id, instrument_id)
            DO UPDATE SET quantity = portfolio_positions.quantity + EXCLUDED.quantity,
                          price_per_unit = EXCLUDED.price_per_unit,
                          updated_at = now()
            """)
    int upsertBuy(@Param("pos") PositionWrite pos);

    @Insert("""
            INSERT INTO portfolio_holding (client_id, instrument_id, quantity, price_per_unit, updated_at)
            VALUES (#{pos.accountId}, #{pos.symbol}, #{pos.quantity}, #{pos.price}, now())
            ON CONFLICT (client_id, instrument_id)
            DO UPDATE SET quantity = portfolio_holding.quantity + EXCLUDED.quantity,
                          price_per_unit = EXCLUDED.price_per_unit,
                          updated_at = now()
            """)
    int upsertBuyHolding(@Param("pos") PositionWrite pos);

    @Update("""
            UPDATE portfolio_positions
            SET quantity = quantity - #{pos.quantity},
                updated_at = now()
            WHERE client_id = #{pos.accountId}
              AND instrument_id = #{pos.symbol}
              AND quantity >= #{pos.quantity}
            """)
    int reduceSell(@Param("pos") PositionWrite pos);

    @Update("""
            UPDATE portfolio_holding
            SET quantity = quantity - #{pos.quantity},
                updated_at = now()
            WHERE client_id = #{pos.accountId}
              AND instrument_id = #{pos.symbol}
              AND quantity >= #{pos.quantity}
            """)
    int reduceSellHolding(@Param("pos") PositionWrite pos);

    // --- Inner DTOs ---

    class PositionRow {
        private Long accountId;
        private String symbol;
        private Integer quantity;
        private BigDecimal pricePerUnit;

        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }

        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }

        public Integer getQuantity() { return quantity; }
        public void setQuantity(Integer quantity) { this.quantity = quantity; }

        public BigDecimal getPricePerUnit() { return pricePerUnit; }
        public void setPricePerUnit(BigDecimal pricePerUnit) { this.pricePerUnit = pricePerUnit; }
    }

    class PositionWrite {
        private Long accountId;
        private String symbol;
        private Integer quantity;
        private BigDecimal price;

        public PositionWrite() {}

        public PositionWrite(Long accountId, String symbol, Integer quantity, BigDecimal price) {
            this.accountId = accountId;
            this.symbol = symbol;
            this.quantity = quantity;
            this.price = price;
        }

        public Long getAccountId() { return accountId; }
        public void setAccountId(Long accountId) { this.accountId = accountId; }

        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }

        public Integer getQuantity() { return quantity; }
        public void setQuantity(Integer quantity) { this.quantity = quantity; }

        public BigDecimal getPrice() { return price; }
        public void setPrice(BigDecimal price) { this.price = price; }
    }
}