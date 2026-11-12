import { Module } from '@nestjs/common';
import { SETTINGS_REPOSITORY } from './domain/settings.repository.port.js';
import { DrizzleSettingsRepository } from './infrastructure/drizzle-settings.repository.js';
import { SettingsService } from './application/settings.service.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { SettingsController } from './presentation/settings.controller.js';

@Module({
  imports: [ConnectionsModule],
  controllers: [SettingsController],
  providers: [
    {
      provide: SETTINGS_REPOSITORY,
      useClass: DrizzleSettingsRepository,
    },
    SettingsService,
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
