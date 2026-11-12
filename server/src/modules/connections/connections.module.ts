import { Module } from '@nestjs/common';
import { CONNECTIONS_REPOSITORY } from './domain/connections.repository.port.js';
import { DrizzleConnectionsRepository } from './infrastructure/drizzle-connections.repository.js';
import { ConnectionsService } from './application/connections.service.js';

@Module({
  providers: [
    {
      provide: CONNECTIONS_REPOSITORY,
      useClass: DrizzleConnectionsRepository,
    },
    ConnectionsService,
  ],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
