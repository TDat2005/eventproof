import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
} from '@nestjs/common';
import { ShopifyAuthService } from '../../../security/shopify-auth.service.js';
import { ConnectionsService } from '../../connections/application/connections.service.js';
import { SettingsService } from '../application/settings.service.js';

@Controller('api/admin')
export class SettingsController {
  constructor(
    private readonly auth: ShopifyAuthService,
    private readonly connections: ConnectionsService,
    private readonly settings: SettingsService,
  ) {}

  @Post('connection')
  async activate(
    @Headers('authorization') authorization: string,
    @Body() body: { timezoneIana: string },
  ) {
    const shop = this.auth.verifyAdmin(authorization);
    const connection = await this.connections.activateConnection(
      shop,
      body?.timezoneIana,
    );
    return { shop, timezoneIana: connection.timezoneIana };
  }

  @Get('settings')
  async get(@Headers('authorization') authorization: string) {
    const shop = this.auth.verifyAdmin(authorization);
    const connection = await this.connections.resolveConnection(shop);
    return this.settings.getSettings(connection.tenantId);
  }

  @Post('settings')
  async save(
    @Headers('authorization') authorization: string,
    @Body() body: Record<string, unknown>,
  ) {
    const shop = this.auth.verifyAdmin(authorization);
    const connection = await this.connections.resolveConnection(shop);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Invalid settings');
    const allowed = [
      'recentEnabled',
      'dailyEnabled',
      'orderEnabled',
      'recentThreshold',
      'dailyThreshold',
      'orderThreshold',
    ];
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.includes(key))
        throw new BadRequestException(`Unknown setting: ${key}`);
      if (
        key.endsWith('Enabled')
          ? typeof value !== 'boolean'
          : !Number.isSafeInteger(value) ||
            Number(value) < 1 ||
            Number(value) > 1_000_000
      ) {
        throw new BadRequestException(`Invalid setting: ${key}`);
      }
    }
    return this.settings.updateSettings({
      ...body,
      tenantId: connection.tenantId,
    });
  }
}
