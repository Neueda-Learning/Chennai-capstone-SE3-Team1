package com.team1.trading.api.security;

import com.jayway.jsonpath.JsonPath;
import com.team1.trading.api.advice.AdviceController;
import com.team1.trading.api.advice.AdviceService;
import com.team1.trading.api.conditional.ConditionalOrderController;
import com.team1.trading.api.conditional.ConditionalOrderQueries;
import com.team1.trading.api.service.OrderService;
import com.team1.trading.api.controller.AccountController;
import com.team1.trading.api.mapper.AccountMapper;
import com.team1.trading.api.mapper.AccountMapper.AccountRow;
import com.team1.trading.api.mapper.NotificationMapper;
import com.team1.trading.api.mapper.OrderMapper;
import com.team1.trading.api.mapper.PositionMapper;
import com.team1.trading.api.notifications.NotificationHistoryController;
import com.team1.trading.api.notifications.NotificationHistoryService;
import com.team1.trading.api.preferences.PreferenceController;
import com.team1.trading.api.preferences.PreferenceService;
import com.team1.trading.api.service.AccountService;
import com.team1.trading.api.watchlists.AlertController;
import com.team1.trading.api.watchlists.AlertService;
import com.team1.trading.api.watchlists.WatchlistController;
import com.team1.trading.api.watchlists.WatchlistService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verifyNoInteractions;

@WebMvcTest(controllers = {PreferenceController.class, NotificationHistoryController.class,
        WatchlistController.class, AlertController.class, AccountController.class, AdviceController.class,
        ConditionalOrderController.class},
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtVerificationFilter.class))
@Import({AccessGuard.class, AccountService.class, HeaderTokenAccountIdResolver.class})
@TestPropertySource(properties = {
        "jwt.secret=test-secret-key",
        "jwt.issuer=auth-service",
        "spring.datasource.url=jdbc:h2:mem:routeauth;DB_CLOSE_DELAY=-1"
})
@DisplayName("Preferences, Notifications, Watchlists, Portfolio, Advice and Conditional orders authorise every account route against the token")
class ModuleRouteAuthorisationTest {

    private static final String LIST_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
    private static final String ALERT_ID = "0b9c7a2e-5f0e-4a54-9d51-3b1f5b7a9c01";

    private static final Map<String, String> BODIES = Map.of(
            "PUT /api/v1/accounts/{accountId}/preferences", "{\"defaultAccountId\":1,\"channel\":\"EMAIL\"}",
            "POST /api/v1/accounts/{accountId}/watchlists", "{\"name\":\"Banks\"}",
            "POST /api/v1/accounts/{accountId}/watchlists/{watchlistId}/instruments", "{\"symbol\":\"TCS\"}",
            "POST /api/v1/accounts/{accountId}/alerts",
            "{\"symbol\":\"TCS\",\"threshold\":3500.50,\"direction\":\"ABOVE\"}",
            "PATCH /api/v1/accounts/{accountId}/alerts/{alertId}", "{\"state\":\"ARMED\"}");

    private static final Set<String> EXPECTED = Set.of(
            "GET /api/v1/accounts/{accountId}/preferences",
            "PUT /api/v1/accounts/{accountId}/preferences",
            "GET /api/v1/accounts/{accountId}/notification-history",
            "GET /api/v1/accounts/{accountId}/watchlists",
            "POST /api/v1/accounts/{accountId}/watchlists",
            "DELETE /api/v1/accounts/{accountId}/watchlists/{watchlistId}",
            "POST /api/v1/accounts/{accountId}/watchlists/{watchlistId}/instruments",
            "DELETE /api/v1/accounts/{accountId}/watchlists/{watchlistId}/instruments/{symbol}",
            "GET /api/v1/accounts/{accountId}/alerts",
            "POST /api/v1/accounts/{accountId}/alerts",
            "PATCH /api/v1/accounts/{accountId}/alerts/{alertId}",
            "DELETE /api/v1/accounts/{accountId}/alerts/{alertId}",
            "GET /api/v1/accounts/{id}",
            "GET /api/v1/accounts/{id}/balance",
            "GET /api/v1/accounts/{id}/portfolio",
            "GET /api/v1/accounts/{id}/orders",
            "GET /api/v1/accounts/{id}/notifications",
            "GET /api/v1/accounts/{accountId}/advice",
            "GET /api/v1/accounts/{accountId}/advice/{symbol}",
            "GET /api/v1/accounts/{accountId}/conditional-orders");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private RequestMappingHandlerMapping handlerMapping;

    @MockitoBean
    private PreferenceService preferenceService;
    @MockitoBean
    private NotificationHistoryService notificationHistoryService;
    @MockitoBean
    private WatchlistService watchlistService;
    @MockitoBean
    private AlertService alertService;
    @MockitoBean
    private AdviceService adviceService;
    @MockitoBean
    private ConditionalOrderQueries conditionalOrderQueries;
    @MockitoBean
    private OrderService orderService;
    @MockitoBean
    private AccountMapper accountMapper;
    @MockitoBean
    private OrderMapper orderMapper;
    @MockitoBean
    private PositionMapper positionMapper;
    @MockitoBean
    private NotificationMapper notificationMapper;

