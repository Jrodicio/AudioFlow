import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'),process.argv.slice(2),{env,windowsHide:true,stdio:'inherit'});
child.on('error',error => { console.error(error);process.exitCode=1; });
child.on('exit',code => { process.exitCode=code ?? 1; });
process.on('SIGINT',() => child.kill());
process.on('SIGTERM',() => child.kill());
