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
import { EmailRequestDto } from './dto/email-request.dto';
import { VerifyOtpRequestDto } from './dto/verify-otp-request.dto';
import { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import {
  OtpSentResponseDto,
  OtpVerifiedResponseDto,
  PasswordResetResponseDto,
} from './dto/otp-response.dto';

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

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the emailed registration code and activate the account',
  })
  @ApiResponse({
    status: 200,
    type: OtpVerifiedResponseDto,
    description: 'The account is now ACTIVE and can sign in',
  })
  @ApiResponse({
    status: 410,
    description: 'The code is wrong, spent or expired',
  })
  @ApiResponse({
    status: 422,
    description: 'The request failed field validation',
  })
  async verifyOtp(
    @Body() body: VerifyOtpRequestDto,
  ): Promise<OtpVerifiedResponseDto> {
    return this.authService.verifyOtp(body);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email a password-reset code',
    description:
      'Always answers 200, whether or not the address has an account, so this route cannot be used to discover which emails exist.',
  })
  @ApiResponse({
    status: 200,
    type: OtpSentResponseDto,
    description: 'Accepted',
  })
  @ApiResponse({
    status: 422,
    description: 'The request failed field validation',
  })
  async forgotPassword(
    @Body() body: EmailRequestDto,
  ): Promise<OtpSentResponseDto> {
    return this.authService.forgotPassword(body);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-send the registration code, replacing any earlier one',
    description: 'Always answers 200, so it reveals nothing about the address.',
  })
  @ApiResponse({
    status: 200,
    type: OtpSentResponseDto,
    description: 'Accepted',
  })
  @ApiResponse({
    status: 422,
    description: 'The request failed field validation',
  })
  async resendOtp(@Body() body: EmailRequestDto): Promise<OtpSentResponseDto> {
    return this.authService.resendOtp(body);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password using an emailed code',
  })
  @ApiResponse({
    status: 200,
    type: PasswordResetResponseDto,
    description: 'Password changed; every session revoked',
  })
  @ApiResponse({
    status: 410,
    description: 'The code is wrong, spent or expired',
  })
  @ApiResponse({
    status: 422,
    description:
      'The new password failed the policy, or the body failed field validation',
  })
  async resetPassword(
    @Body() body: ResetPasswordRequestDto,
  ): Promise<PasswordResetResponseDto> {
    return this.authService.resetPassword(body);
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
