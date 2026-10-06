\restrict HF69wgU9BTU5mZDDFzytA8LWFn9YiUjnuWQa3koDw0cSsO1nTwgFZRfDNJsF7dQ

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA auth_db;


CREATE FUNCTION public.fn_clients_state_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

    IF TG_OP = 'DELETE' THEN

        RAISE EXCEPTION

            'client % cannot be deleted; set account_state = ''CLOSED'' instead', OLD.client_id

            USING ERRCODE = 'restrict_violation';

    END IF;



    IF OLD.account_state = 'CLOSED' AND NEW.account_state <> 'CLOSED' THEN

        RAISE EXCEPTION

            'client % is CLOSED; that state is terminal and cannot be reopened (attempted %)',

            OLD.client_id, NEW.account_state

            USING ERRCODE = 'check_violation';

    END IF;



    RETURN NEW;

END;

$$;


CREATE FUNCTION public.fn_instruments_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

    RAISE EXCEPTION

        'instrument % cannot be deleted; set active = FALSE instead', OLD.instrument_id

        USING ERRCODE = 'restrict_violation';

END;

$$;


CREATE FUNCTION public.fn_resync_sequences() RETURNS TABLE(sequence_name text, set_to bigint)
    LANGUAGE plpgsql
    AS $$

DECLARE

    r   RECORD;

    seq TEXT;

    mx  BIGINT;

BEGIN

    FOR r IN

        SELECT c.table_name, c.column_name

        FROM information_schema.columns c

        JOIN information_schema.tables  t

          ON t.table_schema = c.table_schema

         AND t.table_name   = c.table_name

        WHERE c.table_schema IN ('public', 'auth_db')

          AND t.table_type   = 'BASE TABLE'

          AND (c.column_default LIKE 'nextval(%' OR c.is_identity = 'YES')

        ORDER BY c.table_name, c.column_name

    LOOP

        seq := pg_get_serial_sequence(quote_ident(r.table_name), r.column_name);

        CONTINUE WHEN seq IS NULL;



        EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', r.column_name, r.table_name)

           INTO mx;



        PERFORM setval(seq, GREATEST(mx, 1), mx > 0);



        sequence_name := seq;

        set_to        := GREATEST(mx, 1);

        RETURN NEXT;

    END LOOP;

END;

$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE auth_db.otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(150) NOT NULL,
    purpose character varying(16) NOT NULL,
    code_hash character(64) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    consumed_at timestamp without time zone,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_otp_attempts_non_negative CHECK ((attempts >= 0)),
    CONSTRAINT chk_otp_expires_after_created CHECK ((expires_at > created_at)),
    CONSTRAINT chk_otp_purpose CHECK (((purpose)::text = ANY ((ARRAY['REGISTER'::character varying, 'RESET'::character varying])::text[])))
);


CREATE TABLE auth_db.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_refresh_expires_after_created CHECK ((expires_at > created_at))
);


CREATE TABLE auth_db.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(64) NOT NULL,
    account_id bigint,
    roles text[] DEFAULT ARRAY['CUSTOMER'::text] NOT NULL,
    password_hash character varying(255) NOT NULL,
    params_version integer DEFAULT 1 NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    created_on timestamp without time zone DEFAULT now() NOT NULL,
    updated timestamp without time zone DEFAULT now() NOT NULL,
    email character varying(150) NOT NULL,
    phone character varying(20),
    status character varying(16) DEFAULT 'ACTIVE'::character varying NOT NULL,
    CONSTRAINT chk_users_email_not_blank CHECK ((length(btrim((email)::text)) > 0)),
    CONSTRAINT chk_users_password_not_blank CHECK ((length(btrim((password_hash)::text)) > 0)),
    CONSTRAINT chk_users_roles_not_empty CHECK ((cardinality(roles) > 0)),
    CONSTRAINT chk_users_status CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'ACTIVE'::character varying])::text[]))),
    CONSTRAINT chk_users_username_format CHECK ((((username)::text ~ '^[a-zA-Z0-9._-]+$'::text) AND ((char_length((username)::text) >= 3) AND (char_length((username)::text) <= 64)))),
    CONSTRAINT chk_users_version_non_negative CHECK ((version >= 0))
);


CREATE TABLE public.bank_account (
    account_number character varying(34) NOT NULL,
    client_id bigint,
    account_balance numeric(18,2) DEFAULT 0 NOT NULL,
    bank_name character varying(150) NOT NULL,
    ifsc_code character varying(11) NOT NULL,
    CONSTRAINT chk_bank_account_balance_non_negative CHECK ((account_balance >= (0)::numeric)),
    CONSTRAINT chk_bank_account_number_not_blank CHECK ((length(btrim((account_number)::text)) > 0))
);


