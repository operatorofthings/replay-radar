#!/usr/bin/env python3
"""Explicit deployment step; uploads no secrets until invoked by the operator."""
import argparse,json,os,pathlib,secrets,subprocess,tempfile
parser=argparse.ArgumentParser()
parser.add_argument('--region',default='eu-central-1')
parser.add_argument('--steam-id',action='append',default=[],help='Optional allowed SteamID64; repeat for friends')
parser.add_argument('--public-access',action='store_true',help='Explicitly allow every Steam account')
args=parser.parse_args()
if not args.steam_id and not args.public_access:parser.error("Choose --public-access or --steam-id")
if args.steam_id and args.public_access:parser.error("Choose only one access mode")
if any(not x.isdigit() or len(x)!=17 for x in args.steam_id):parser.error('Steam IDs must have 17 digits')
root=pathlib.Path(__file__).resolve().parent.parent
env=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
lookup=subprocess.run(['aws','ssm','get-parameter','--name','/replay-radar/config','--with-decryption','--region',args.region],capture_output=True,text=True)
if lookup.returncode==0:
    existing=json.loads(lookup.stdout)
    salt=json.loads(existing['Parameter']['Value'])['aliasSalt']
elif 'ParameterNotFound' in lookup.stderr:
    salt=secrets.token_hex(32)
else:
    raise SystemExit('Vorhandene Konfiguration konnte nicht geprüft werden. Abbruch ohne Änderung.')
payload={'Name':'/replay-radar/config','Type':'SecureString','Overwrite':True,'Value':json.dumps({'steamApiKey':env['STEAM_API_KEY'].strip(),'aliasSalt':salt,'allowedSteamIds':args.steam_id})}
descriptor,name=tempfile.mkstemp(prefix='replay-config-',suffix='.json')
try:
    os.fchmod(descriptor,0o600)
    with os.fdopen(descriptor,'w') as f:json.dump(payload,f)
    subprocess.run(['aws','ssm','put-parameter','--cli-input-json','file://'+name,'--region',args.region],check=True,stdout=subprocess.DEVNULL)
    print('SecureString configured; no secret was written to Terraform state.')
finally:os.unlink(name)
