#!/usr/bin/env python3
"""Use the active AWS CLI login for Terraform without printing or storing credentials."""
import json,os,subprocess,sys,pathlib
root=pathlib.Path(__file__).resolve().parent.parent
credentials=json.loads(subprocess.check_output(['aws','configure','export-credentials','--format','process']))
env=os.environ.copy()
for source,destination in [('AccessKeyId','AWS_ACCESS_KEY_ID'),('SecretAccessKey','AWS_SECRET_ACCESS_KEY'),('SessionToken','AWS_SESSION_TOKEN')]:
    if source in credentials: env[destination]=credentials[source]
sys.exit(subprocess.call(['terraform',*sys.argv[1:]],cwd=root/'infra',env=env))
