import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
import path from 'node:path';
const libs=path.resolve('.runtime/browser-libs/usr/lib/x86_64-linux-gnu');
if(existsSync(libs))process.env.LD_LIBRARY_PATH=[libs,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
export default defineConfig({testDir:'./tests',testMatch:'**/*.spec.js',workers:1,webServer:{command:'npm run start',url:'http://localhost:4317/api/session',reuseExistingServer:!process.env.CI,timeout:30000},use:{headless:true},reporter:'list'});
