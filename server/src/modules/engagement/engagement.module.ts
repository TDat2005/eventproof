import { Module } from '@nestjs/common';
import {
  VIEW_REPOSITORY,
  PRESENCE_TRACKER,
} from './domain/engagement.ports.js';
import { DrizzleViewRepository } from './infrastructure/drizzle-view.repository.js';
import { RedisPresenceTracker } from './infrastructure/redis-presence.tracker.js';
import { ViewTrackerService } from './application/view-tracker.service.js';
import { EngagementController } from './presentation/engagement.controller.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';

@Module({
  imports: [ConnectionsModule, CatalogModule],
  controllers: [EngagementController],
  providers: [
    {
      provide: VIEW_REPOSITORY,
      useClass: DrizzleViewRepository,
    },
    {
      provide: PRESENCE_TRACKER,
      useClass: RedisPresenceTracker,
    },
    ViewTrackerService,
  ],
  exports: [ViewTrackerService],
})
export class EngagementModule {}
