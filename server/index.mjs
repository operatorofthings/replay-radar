import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {createApp} from './app.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const app=await createApp();
if(process.argv.includes('--production')){app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));}
else {const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
app.listen(Number(process.env.PORT||4317),'127.0.0.1',()=>console.log(`Replay Radar: ${process.env.APP_ORIGIN||'http://localhost:4317'}`));