    @BeforeEach
    void accountOneExists() {
        AccountRow row = new AccountRow();
        row.setClientId(1L);
        row.setAccountNumber("IN45TEST0000000000001");
        row.setName("Test Trader");
        row.setBankName("Test Bank");
        row.setAccountState("ACTIVE");
        row.setWalletBalance(new BigDecimal("1000.00"));
        row.setCreatedOn(LocalDateTime.now());
        row.setUpdatedOn(LocalDateTime.now());
        row.setVersion(0);
        given(accountMapper.findRow(any())).willReturn(Optional.of(row));
    }

    @AfterEach
    void clearContext() {
        JwtRequestContext.clear();
    }

    private record Route(String method, String pattern) {
        String key() {
            return method + " " + pattern;
        }

        String uri() {
            String uri = pattern.replace("{accountId}", "1").replace("{id}", "1")
                    .replace("{watchlistId}", LIST_ID).replace("{alertId}", ALERT_ID).replace("{symbol}", "TCS");
            assertThat(uri).as("a path variable in %s has no sample value", pattern).doesNotContain("{");
            return uri;
        }
    }

    private List<Route> accountRoutes() {
        TreeSet<Route> found = new TreeSet<>(java.util.Comparator.comparing(Route::key));
        for (RequestMappingInfo info : handlerMapping.getHandlerMethods().keySet()) {
            for (String pattern : info.getPathPatternsCondition().getPatternValues()) {
                if (!pattern.startsWith("/api/v1/accounts/{")) {
                    continue;
                }
                for (RequestMethod method : info.getMethodsCondition().getMethods()) {
                    found.add(new Route(method.name(), pattern));
                }
            }
        }
        return List.copyOf(found);
    }

    private static void signedInAs(long accountId, String role) {
        JwtRequestContext.setClaims(new JwtClaims("user-" + accountId, accountId, List.of(role),
                Instant.now(), Instant.now().plusSeconds(900), "auth-service"));
    }

    private static String bearer(long accountId) {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String header = encoder.encodeToString("{\"alg\":\"HS256\"}".getBytes(StandardCharsets.UTF_8));
        String claims = encoder.encodeToString(("{\"accountId\":" + accountId + "}").getBytes(StandardCharsets.UTF_8));
        return "Bearer " + header + "." + claims + ".signature";
    }

    private MvcResult call(Route route, Long tokenAccountId) throws Exception {
        MockHttpServletRequestBuilder request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .request(HttpMethod.valueOf(route.method()), route.uri());
        if (tokenAccountId != null) {
            request.header("Authorization", bearer(tokenAccountId));
        }
        if (!route.method().equals("GET") && !route.method().equals("DELETE")) {
            String body = BODIES.get(route.key());
            assertThat(body).as("add a sample request body for the new route %s", route.key()).isNotNull();
            request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(request).andReturn();
    }

    private static String errorCode(MvcResult result) throws Exception {
        return JsonPath.read(result.getResponse().getContentAsString(), "$.errorCode");
    }

    private void nothingBehindTheGuardWasReached() {
        verifyNoInteractions(preferenceService, notificationHistoryService, watchlistService, alertService,
                adviceService, conditionalOrderQueries, orderService, orderMapper, positionMapper, notificationMapper);
    }

    @Test
    @DisplayName("The routes found in the running mapping are the ones the four modules are expected to have")
    void everyAccountRouteIsKnown() {
        Set<String> found = new TreeSet<>();
        accountRoutes().forEach(route -> found.add(route.key()));

        assertThat(found).containsExactlyInAnyOrderElementsOf(EXPECTED);
    }

    @Test
    @DisplayName("Another customer's token is ACC-403 on every route and nothing behind the guard is reached")
    void anotherCustomersToken() throws Exception {
        signedInAs(2L, "CUSTOMER");
        for (Route route : accountRoutes()) {
            MvcResult result = call(route, 2L);

            assertThat(result.getResponse().getStatus()).as(route.key()).isEqualTo(403);
            assertThat(errorCode(result)).as(route.key()).isEqualTo("ACC-403");
        }
        nothingBehindTheGuardWasReached();
    }

    @Test
    @DisplayName("An ADMIN token for a different account gets no bypass on any route")
    void adminTokenHasNoBypass() throws Exception {
        signedInAs(9L, "ADMIN");
        for (Route route : accountRoutes()) {
            MvcResult result = call(route, 9L);

            assertThat(result.getResponse().getStatus()).as(route.key()).isEqualTo(403);
            assertThat(errorCode(result)).as(route.key()).isEqualTo("ACC-403");
        }
        nothingBehindTheGuardWasReached();
    }

    @Test
    @DisplayName("No verified token is never answered with data on any route")
    void noToken() throws Exception {
        for (Route route : accountRoutes()) {
            MvcResult result = call(route, null);

            assertThat(result.getResponse().getStatus()).as(route.key()).isIn(401, 403);
            assertThat(errorCode(result)).as(route.key()).isIn("AUTH-401", "ACC-403");
        }
        nothingBehindTheGuardWasReached();
    }
}
