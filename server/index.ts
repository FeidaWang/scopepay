import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
try { process.loadEnvFile('.env'); } catch { /* Configuration is optional in Example mode. */ }
const { createApp } = await import('./app.js');
const { app, store } = createApp();
const client = resolve('dist/client');
if (existsSync(client)) { app.use(express.static(client)); app.get('/{*path}', (_req, res) => res.sendFile(resolve(client, 'index.html'))); }
const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`ScopePay is ready on port ${process.env.PORT || 3000}.`));
const stop = () => { server.close(() => { store.close(); process.exit(0); }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
