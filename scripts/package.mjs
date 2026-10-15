import { createRequire } from 'node:module';
import path from 'node:path';
import { build, Platform, Arch } from 'electron-builder';

const require = createRequire(import.meta.url);
// Keep downloaded packaging tools alongside the project, also in restricted
// build environments. An explicit caller-supplied cache still takes precedence.
process.env.ELECTRON_BUILDER_CACHE ??= path.resolve('.cache/electron-builder');
// Reuse the exact installed runtime (and trigger Electron's initial download if
// necessary). This avoids downloading another copy and Windows archive-folder
// rename failures during repeated packaging.
const electron = require('electron');
await build({
  targets: Platform.WINDOWS.createTarget(process.argv.includes('--dir') ? ['dir'] : ['nsis', 'portable'], Arch.x64),
  config: { electronDist: path.dirname(electron) },
});
