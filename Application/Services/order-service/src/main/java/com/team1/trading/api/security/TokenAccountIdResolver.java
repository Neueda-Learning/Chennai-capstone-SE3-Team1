package com.team1.trading.api.security;

public interface TokenAccountIdResolver {

    Long resolve(String authorizationHeader);
}