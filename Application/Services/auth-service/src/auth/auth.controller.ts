import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CredentialCryptoService } from './crypto/credential-crypto.service';
import { CryptoParamsResponseDto } from './crypto/crypto-params-response.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AccessTokenClaims } from './token.service';
import { RegisterRequestDto } from './dto/register-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { TokenResponseDto } from './dto/token-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly credentialCrypto: CredentialCryptoService,
  ) {}

  @Get('crypto-params')
  @ApiOperation({
    summary: 'Get the public key and a one-time nonce for encrypting a request',
    description:
      'Every POST under /auth must be sent as an encrypted envelope { v, nonce, ek, iv, ct } ' +
      '(the request schemas below describe the decrypted body). Encrypt the JSON body with ' +
      'AES-256-GCM using the nonce as additional authenticated data, and wrap the AES key with ' +
      'RSA-OAEP (SHA-256). The response is encrypted the same way, as { v, iv, ct }. A nonce ' +
      'works once and for 60 seconds.',
  })
  @ApiResponse({ status: 200, type: CryptoParamsResponseDto })
  cryptoParams(): CryptoParamsResponseDto {
    return this.credentialCrypto.issueParams();
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a user' })
  @ApiResponse({
    status: 201,
    type: UserResponseDto,
    description: 'User created',
  })
  @ApiResponse({ status: 409, description: 'The username is already taken' })
  @ApiResponse({
    status: 422,
    description: 'The request failed field validation',
  })
  async register(@Body() body: RegisterRequestDto): Promise<UserResponseDto> {
    return this.authService.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and receive tokens' })
  @ApiResponse({
    status: 200,
    type: TokenResponseDto,
    description: 'Authenticated',
  })
  @ApiResponse({ status: 401, description: 'Authentication failed' })
  @ApiResponse({
    status: 422,
    description: 'The request failed field validation',
  })
  async login(@Body() body: LoginRequestDto): Promise<TokenResponseDto> {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  @ApiResponse({
    status: 200,
    type: TokenResponseDto,
    description: 'A new token pair',
  })
  @ApiResponse({ status: 401, description: 'Authentication failed' })
  @ApiResponse({
    status: 422,
    description: 'The request failed field validation',
  })
  async refresh(@Body() body: RefreshRequestDto): Promise<TokenResponseDto> {
    return this.authService.refresh(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke the caller's current refresh token" })
  @ApiResponse({ status: 200, description: 'Logged out' })
  @ApiResponse({ status: 401, description: 'Authentication failed' })
  @ApiResponse({
    status: 422,
    description: 'The request failed field validation',
  })
  async logout(
    @Request() request: { user: AccessTokenClaims },
    @Body() body: RefreshRequestDto,
  ): Promise<void> {
    await this.authService.logout(request.user, body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user' })
  @ApiResponse({
    status: 200,
    type: UserResponseDto,
    description: 'The authenticated user',
  })
  @ApiResponse({ status: 401, description: 'Authentication failed' })
  async me(
    @Request() request: { user: AccessTokenClaims },
  ): Promise<UserResponseDto> {
    return this.authService.me(request.user);
  }
}
