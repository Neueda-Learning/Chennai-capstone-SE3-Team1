import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService, AccessTokenClaims } from './token.service';
import { Role } from './dto/role';
import { RegisterRequestDto } from './dto/register-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { TokenResponseDto } from './dto/token-response.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    me: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      me: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        JwtAuthGuard,
        { provide: TokenService, useValue: { verifyAccessToken: jest.fn() } },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  it('delegates register and returns the UserResponseDto', async () => {
    const body = new RegisterRequestDto();
    body.username = 'priya.menon';
    body.password = 'correct horse battery staple';
    body.email = 'priya.menon@example.com';

    const expected: UserResponseDto = {
      id: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
      username: 'priya.menon',
      email: 'priya.menon@example.com',
      phone: null,
      accountId: 1,
      roles: [Role.CUSTOMER],
      createdOn: new Date(),
    };
    authService.register.mockResolvedValue(expected);

    await expect(controller.register(body)).resolves.toBe(expected);
    expect(authService.register).toHaveBeenCalledWith(body);
  });

  it('delegates login and returns the TokenResponseDto', async () => {
    const body = new LoginRequestDto();
    body.username = 'priya.menon';
    body.password = 'correct horse battery staple';

    const expected: TokenResponseDto = {
      accessToken: 'a.b.c',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
      expiresIn: 900,
    };
    authService.login.mockResolvedValue(expected);

    await expect(controller.login(body)).resolves.toBe(expected);
    expect(authService.login).toHaveBeenCalledWith(body);
  });

  it('delegates refresh and returns the TokenResponseDto', async () => {
    const body = new RefreshRequestDto();
    body.refreshToken = 'some-refresh-token';

    const expected: TokenResponseDto = {
      accessToken: 'a.b.c',
      refreshToken: 'new-refresh',
      tokenType: 'Bearer',
      expiresIn: 900,
    };
    authService.refresh.mockResolvedValue(expected);

    await expect(controller.refresh(body)).resolves.toBe(expected);
    expect(authService.refresh).toHaveBeenCalledWith(body);
  });

  it('delegates me with the verified token identity', async () => {
    const identity: AccessTokenClaims = {
      sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f',
      accountId: 1,
      roles: [Role.CUSTOMER],
      iat: 1790000000,
      exp: 1790000900,
      iss: 'auth-service',
    };
    const expected: UserResponseDto = {
      id: identity.sub,
      username: 'priya.menon',
      email: 'priya.menon@example.com',
      phone: null,
      accountId: 1,
      roles: [Role.CUSTOMER],
      createdOn: new Date(),
    };
    authService.me.mockResolvedValue(expected);

    await expect(controller.me({ user: identity })).resolves.toBe(expected);
    expect(authService.me).toHaveBeenCalledWith(identity);
  });
});
