import {randomBytes,createHmac} from 'node:crypto';
import {storage} from './storage.mjs';
let memo,validUntil=0;
export async function config(){
 if(memo&&Date.now()<validUntil)return memo;
 if(process.env.CONFIG_PARAMETER){const {SSMClient,GetParametersCommand}=await import('@aws-sdk/client-ssm');const r=await new SSMClient({}).send(new GetParametersCommand({Names:[process.env.CONFIG_PARAMETER,process.env.ORIGIN_PARAMETER],WithDecryption:true}));const values=Object.fromEntries(r.Parameters.map(p=>[p.Name,p.Value]));const secret=JSON.parse(values[process.env.CONFIG_PARAMETER]);memo={key:secret.steamApiKey,salt:secret.aliasSalt,origin:values[process.env.ORIGIN_PARAMETER],allowlist:secret.allowedSteamIds||[]};if(!memo.key||!memo.salt||!memo.origin)throw new Error('Hosting-Konfiguration fehlt.');validUntil=Date.now()+300000;return memo;}
 const db=await storage();let salt=await db.get('local-config','salt');if(!salt){salt=randomBytes(32).toString('hex');await db.put('local-config','salt',salt,10*365*86400);}
 validUntil=Date.now()+300000;return memo={key:process.env.STEAM_API_KEY,salt,origin:process.env.APP_ORIGIN||`http://localhost:${process.env.PORT||4317}`,allowlist:[]};
}
export function userAlias(steamid,salt){return createHmac('sha256',salt).update(steamid).digest('hex');}