CREATE TABLE public.clients (
    client_id bigint NOT NULL,
    name character varying(150) NOT NULL,
    created_on timestamp without time zone DEFAULT now() NOT NULL,
    account_state character varying(10) DEFAULT 'ACTIVE'::character varying NOT NULL,
    wallet_balance numeric(18,2) DEFAULT 0 NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    updated_on timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_clients_account_state CHECK (((account_state)::text = ANY ((ARRAY['ACTIVE'::character varying, 'SUSPENDED'::character varying, 'CLOSED'::character varying])::text[]))),
    CONSTRAINT chk_clients_wallet_balance_non_negative CHECK ((wallet_balance >= (0)::numeric))
);


CREATE SEQUENCE public.clients_client_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.clients_client_id_seq OWNED BY public.clients.client_id;


CREATE TABLE public.customer_preferences (
    account_id bigint NOT NULL,
    default_account_id bigint NOT NULL,
    channel character varying(10),
    channel_contact_override character varying(150),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_customer_preferences_channel CHECK (((channel IS NULL) OR ((channel)::text = ANY ((ARRAY['EMAIL'::character varying, 'SMS'::character varying, 'PUSH'::character varying])::text[]))))
);


CREATE TABLE public.daily_candle_syncs (
    instrument_id character varying(20) NOT NULL,
    synced_on date NOT NULL,
    covers_from date NOT NULL,
    candle_count integer DEFAULT 0 NOT NULL
);


CREATE TABLE public.daily_candles (
    instrument_id character varying(20) NOT NULL,
    trade_date date NOT NULL,
    open_price numeric(18,4) NOT NULL,
    high_price numeric(18,4) NOT NULL,
    low_price numeric(18,4) NOT NULL,
    close_price numeric(18,4) NOT NULL,
    adj_close numeric(18,4),
    volume bigint,
    synthetic boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_daily_candles_high_low CHECK ((high_price >= low_price)),
    CONSTRAINT chk_daily_candles_prices_positive CHECK (((open_price > (0)::numeric) AND (high_price > (0)::numeric) AND (low_price > (0)::numeric) AND (close_price > (0)::numeric))),
    CONSTRAINT chk_daily_candles_volume_non_negative CHECK (((volume IS NULL) OR (volume >= 0)))
);


CREATE TABLE public.instruments (
    instrument_id character varying(20) NOT NULL,
    instrument_name character varying(150) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_on timestamp without time zone,
    CONSTRAINT chk_instruments_id_not_blank CHECK ((length(btrim((instrument_id)::text)) > 0))
);


CREATE TABLE public.market_quotes (
    quote_id bigint NOT NULL,
    instrument_id character varying(20) NOT NULL,
    price numeric(18,4) NOT NULL,
    bid numeric(18,4),
    ask numeric(18,4),
    currency character varying(3),
    day_change numeric(18,4),
    change_percent numeric(10,4),
    previous_close numeric(18,4),
    market_state character varying(20),
    stale boolean DEFAULT false NOT NULL,
    quote_as_of timestamp with time zone,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_market_quotes_price_positive CHECK ((price > (0)::numeric))
);


CREATE SEQUENCE public.market_quotes_quote_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.market_quotes_quote_id_seq OWNED BY public.market_quotes.quote_id;


