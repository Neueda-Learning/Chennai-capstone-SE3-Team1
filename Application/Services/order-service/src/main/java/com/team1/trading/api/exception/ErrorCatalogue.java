package com.team1.trading.api.exception;

import org.springframework.http.HttpStatus;

import java.util.Collections;
import java.util.Map;

public final class ErrorCatalogue {

    public static final String ACC_404 = "ACC-404";
    public static final String ACC_403 = "ACC-403";
    public static final String ACC_409 = "ACC-409";
    public static final String INS_404 = "INS-404";
    public static final String ORD_400 = "ORD-400";
    public static final String ORD_409 = "ORD-409";
    public static final String VAL_422 = "VAL-422";
    public static final String TRF_400 = "TRF-400";
    public static final String TRF_409 = "TRF-409";
    public static final String AUTH_401 = "AUTH-401";
    public static final String PRF_404 = "PRF-404";
    public static final String PRF_422 = "PRF-422";
    public static final String WLT_404 = "WLT-404";
    public static final String WLT_409 = "WLT-409";
    public static final String WLT_422 = "WLT-422";
    public static final String WLT_429 = "WLT-429";
    public static final String COND_422 = "COND-422";
    public static final String COND_429 = "COND-429";


    public static final String INTERNAL_500 = "INTERNAL-500";

    private static final Map<String, HttpStatus> STATUS_BY_CODE = Map.ofEntries(
            Map.entry(ACC_404, HttpStatus.NOT_FOUND),
            Map.entry(ACC_403, HttpStatus.FORBIDDEN),
            Map.entry(ACC_409, HttpStatus.CONFLICT),
            Map.entry(INS_404, HttpStatus.NOT_FOUND),
            Map.entry(ORD_400, HttpStatus.BAD_REQUEST),
            Map.entry(ORD_409, HttpStatus.CONFLICT),
            Map.entry(VAL_422, HttpStatus.UNPROCESSABLE_ENTITY),
            Map.entry(TRF_400, HttpStatus.BAD_REQUEST),
            Map.entry(TRF_409, HttpStatus.CONFLICT),
            Map.entry(AUTH_401, HttpStatus.UNAUTHORIZED),
            Map.entry(PRF_404, HttpStatus.NOT_FOUND),
            Map.entry(PRF_422, HttpStatus.UNPROCESSABLE_ENTITY),
            Map.entry(WLT_404, HttpStatus.NOT_FOUND),
            Map.entry(WLT_409, HttpStatus.CONFLICT),
            Map.entry(WLT_422, HttpStatus.UNPROCESSABLE_ENTITY),
            Map.entry(WLT_429, HttpStatus.TOO_MANY_REQUESTS),
            Map.entry(COND_422, HttpStatus.UNPROCESSABLE_ENTITY),
            Map.entry(COND_429, HttpStatus.TOO_MANY_REQUESTS),
            Map.entry(INTERNAL_500, HttpStatus.INTERNAL_SERVER_ERROR)
    );

    private ErrorCatalogue() {
    }

    public static HttpStatus statusFor(String errorCode) {
        return STATUS_BY_CODE.getOrDefault(errorCode, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    public static Map<String, HttpStatus> asMap() {
        return Collections.unmodifiableMap(STATUS_BY_CODE);
    }
}