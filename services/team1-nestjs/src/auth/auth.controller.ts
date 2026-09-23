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
  constructor(private readonly authService: AuthService) {}

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
