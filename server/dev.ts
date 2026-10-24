import { createServer as createHttpServer } from 'node:http';
try { process.loadEnvFile('.env'); } catch { /* Example mode needs no credentials. */ }
const { createApp } = await import('./app.js');
const { createServer } = await import('vite');
const { app, store } = createApp();
const server = createHttpServer(app);
const portOption = process.argv.indexOf('--port');
const port = Number(portOption >= 0 ? process.argv[portOption + 1] : process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a valid development port.');
const allowedHosts = (process.env.DEV_ALLOWED_HOSTS || '').split(',').map(host => host.trim()).filter(Boolean);
const vite = await createServer({ server: { middlewareMode: true, allowedHosts, hmr: { server } }, appType: 'spa' });
app.use(vite.middlewares);
server.listen(port, '0.0.0.0', () => console.log(`ScopePay development server ready on port ${port}.`));
const stop = () => { server.close(() => { void vite.close(); store.close(); process.exit(0); }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
