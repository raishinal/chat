"""Isolated real-HTTP smoke test with two independent cookie sessions. No external services needed."""
from pathlib import Path
import base64, http.cookiejar, json, os, secrets, subprocess, time, urllib.request, urllib.parse, urllib.error
ROOT=Path(__file__).resolve().parents[1]
env=os.environ.copy()
db=ROOT/('storage/app/smoke-'+secrets.token_hex(8)+'.sqlite')
db.parent.mkdir(parents=True,exist_ok=True)
db.touch(exist_ok=True)
env.update(DB_CONNECTION='sqlite',DB_DATABASE=str(db),DB_URL='',BROADCAST_CONNECTION='null',QUEUE_CONNECTION='sync',MAIL_MAILER='array',SESSION_DRIVER='database',APP_ENV='testing',APP_URL='http://127.0.0.1:8197',SANCTUM_STATEFUL_DOMAINS='127.0.0.1:8197',APP_DEBUG='false',CHAT_DISK='local')
flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
def run(args):
 result=subprocess.run(args,cwd=ROOT,env=env,text=True,capture_output=True,creationflags=flags)
 if result.returncode: raise RuntimeError(result.stdout+result.stderr)
run(['php','artisan','migrate','--force','--no-interaction'])
password=secrets.token_urlsafe(24);env['SMOKE_PASSWORD']=password
run(['php','-r',r'''require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); foreach(['one','two'] as $name) { $u=App\Models\User::firstOrNew(['email'=>'smoke-'.$name.'@example.test']); $u->forceFill(['name'=>'Smoke '.$name,'password'=>getenv('SMOKE_PASSWORD'),'role'=>'user','status'=>'active','email_verified_at'=>now()])->save(); }'''])
log=open(ROOT/'storage/logs/http-smoke.log','w')
server=subprocess.Popen(['php','-S','127.0.0.1:8197','-t','public','public/index.php'],cwd=ROOT,env=env,stdout=log,stderr=log,creationflags=flags)
base='http://127.0.0.1:8197'
class Client:
 def __init__(self):
  self.cookies=http.cookiejar.CookieJar();self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
 def request(self,path,method='GET',body=None,headers=None):
  h={'Accept':'application/json','Origin':base,'Referer':base+'/dashboard'}
  token=next((c.value for c in self.cookies if c.name=='XSRF-TOKEN'),None)
  if token:h['X-XSRF-TOKEN']=urllib.parse.unquote(token)
  if isinstance(body,dict):body=json.dumps(body).encode();h['Content-Type']='application/json'
  h.update(headers or {})
  response=self.http.open(urllib.request.Request(base+path,data=body,method=method,headers=h),timeout=10)
  data=response.read();return response, json.loads(data) if 'application/json' in response.headers.get('Content-Type','') and data else data
 def login(self,name):
  self.request('/sanctum/csrf-cookie')
  self.request('/login','POST',{'email':'smoke-'+name+'@example.test','password':password})
try:
 for _ in range(40):
  try:urllib.request.urlopen(base+'/up',timeout=1);break
  except (OSError,urllib.error.URLError):time.sleep(.2)
 a,b=Client(),Client();a.login('one');b.login('two')
 _,ua=a.request('/api/v1/me');_,ub=b.request('/api/v1/me');assert ua['data']['id']!=ub['data']['id']
 _,conversation=a.request('/api/v1/conversations','POST',{'user_id':ub['data']['id']});cid=conversation['data']['id']
 client_id=secrets.token_hex(16);import uuid
 client_id=str(uuid.uuid4());payload={'client_id':client_id,'body':'Two-session HTTP smoke '+secrets.token_hex(4)}
 _,message=a.request(f'/api/v1/conversations/{cid}/messages','POST',payload);mid=message['data']['id']
 _,retried=a.request(f'/api/v1/conversations/{cid}/messages','POST',payload);assert retried['data']['id']==mid
 _,history=b.request(f'/api/v1/conversations/{cid}/messages');assert any(m['id']==mid for m in history['data'])
 _,notices=b.request('/api/v1/notifications');assert any(n['data'].get('message_id')==mid for n in notices['data'])
 b.request(f'/api/v1/conversations/{cid}/read','POST',{'message_id':mid})
 _,state=a.request(f'/api/v1/conversations/{cid}');assert state['data']['peer_read_id']==mid
 boundary='Relay'+secrets.token_hex(10);data=b'0123456789'
 multipart=(f'--{boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="smoke.unknown"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()+data+f'\r\n--{boundary}--\r\n'.encode())
 _,uploads=a.request(f'/api/v1/conversations/{cid}/attachments','POST',multipart,{'Content-Type':'multipart/form-data; boundary='+boundary});aid=uploads['data'][0]['id']
 a.request(f'/api/v1/conversations/{cid}/messages','POST',{'client_id':str(uuid.uuid4()),'attachment_ids':[aid]})
 response,download=b.request(f'/api/v1/attachments/{aid}',headers={'Range':'bytes=2-5'});assert response.status==206 and download==b'2345'
 _,call=a.request(f'/api/v1/conversations/{cid}/calls','POST',{'kind':'audio'});callid=call['data']['id']
 b.request(f'/api/v1/calls/{callid}','PATCH',{'action':'accept'});a.request(f'/api/v1/calls/{callid}','PATCH',{'action':'end'})
 print('PASS: two real HTTP cookie sessions, CSRF login, conversation, message, idempotent retry, recipient history/notification, read receipt, unknown-file upload, authenticated Range download, call accept/end state. WebSocket delivery and actual audio/video media NOT tested.')
finally:
 server.terminate();server.wait(timeout=10);log.close()
 run(['php','-r',r"require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); foreach(App\Models\Attachment::all() as $a) Illuminate\Support\Facades\Storage::disk($a->disk)->delete(array_filter([$a->path,$a->thumbnail_path]));"])
 db.unlink(missing_ok=True)