CREATE TABLE public.order_history (
    history_id bigint NOT NULL,
    order_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    previous_status character varying(10),
    new_status character varying(10),
    external_status character varying(50),
    external_order_id character varying(100),
    request_id character varying(100),
    failure_code character varying(50),
    failure_reason character varying(255),
    api_response text,
    event_timestamp timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    client_id bigint,
    account_id bigint,
    instrument_id character varying(20),
    order_type character varying(8),
    side character varying(4),
    quantity numeric(18,4),
    price numeric(18,4),
    executed_price numeric(18,4),
    idempotency_key character varying(100),
    order_created_at timestamp without time zone,
    CONSTRAINT chk_order_history_event_type_not_blank CHECK ((length(btrim((event_type)::text)) > 0)),
    CONSTRAINT chk_order_history_executed_price_positive CHECK (((executed_price IS NULL) OR (executed_price > (0)::numeric))),
    CONSTRAINT chk_order_history_filled_has_executed_price CHECK ((((new_status)::text <> 'FILLED'::text) OR (idempotency_key IS NULL) OR (executed_price IS NOT NULL))),
    CONSTRAINT chk_order_history_new_status CHECK (((new_status IS NULL) OR ((new_status)::text = ANY ((ARRAY['NEW'::character varying, 'FILLED'::character varying, 'REJECTED'::character varying, 'CANCELLED'::character varying])::text[])))),
    CONSTRAINT chk_order_history_order_type CHECK (((order_type IS NULL) OR ((order_type)::text = ANY ((ARRAY['POSITION'::character varying, 'HOLDING'::character varying])::text[])))),
    CONSTRAINT chk_order_history_previous_status CHECK (((previous_status IS NULL) OR ((previous_status)::text = ANY ((ARRAY['NEW'::character varying, 'FILLED'::character varying, 'REJECTED'::character varying, 'CANCELLED'::character varying])::text[])))),
    CONSTRAINT chk_order_history_price_positive CHECK (((price IS NULL) OR (price > (0)::numeric))),
    CONSTRAINT chk_order_history_quantity_positive CHECK (((quantity IS NULL) OR (quantity > (0)::numeric))),
    CONSTRAINT chk_order_history_side CHECK (((side IS NULL) OR ((side)::text = ANY ((ARRAY['BUY'::character varying, 'SELL'::character varying])::text[])))),
    CONSTRAINT chk_order_history_status_actually_changed CHECK (((previous_status IS NULL) OR (new_status IS NULL) OR ((previous_status)::text <> (new_status)::text)))
);


CREATE SEQUENCE public.order_history_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.order_history_history_id_seq OWNED BY public.order_history.history_id;


CREATE TABLE public.orders (
    order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id bigint NOT NULL,
    account_id bigint NOT NULL,
    instrument_id character varying(20) NOT NULL,
    order_type character varying(8) NOT NULL,
    side character varying(4) NOT NULL,
    quantity numeric(18,4) NOT NULL,
    price numeric(18,4) NOT NULL,
    executed_price numeric(18,4),
    status character varying(10) DEFAULT 'NEW'::character varying NOT NULL,
    idempotency_key character varying(100) NOT NULL,
    external_order_id character varying(100),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_orders_executed_price_only_when_filled CHECK ((((status)::text = 'FILLED'::text) OR (executed_price IS NULL))),
    CONSTRAINT chk_orders_executed_price_positive CHECK (((executed_price IS NULL) OR (executed_price > (0)::numeric))),
    CONSTRAINT chk_orders_filled_has_executed_price CHECK ((((status)::text <> 'FILLED'::text) OR (executed_price IS NOT NULL))),
    CONSTRAINT chk_orders_order_type CHECK (((order_type)::text = ANY ((ARRAY['POSITION'::character varying, 'HOLDING'::character varying])::text[]))),
    CONSTRAINT chk_orders_price_positive CHECK ((price > (0)::numeric)),
    CONSTRAINT chk_orders_quantity_positive CHECK ((quantity > (0)::numeric)),
    CONSTRAINT chk_orders_side CHECK (((side)::text = ANY ((ARRAY['BUY'::character varying, 'SELL'::character varying])::text[]))),
    CONSTRAINT chk_orders_status CHECK (((status)::text = 'NEW'::text)),
    CONSTRAINT chk_orders_updated_not_before_created CHECK ((updated_at >= created_at))
);


