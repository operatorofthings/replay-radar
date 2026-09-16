import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('.build/lambda',{recursive:true});
await build({entryPoints:['server/lambda.mjs'],outfile:'.build/lambda/index.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',minify:false,sourcemap:false,logLevel:'info'});
