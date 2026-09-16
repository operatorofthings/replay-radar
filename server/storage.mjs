import {mkdir,readFile,writeFile,rename,unlink,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import path from 'node:path';

export const DAY=86400, RETENTION=7*DAY;
const epoch=()=>Math.floor(Date.now()/1000);
export class FileStore {
  constructor(directory='.cache/state'){this.directory=directory;this.tail=Promise.resolve();}
  file(pk,sk){return path.join(this.directory,createHash('sha256').update(JSON.stringify([pk,sk])).digest('hex')+'.json');}
  async get(pk,sk){try{const r=JSON.parse(await readFile(this.file(pk,sk),'utf8'));if(r.expiresAt<=epoch()){await this.delete(pk,sk);return null;}return r.value;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async put(pk,sk,value,ttl=RETENTION){await mkdir(this.directory,{recursive:true,mode:0o700});const file=this.file(pk,sk),tmp=file+'.'+randomUUID();await writeFile(tmp,JSON.stringify({pk,sk,value,expiresAt:epoch()+ttl}),{mode:0o600});await rename(tmp,file);}
  async delete(pk,sk){await unlink(this.file(pk,sk)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  exclusive(fn){const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;}
  claim(pk,sk,value,ttl){return this.exclusive(async()=>{if(await this.get(pk,sk))return false;await this.put(pk,sk,value,ttl);return true;});}
  take(pk,sk){return this.exclusive(async()=>{const value=await this.get(pk,sk);await this.delete(pk,sk);return value;});}
  async list(pk,prefix){let files;try{files=await readdir(this.directory);}catch(e){if(e.code==='ENOENT')return [];throw e;}const result=[];for(const file of files.filter(f=>f.endsWith('.json'))){try{const r=JSON.parse(await readFile(path.join(this.directory,file),'utf8'));if(r.expiresAt<=epoch()){await this.delete(r.pk,r.sk);continue;}if(r.pk===pk&&r.sk.startsWith(prefix))result.push(r.value);}catch(e){if(e.code!=='ENOENT')throw e;}}return result;}
}
export class DynamoStore {
  constructor(client,commands,table){this.client=client;this.commands=commands;this.table=table;}
  async send(command,input){return this.client.send(new this.commands[command]({TableName:this.table,...input}));}
  decode(item){if(!item||item.expiresAt<=epoch())return null;return JSON.parse(gunzipSync(item.payload).toString());}
  encode(pk,sk,value,ttl){const payload=gzipSync(JSON.stringify(value));if(payload.length>350000)throw new Error('Dieser Datensatz übersteigt die unterstützte Größe. Bitte Bibliotheksauswertung eingrenzen.');return {pk,sk,payload,expiresAt:epoch()+ttl};}
  async get(pk,sk){return this.decode((await this.send('GetCommand',{Key:{pk,sk},ConsistentRead:true})).Item);}
  async put(pk,sk,value,ttl=RETENTION){await this.send('PutCommand',{Item:this.encode(pk,sk,value,ttl)});}
  async delete(pk,sk){await this.send('DeleteCommand',{Key:{pk,sk}});}
  async take(pk,sk){return this.decode((await this.send('DeleteCommand',{Key:{pk,sk},ReturnValues:'ALL_OLD'})).Attributes);}
  async claim(pk,sk,value,ttl){try{await this.send('PutCommand',{Item:this.encode(pk,sk,value,ttl),ConditionExpression:'attribute_not_exists(pk) OR expiresAt <= :now',ExpressionAttributeValues:{':now':epoch()}});return true;}catch(e){if(e.name==='ConditionalCheckFailedException')return false;throw e;}}
  async list(pk,prefix){let key;const values=[];do{const response=await this.send('QueryCommand',{KeyConditionExpression:'pk = :pk AND begins_with(sk, :prefix)',ExpressionAttributeValues:{':pk':pk,':prefix':prefix},ExclusiveStartKey:key,ConsistentRead:true});for(const item of response.Items||[]){const value=this.decode(item);if(value)values.push(value);}key=response.LastEvaluatedKey;}while(key);return values;}
}
let instance;
export async function storage(){if(instance)return instance;if(!process.env.STATE_TABLE)return instance=new FileStore();const [{DynamoDBClient},commands]=await Promise.all([import('@aws-sdk/client-dynamodb'),import('@aws-sdk/lib-dynamodb')]);return instance=new DynamoStore(commands.DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),commands,process.env.STATE_TABLE);}
