import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();

  // Enable CORS for storefront Theme and Web Pixel requests
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: false,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Event-Proof Server running on http://localhost:${port}`);
}
bootstrap().catch((error: unknown) => {
  console.error('Event-Proof failed to start:', error);
  process.exitCode = 1;
});
