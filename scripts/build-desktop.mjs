import {build} from 'esbuild';
await build({entryPoints: ['electron/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'app-desktop/main.cjs', external: ['electron', 'electron-updater']});
await build({entryPoints: ['electron/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'app-desktop/preload.cjs', external: ['electron']});
