"""Google OAuth and Drive API helpers. Tokens are encrypted at rest."""
from __future__ import annotations

import asyncio, base64, hashlib, json, time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from jose import jwt
from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

settings=get_settings()
FULL_SCOPE="openid email https://www.googleapis.com/auth/drive.readonly"
PICKER_SCOPE="openid email https://www.googleapis.com/auth/drive.file"

def full_configured()->bool: return bool(settings.google_client_id and settings.google_client_secret)
def picker_configured()->bool:
    return bool(settings.google_picker_client_id and settings.google_picker_client_secret and settings.google_picker_api_key and settings.google_picker_app_id)
def configured()->bool: return full_configured() or picker_configured()
def redirect_uri(mode:str="full")->str:
    if mode=="picker" and settings.google_picker_redirect_uri:
        return settings.google_picker_redirect_uri
    return settings.google_redirect_uri or f"{settings.web_base_url.rstrip('/')}/api/files/drive/oauth/callback"

def _oauth_config(mode:str)->tuple[str,str,str,str]:
    if mode=="picker":
        if not picker_configured(): raise ValueError("انتخاب‌گر عمومی گوگل هنوز روی سرور تنظیم نشده است.")
        return settings.google_picker_client_id,settings.google_picker_client_secret,redirect_uri("picker"),PICKER_SCOPE
    if not full_configured(): raise ValueError("اتصال کامل گوگل هنوز روی سرور تنظیم نشده است.")
    return settings.google_client_id,settings.google_client_secret,redirect_uri("full"),FULL_SCOPE
def _cipher()->Fernet:
    digest=hashlib.sha256((settings.jwt_secret+":google-drive:v1").encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))
def encrypt_credentials(value:dict)->str: return _cipher().encrypt(json.dumps(value).encode()).decode()
def decrypt_credentials(value:str|None)->dict:
    try: return json.loads(_cipher().decrypt((value or "").encode()).decode()) if value else {}
    except (InvalidToken,ValueError,TypeError,json.JSONDecodeError): return {}

def account_key(account:dict)->str:
    return f"{account.get('email','')}|{account.get('mode','full')}"

def credential_accounts(value:str|None,fallback_email:str|None=None)->tuple[list[dict],str|None]:
    stored=decrypt_credentials(value)
    if isinstance(stored.get("accounts"),list):
        accounts=[{**item,"mode":item.get("mode","full")} for item in stored["accounts"] if isinstance(item,dict) and item.get("email")]
        active=stored.get("active_key")
        if not active and stored.get("active_email"):
            match=next((item for item in accounts if item.get("email")==stored["active_email"]),None)
            active=account_key(match) if match else None
        return accounts,active or (account_key(accounts[0]) if accounts else None)
    if stored.get("access_token") or stored.get("refresh_token"):
        email=stored.get("email") or fallback_email
        account={**stored,"email":email,"mode":stored.get("mode","full")}
        return ([account] if email else []),account_key(account) if email else None
    return [],None

def encrypt_account_store(accounts:list[dict],active_key:str|None)->str|None:
    active=next((item for item in accounts if account_key(item)==active_key),None)
    return encrypt_credentials({"accounts":accounts,"active_key":active_key,"active_email":active.get("email") if active else None}) if accounts else None

def authorization_url(user_id:int,mode:str="full")->str:
    client_id,_,callback,scope=_oauth_config(mode)
    state=jwt.encode({"sub":str(user_id),"purpose":"google-drive","mode":mode,"exp":int(time.time())+600},settings.jwt_secret,algorithm="HS256")
    return "https://accounts.google.com/o/oauth2/v2/auth?"+urlencode({"client_id":client_id,"redirect_uri":callback,"response_type":"code","scope":scope,"access_type":"offline","prompt":"consent select_account","include_granted_scopes":"true","state":state})

def decode_state(state:str)->tuple[int,str]:
    data=jwt.decode(state,settings.jwt_secret,algorithms=["HS256"])
    if data.get("purpose")!="google-drive": raise ValueError("invalid state")
    mode=data.get("mode","full")
    if mode not in {"full","picker"}: raise ValueError("invalid mode")
    return int(data["sub"]),mode

def _json_request(url:str,*,data:dict|None=None,token:str|None=None)->dict:
    body=urlencode(data).encode() if data is not None else None
    headers={"Accept":"application/json"}
    if body is not None: headers["Content-Type"]="application/x-www-form-urlencoded"
    if token: headers["Authorization"]=f"Bearer {token}"
    with urlopen(Request(url,data=body,headers=headers),timeout=30) as response: return json.loads(response.read())

async def exchange_code(code:str,mode:str="full")->dict:
    client_id,client_secret,callback,_=_oauth_config(mode)
    return await asyncio.to_thread(_json_request,"https://oauth2.googleapis.com/token",data={"code":code,"client_id":client_id,"client_secret":client_secret,"redirect_uri":callback,"grant_type":"authorization_code"})

def active_credentials(user)->tuple[list[dict],dict|None]:
    accounts,active_key=credential_accounts(user.google_drive_credentials_encrypted,user.google_drive_email)
    return accounts,next((item for item in accounts if account_key(item)==active_key),accounts[0] if accounts else None)

async def access_token(user,db)->str:
    accounts,credentials=active_credentials(user)
    if not credentials: raise ValueError("حساب گوگل متصل نیست.")
    if credentials.get("access_token") and float(credentials.get("expires_at",0))>time.time()+60: return credentials["access_token"]
    refresh=credentials.get("refresh_token")
    if not refresh: raise ValueError("اتصال گوگل منقضی شده؛ دوباره متصلش کن.")
    mode=credentials.get("mode","full")
    client_id,client_secret,_,_=_oauth_config(mode)
    fresh=await asyncio.to_thread(_json_request,"https://oauth2.googleapis.com/token",data={"refresh_token":refresh,"client_id":client_id,"client_secret":client_secret,"grant_type":"refresh_token"})
    credentials.update(fresh); credentials["refresh_token"]=refresh; credentials["expires_at"]=time.time()+int(fresh.get("expires_in",3600))
    key=account_key(credentials)
    accounts=[credentials if account_key(item)==key else item for item in accounts]
    user.google_drive_credentials_encrypted=encrypt_account_store(accounts,key); await db.commit()
    return credentials["access_token"]

async def picker_bootstrap(user,db)->dict:
    _,credentials=active_credentials(user)
    if not credentials: raise ValueError("اول حساب گوگل را متصل کن.")
    if credentials.get("mode","full")!="picker": raise ValueError("برای انتخاب‌گر، اتصال محدود گوگل را فعال کن.")
    token=await access_token(user,db)
    return {"access_token":token,"developer_key":settings.google_picker_api_key,"app_id":settings.google_picker_app_id}

async def account_email(token:str)->str|None:
    try: return (await asyncio.to_thread(_json_request,"https://openidconnect.googleapis.com/v1/userinfo",token=token)).get("email")
    except Exception: return None

async def list_files(token:str,folder_id:str="root",query:str="")->list[dict]:
    conditions=["trashed = false"]
    if query.strip(): conditions.append(f"name contains '{query.strip().replace(chr(39), chr(92)+chr(39))}'")
    else: conditions.append(f"'{folder_id}' in parents")
    params={"q":" and ".join(conditions),"pageSize":"100","orderBy":"folder,name","fields":"files(id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink)"}
    result=await asyncio.to_thread(_json_request,"https://www.googleapis.com/drive/v3/files?"+urlencode(params),token=token)
    return result.get("files",[])
