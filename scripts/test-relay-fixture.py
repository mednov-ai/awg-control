"""Synthetic loopback fixture: real nginx UDP, fixed fake systemctl, no VPN keys."""
import base64
import concurrent.futures
import hashlib
import json
import os
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

# The fixture shim launches the actual nginx worker; no host systemd is touched.
Path('/usr/bin/systemctl').write_text('''#!/usr/bin/python3
import os,signal,subprocess,sys,time
from pathlib import Path
args=sys.argv[1:]
with open('/tmp/fixture-actions','a') as f: f.write(' '.join(args)+'\\n')
pid=Path('/run/awg-control-relay/nginx.pid')
enabled=Path('/tmp/relay-enabled')
def running():
 try: os.kill(int(pid.read_text()),0); return True
 except (FileNotFoundError,ProcessLookupError,ValueError): return False
if args[0]=='is-active': sys.exit(0 if running() else 1)
if args[0]=='is-enabled': sys.exit(0 if enabled.exists() else 1)
if args[0]=='show':
 with open('/tmp/fixture-sockets','a') as f:
  f.write(subprocess.check_output(['/usr/bin/ss','-H','-l','-u','-n','-p'],text=True))
  if running():
   master=pid.read_text().strip()
   children=Path('/proc/'+master+'/task/'+master+'/children').read_text().split()
   for child in children: f.write('worker:'+child+':'+repr(Path('/proc/'+child+'/cmdline').read_bytes())+'\\n')
 print(pid.read_text().strip() if running() else '0'); sys.exit(0)
if args[0]=='start':
 pid.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 subprocess.run(['/usr/sbin/nginx','-c','/etc/awg-control-relay/nginx.conf'],check=True)
elif args[0]=='reload': os.kill(int(pid.read_text()),signal.SIGHUP); time.sleep(.2)
elif args[0]=='enable': enabled.touch()
elif args[0]=='disable':
 enabled.unlink(missing_ok=True)
 if '--now' in args and running(): os.kill(int(pid.read_text()),signal.SIGTERM); time.sleep(.3)
''')
Path('/usr/bin/systemctl').chmod(0o755)

def rpc(action,operation,parameters):
 request=dict(protocolVersion='1.1',requestId=operation,operationId=operation,action=action,parameters=parameters)
 result=subprocess.run(['/usr/local/sbin/awgctl','ssh-relay-rpc'],input=json.dumps(request),text=True,capture_output=True,check=True)
 value=json.loads(result.stdout)
 if not value['ok']:
  actions=Path('/tmp/fixture-actions')
  if actions.exists(): print(actions.read_text())
  sockets=Path('/tmp/fixture-sockets')
  if sockets.exists(): print(sockets.read_text())
  subprocess.run(['/usr/bin/ss','-H','-l','-u','-n','-p'])
  subprocess.run(['ps','-eo','pid,ppid,comm'])
  raise AssertionError(value.get('error',{}).get('code'))
 return value['result']

assert not Path('/run/awg-control-relay').exists(), 'fixture must start without RuntimeDirectory'
initial=rpc('status','initial',{})
installed=rpc('install','install',dict(expectedFingerprint=initial['sourceFingerprint']))
unit=Path('/etc/systemd/system/awg-control-relay.service')
# Verify the real systemd unit's syntax separately from the process shim.
subprocess.run(['/usr/bin/systemd-analyze','verify',str(unit)],check=True,capture_output=True)
route=dict(id='019a0000-0000-7000-8000-000000000001',listenPort=47300,upstreamIpv4='203.0.113.10',upstreamPort=47301,enabled=True)
server=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
server.bind(('203.0.113.10',47301));server.settimeout(.5)
stop=threading.Event()
def echo():
 while not stop.is_set():
  try:
   data,peer=server.recvfrom(65535)
   server.sendto(data,peer)
   # More than one response per request must survive the relay.
   server.sendto(b'second:'+data,peer)
  except socket.timeout: pass
thread=threading.Thread(target=echo,daemon=True);thread.start()
applied=rpc('apply','apply',dict(expectedFingerprint=installed['sourceFingerprint'],route=route))
def client(number):
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
  s.settimeout(3)
  for size in (64,1280,8192):
   payload=(f'fixture-{number}:'.encode()+b'x'*size)
   s.sendto(payload,('127.0.0.1',47300))
   received={s.recv(65535),s.recv(65535)}
   assert received=={payload,b'second:'+payload}, 'datagram mismatch'
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(client,range(8)))
# NAT/port change is exercised by a new socket per client call.
client(99)
updated=rpc('update','update',dict(expectedFingerprint=applied['sourceFingerprint']))
client(100)
# A occupied listen port must cause verification failure and restoration.
occupied=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);occupied.bind(('0.0.0.0',47302))
bad={**route,'listenPort':47302}
request=dict(protocolVersion='1.1',requestId='conflict',operationId='conflict',action='apply',parameters=dict(expectedFingerprint=updated['sourceFingerprint'],route=bad))
result=subprocess.run(['/usr/local/sbin/awgctl','ssh-relay-rpc'],input=json.dumps(request),text=True,capture_output=True,check=True)
assert not json.loads(result.stdout)['ok'], 'occupied port reported success'
occupied.close();client(101)
state=rpc('status','after-rollback',{})
assert state['sourceFingerprint']==updated['sourceFingerprint'], 'rollback fingerprint mismatch'
disabled=rpc('disable','disable',dict(expectedFingerprint=state['sourceFingerprint'],routeId=route['id']))
assert not disabled['routes'][0]['enabled']
removed=rpc('remove','remove',dict(expectedFingerprint=disabled['sourceFingerprint'],routeId=route['id']))
uninstalled=rpc('uninstall','uninstall',dict(expectedFingerprint=removed['sourceFingerprint']))
assert not uninstalled['installed'] and not uninstalled['active']
assert not unit.exists() and not Path('/etc/awg-control-relay/nginx.conf').exists()
stop.set();thread.join(timeout=1);server.close()
print('Relay fixture: UDP multi-client, multiple responses, reload, conflict rollback and uninstall passed.')

# Bootstrap orchestration test. Only the cosign process is mocked; this is not
# evidence that a published release signature has been verified.
key_type=b'ssh-ed25519'
public=base64.b64encode(len(key_type).to_bytes(4,'big')+key_type+(32).to_bytes(4,'big')+b'x'*32).decode()
Path('/tmp/relay-fixture.pub').write_text('ssh-ed25519 '+public+' SYNTHETIC-ONLY\n')
Path('/tmp/fixture-bundle').write_text('{}')
mock=Path('/usr/local/bin/cosign')
mock.write_text('#!/bin/sh\nexit 0\n');mock.chmod(0o755)
binary=Path('/usr/local/sbin/awgctl')
args=['bash','/fixture/install-relay.sh','--binary',str(binary),'--checksum',hashlib.sha256(binary.read_bytes()).hexdigest(),'--bundle','/tmp/fixture-bundle','--panel-public-key','/tmp/relay-fixture.pub']
before=binary.read_bytes()
dry=subprocess.run(args+['--dry-run'],text=True,capture_output=True,check=True)
assert 'Dry run complete' in dry.stdout
assert not Path('/etc/sudoers.d/awg-control-relay-agent').exists()
assert binary.read_bytes()==before
mock.write_text('#!/bin/sh\nexit 1\n')
rejected=subprocess.run(args,text=True,capture_output=True)
assert rejected.returncode!=0 and not Path('/etc/sudoers.d/awg-control-relay-agent').exists()
print('Bootstrap fixture: dry-run preservation and signature-verifier rejection passed (mock verifier).')
