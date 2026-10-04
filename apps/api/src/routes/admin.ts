import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  adminOverview, AnnouncementBody, AuditQuery, auditLog, BulkBody, bulkUsers, createAnnouncement, deleteAnnouncement, listAnnouncements, clearForecastImport, createUser, dataStatus, importForecast, listOutlets, listUsers, listVehicles, OutletUpdate, PinBody,
  readSettings, ResetBody, resetPassword, resetPin, signOutUser, systemHealth, unlockUser, updateOutlet, updateUser, UserCreate, UserQuery, UserUpdate,
  updateVehicle, VehicleUpdate, writeSettings,
} from '../services/admin.js';
import { guard, IdParam, parse, params } from './util.js';

export async function adminRoutes(app: FastifyInstance) {
  const A = guard.admin;
  /* people */
  app.get('/api/admin/users', A, async req => listUsers(parse(UserQuery, req.query)));
  app.post('/api/admin/users', A, async req => createUser(req.user, parse(UserCreate, req.body)));
  app.patch('/api/admin/users/:id', A, async req => updateUser(req.user, parse(IdParam, req.params).id, parse(UserUpdate, req.body)));
  app.post('/api/admin/users/:id/reset-password', A, async req => resetPassword(req.user, parse(IdParam, req.params).id, parse(ResetBody, req.body)));
  app.post('/api/admin/users/:id/reset-pin', A, async req => resetPin(req.user, parse(IdParam, req.params).id, parse(PinBody, req.body)));
  app.post('/api/admin/users/:id/unlock', A, async req => unlockUser(req.user, parse(IdParam, req.params).id));
  app.post('/api/admin/users/bulk', A, async req => bulkUsers(req.user, parse(BulkBody, req.body)));
  app.post('/api/admin/users/:id/sign-out', A, async req => signOutUser(req.user, parse(IdParam, req.params).id));
  /* fleet and outlets */
  app.get('/api/admin/vehicles', A, async () => listVehicles());
  app.patch('/api/admin/vehicles/:id', A, async req => updateVehicle(req.user, params(req).id, parse(VehicleUpdate, req.body)));
  app.get('/api/admin/outlets', A, async () => listOutlets());
  app.patch('/api/admin/outlets/:id', A, async req => updateOutlet(req.user, params(req).id, parse(OutletUpdate, req.body)));
  /* settings */
  app.get('/api/admin/settings', A, async () => readSettings());
  app.put('/api/admin/settings/:key', A, async req => {
    const { key } = parse(z.object({ key: z.enum(['rules', 'operations']) }), req.params);
    return writeSettings(req.user, key, parse(z.record(z.any()), req.body));
  });
  /* data */
  app.get('/api/admin/data', A, async () => dataStatus());
  app.post('/api/admin/data/forecast', { ...A, bodyLimit: 3 * 1024 * 1024 }, async req => importForecast(req.user, parse(z.object({ csv: z.string().min(10, 'The file is empty.') }), req.body).csv));
  app.delete('/api/admin/data/forecast', A, async req => clearForecastImport(req.user));
  /* overview and announcements */
  app.get('/api/admin/overview', A, async () => adminOverview());
  app.get('/api/admin/announcements', A, async () => listAnnouncements());
  app.post('/api/admin/announcements', A, async req => createAnnouncement(req.user, parse(AnnouncementBody, req.body)));
  app.delete('/api/admin/announcements/:id', A, async req => deleteAnnouncement(req.user, parse(IdParam, req.params).id));
  /* audit and system */
  app.get('/api/admin/audit', A, async req => auditLog(parse(AuditQuery, req.query)));
  app.get('/api/admin/system', A, async () => systemHealth());
}
