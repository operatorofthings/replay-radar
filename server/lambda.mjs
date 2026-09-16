import serverlessExpress from '@codegenie/serverless-express';
import {createApp} from './app.mjs';
export {worker} from './jobs.mjs';
let instance,validUntil=0;
export async function handler(event,context){if(!instance||Date.now()>validUntil){instance=createApp().then(app=>serverlessExpress({app}));validUntil=Date.now()+300000;}return (await instance)(event,context);}
