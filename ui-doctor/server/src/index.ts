import { buildApp } from './app.js';
import { closeBrowser } from './capture/browser.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app, service } = await buildApp({ config });

if (config.allowPrivateHosts.size > 0) {
  app.log.warn({ hosts: [...config.allowPrivateHosts] }, 'UIDOCTOR_ALLOW_PRIVATE_HOSTS ativo: use apenas em desenvolvimento/testes');
}
if (!config.chromiumSandbox) {
  app.log.warn('Sandbox do Chromium desativado. Em produção, rode como usuário não-root com UIDOCTOR_CHROMIUM_SANDBOX=true.');
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'encerrando');
  await app.close();
  await Promise.race([service.queue.onIdle(), new Promise((r) => setTimeout(r, 10_000))]);
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
