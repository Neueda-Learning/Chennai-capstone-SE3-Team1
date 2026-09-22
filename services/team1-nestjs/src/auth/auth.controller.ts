import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { CredentialService } from './credential.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly credentialService: CredentialService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new credentials' })
  @ApiBody({ schema: { properties: { email: { type: 'string' }, password: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Credential created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async register(@Body() body: { email: string; password: string }) {
    return this.credentialService.register(body.email, body.password);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with credentials' })
  @ApiBody({ schema: { properties: { email: { type: 'string' }, password: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Rate limited' })
  async login(@Body() body: { email: string; password: string }) {
    return this.credentialService.login(body.email, body.password);
  }
}