CREATE TABLE public.portfolio_holding (
    holding_id bigint NOT NULL,
    client_id bigint NOT NULL,
    instrument_id character varying(20) NOT NULL,
    quantity integer NOT NULL,
    price_per_unit numeric(18,4) NOT NULL,
    overall_gains numeric(18,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_portfolio_holding_price_non_negative CHECK ((price_per_unit >= (0)::numeric)),
    CONSTRAINT chk_portfolio_holding_quantity_non_negative CHECK ((quantity >= 0)),
    CONSTRAINT chk_portfolio_holding_updated_not_before_created CHECK ((updated_at >= created_at))
);


CREATE SEQUENCE public.portfolio_holding_holding_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.portfolio_holding_holding_id_seq OWNED BY public.portfolio_holding.holding_id;


CREATE TABLE public.portfolio_positions (
    position_id bigint NOT NULL,
    client_id bigint NOT NULL,
    instrument_id character varying(20) NOT NULL,
    quantity integer NOT NULL,
    price_per_unit numeric(18,4) NOT NULL,
    overall_gains numeric(18,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_portfolio_positions_price_non_negative CHECK ((price_per_unit >= (0)::numeric)),
    CONSTRAINT chk_portfolio_positions_updated_not_before_created CHECK ((updated_at >= created_at))
);


CREATE SEQUENCE public.portfolio_positions_position_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.portfolio_positions_position_id_seq OWNED BY public.portfolio_positions.position_id;


CREATE TABLE public.schema_migrations (
    filename character varying(255) NOT NULL,
    checksum character(64) NOT NULL,
    applied_at timestamp without time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.wallet_transfers (
    transfer_id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id bigint NOT NULL,
    account_number character varying(34) NOT NULL,
    direction character varying(16) NOT NULL,
    amount numeric(18,2) NOT NULL,
    idempotency_key character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_wallet_transfers_amount_positive CHECK ((amount > (0)::numeric)),
    CONSTRAINT chk_wallet_transfers_direction CHECK (((direction)::text = ANY ((ARRAY['BANK_TO_WALLET'::character varying, 'WALLET_TO_BANK'::character varying])::text[])))
);


ALTER TABLE ONLY public.clients ALTER COLUMN client_id SET DEFAULT nextval('public.clients_client_id_seq'::regclass);


ALTER TABLE ONLY public.market_quotes ALTER COLUMN quote_id SET DEFAULT nextval('public.market_quotes_quote_id_seq'::regclass);


ALTER TABLE ONLY public.order_history ALTER COLUMN history_id SET DEFAULT nextval('public.order_history_history_id_seq'::regclass);


ALTER TABLE ONLY public.portfolio_holding ALTER COLUMN holding_id SET DEFAULT nextval('public.portfolio_holding_holding_id_seq'::regclass);


ALTER TABLE ONLY public.portfolio_positions ALTER COLUMN position_id SET DEFAULT nextval('public.portfolio_positions_position_id_seq'::regclass);


ALTER TABLE ONLY auth_db.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


ALTER TABLE ONLY auth_db.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


ALTER TABLE ONLY auth_db.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


ALTER TABLE ONLY auth_db.users
    ADD CONSTRAINT uq_users_account_id UNIQUE (account_id);


ALTER TABLE ONLY auth_db.users
    ADD CONSTRAINT uq_users_email UNIQUE (email);


ALTER TABLE ONLY auth_db.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


ALTER TABLE ONLY auth_db.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


ALTER TABLE ONLY public.bank_account
    ADD CONSTRAINT bank_account_pkey PRIMARY KEY (account_number);


ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (client_id);


ALTER TABLE ONLY public.customer_preferences
    ADD CONSTRAINT customer_preferences_pkey PRIMARY KEY (account_id);


ALTER TABLE ONLY public.daily_candle_syncs
    ADD CONSTRAINT daily_candle_syncs_pkey PRIMARY KEY (instrument_id);


ALTER TABLE ONLY public.daily_candles
    ADD CONSTRAINT daily_candles_pkey PRIMARY KEY (instrument_id, trade_date);


ALTER TABLE ONLY public.instruments
    ADD CONSTRAINT instruments_instrument_name_key UNIQUE (instrument_name);


ALTER TABLE ONLY public.instruments
    ADD CONSTRAINT instruments_pkey PRIMARY KEY (instrument_id);


ALTER TABLE ONLY public.market_quotes
    ADD CONSTRAINT market_quotes_pkey PRIMARY KEY (quote_id);


ALTER TABLE ONLY public.order_history
    ADD CONSTRAINT order_history_pkey PRIMARY KEY (history_id);


ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (order_id);


ALTER TABLE ONLY public.portfolio_holding
    ADD CONSTRAINT portfolio_holding_pkey PRIMARY KEY (holding_id);


ALTER TABLE ONLY public.portfolio_positions
    ADD CONSTRAINT portfolio_positions_pkey PRIMARY KEY (position_id);


ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


ALTER TABLE ONLY public.bank_account
    ADD CONSTRAINT uq_bank_account_client_id UNIQUE (client_id);


ALTER TABLE ONLY public.orders
    ADD CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key);


ALTER TABLE ONLY public.portfolio_holding
    ADD CONSTRAINT uq_portfolio_holding_client_instrument UNIQUE (client_id, instrument_id);


ALTER TABLE ONLY public.portfolio_positions
    ADD CONSTRAINT uq_portfolio_positions_client_instrument UNIQUE (client_id, instrument_id);


ALTER TABLE ONLY public.wallet_transfers
    ADD CONSTRAINT uq_wallet_transfers_idempotency_key UNIQUE (idempotency_key);


ALTER TABLE ONLY public.wallet_transfers
    ADD CONSTRAINT wallet_transfers_pkey PRIMARY KEY (transfer_id);


CREATE INDEX idx_otp_codes_email_purpose ON auth_db.otp_codes USING btree (email, purpose);


CREATE INDEX idx_refresh_tokens_token_hash ON auth_db.refresh_tokens USING btree (token_hash);


CREATE INDEX idx_refresh_tokens_user_id ON auth_db.refresh_tokens USING btree (user_id);


CREATE INDEX idx_users_account_id ON auth_db.users USING btree (account_id);


CREATE INDEX idx_clients_account_state ON public.clients USING btree (account_state);


CREATE INDEX idx_instruments_active ON public.instruments USING btree (active);


CREATE INDEX idx_market_quotes_instrument_received ON public.market_quotes USING btree (instrument_id, received_at DESC);


CREATE INDEX idx_order_history_client_id ON public.order_history USING btree (client_id);


CREATE INDEX idx_order_history_new_status ON public.order_history USING btree (new_status);


CREATE INDEX idx_order_history_order_created_at ON public.order_history USING btree (order_created_at);


CREATE INDEX idx_order_history_order_id ON public.order_history USING btree (order_id, event_timestamp);


CREATE INDEX idx_orders_account_id ON public.orders USING btree (account_id);


CREATE INDEX idx_orders_client_id ON public.orders USING btree (client_id);


CREATE INDEX idx_orders_instrument_id ON public.orders USING btree (instrument_id);


CREATE INDEX idx_orders_order_type ON public.orders USING btree (order_type);


CREATE INDEX idx_orders_status ON public.orders USING btree (status);


CREATE INDEX idx_portfolio_holding_client_id ON public.portfolio_holding USING btree (client_id);


CREATE INDEX idx_portfolio_holding_instrument_id ON public.portfolio_holding USING btree (instrument_id);


CREATE INDEX idx_portfolio_positions_client_id ON public.portfolio_positions USING btree (client_id);


CREATE INDEX idx_portfolio_positions_instrument_id ON public.portfolio_positions USING btree (instrument_id);


CREATE INDEX idx_wallet_transfers_client_id ON public.wallet_transfers USING btree (client_id);


CREATE UNIQUE INDEX uq_order_history_idempotency_key ON public.order_history USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


CREATE TRIGGER trg_clients_no_delete BEFORE DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.fn_clients_state_transition();


CREATE TRIGGER trg_clients_state_transition BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.fn_clients_state_transition();


CREATE TRIGGER trg_instruments_no_delete BEFORE DELETE ON public.instruments FOR EACH ROW EXECUTE FUNCTION public.fn_instruments_no_delete();


ALTER TABLE ONLY auth_db.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth_db.users(id) ON DELETE CASCADE;


ALTER TABLE ONLY auth_db.users
    ADD CONSTRAINT users_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.clients(client_id);


ALTER TABLE ONLY public.customer_preferences
    ADD CONSTRAINT customer_preferences_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.clients(client_id);


ALTER TABLE ONLY public.customer_preferences
    ADD CONSTRAINT customer_preferences_default_account_id_fkey FOREIGN KEY (default_account_id) REFERENCES public.clients(client_id);


ALTER TABLE ONLY public.daily_candle_syncs
    ADD CONSTRAINT daily_candle_syncs_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(instrument_id);


ALTER TABLE ONLY public.daily_candles
    ADD CONSTRAINT daily_candles_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(instrument_id);


ALTER TABLE ONLY public.bank_account
    ADD CONSTRAINT fk_bank_account_client FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


ALTER TABLE ONLY public.market_quotes
    ADD CONSTRAINT market_quotes_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(instrument_id);


ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(instrument_id);


ALTER TABLE ONLY public.portfolio_holding
    ADD CONSTRAINT portfolio_holding_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


ALTER TABLE ONLY public.portfolio_holding
    ADD CONSTRAINT portfolio_holding_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(instrument_id);


ALTER TABLE ONLY public.portfolio_positions
    ADD CONSTRAINT portfolio_positions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


ALTER TABLE ONLY public.portfolio_positions
    ADD CONSTRAINT portfolio_positions_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.instruments(instrument_id);


ALTER TABLE ONLY public.wallet_transfers
    ADD CONSTRAINT wallet_transfers_account_number_fkey FOREIGN KEY (account_number) REFERENCES public.bank_account(account_number);


ALTER TABLE ONLY public.wallet_transfers
    ADD CONSTRAINT wallet_transfers_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id);


\unrestrict HF69wgU9BTU5mZDDFzytA8LWFn9YiUjnuWQa3koDw0cSsO1nTwgFZRfDNJsF7dQ

