import { Module } from '@nestjs/common';
import { CONNECTIONS_REPOSITORY } from './domain/connections.repository.port.js';
import { DrizzleConnectionsRepository } from './infrastructure/drizzle-connections.repository.js';
import { ConnectionsService } from './application/connections.service.js';
import {
  UninstallCleanupService,
  UninstallCleanupJob,
} from './application/uninstall-cleanup.service.js';

@Module({
  providers: [
    {
      provide: CONNECTIONS_REPOSITORY,
      useClass: DrizzleConnectionsRepository,
    },
    ConnectionsService,
    UninstallCleanupService,
    UninstallCleanupJob,
  ],
  exports: [ConnectionsService, UninstallCleanupService],
})
export class ConnectionsModule {}
