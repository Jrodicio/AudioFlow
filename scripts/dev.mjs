import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const server = await createServer();
await server.listen();
server.printUrls();
const env = { ...process.env, AUDIOFLOW_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.'], { stdio: 'inherit', env, windowsHide: true });
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => void close(code ?? 0));
child.on('error', (error) => { console.error(error); void close(1); });
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
