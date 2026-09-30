import type { FastifyInstance } from 'fastify';
import { adminRoutes } from './admin.js';
import { authRoutes } from './auth.js';
import { dispatcherRoutes } from './dispatcher.js';
import { driverRoutes } from './driver.js';
import { eventRoutes } from './events.js';
import { fileRoutes } from './files.js';
import { loaderRoutes } from './loader.js';
import { sharedRoutes } from './shared.js';
import { storeRoutes } from './store.js';

export async function routes(app: FastifyInstance) {
  await app.register(authRoutes);
  await app.register(sharedRoutes);
  await app.register(eventRoutes);
  await app.register(fileRoutes);
  await app.register(dispatcherRoutes);
  await app.register(loaderRoutes);
  await app.register(driverRoutes);
  await app.register(storeRoutes);
  await app.register(adminRoutes);
}
