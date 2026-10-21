"""Google OAuth and Drive API helpers. Tokens are encrypted at rest."""
from __future__ import annotations

import asyncio, base64, hashlib, json, time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from jose import jwt
from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

settings=get_settings()
SCOPES="openid email https://www.googleapis.com/auth/drive.readonly"

def configured()->bool: return bool(settings.google_client_id and settings.google_client_secret)
def redirect_uri()->str: return settings.google_redirect_uri or f"{settings.web_base_url.rstrip('/')}/api/files/drive/oauth/callback"
def _cipher()->Fernet:
    digest=hashlib.sha256((settings.jwt_secret+":google-drive:v1").encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))
def encrypt_credentials(value:dict)->str: return _cipher().encrypt(json.dumps(value).encode()).decode()
def decrypt_credentials(value:str|None)->dict:
    try: return json.loads(_cipher().decrypt((value or "").encode()).decode()) if value else {}
    except (InvalidToken,ValueError,TypeError,json.JSONDecodeError): return {}

def authorization_url(user_id:int)->str:
    state=jwt.encode({"sub":str(user_id),"purpose":"google-drive","exp":int(time.time())+600},settings.jwt_secret,algorithm="HS256")
    return "https://accounts.google.com/o/oauth2/v2/auth?"+urlencode({"client_id":settings.google_client_id,"redirect_uri":redirect_uri(),"response_type":"code","scope":SCOPES,"access_type":"offline","prompt":"consent select_account","include_granted_scopes":"true","state":state})

def decode_state(state:str)->int:
    data=jwt.decode(state,settings.jwt_secret,algorithms=["HS256"])
    if data.get("purpose")!="google-drive": raise ValueError("invalid state")
    return int(data["sub"])

def _json_request(url:str,*,data:dict|None=None,token:str|None=None)->dict:
    body=urlencode(data).encode() if data is not None else None
    headers={"Accept":"application/json"}
    if body is not None: headers["Content-Type"]="application/x-www-form-urlencoded"
    if token: headers["Authorization"]=f"Bearer {token}"
    with urlopen(Request(url,data=body,headers=headers),timeout=30) as response: return json.loads(response.read())

async def exchange_code(code:str)->dict:
    return await asyncio.to_thread(_json_request,"https://oauth2.googleapis.com/token",data={"code":code,"client_id":settings.google_client_id,"client_secret":settings.google_client_secret,"redirect_uri":redirect_uri(),"grant_type":"authorization_code"})

async def access_token(user,db)->str:
    credentials=decrypt_credentials(user.google_drive_credentials_encrypted)
    if not credentials: raise ValueError("حساب گوگل متصل نیست.")
    if credentials.get("access_token") and float(credentials.get("expires_at",0))>time.time()+60: return credentials["access_token"]
    refresh=credentials.get("refresh_token")
    if not refresh: raise ValueError("اتصال گوگل منقضی شده؛ دوباره متصلش کن.")
    fresh=await asyncio.to_thread(_json_request,"https://oauth2.googleapis.com/token",data={"refresh_token":refresh,"client_id":settings.google_client_id,"client_secret":settings.google_client_secret,"grant_type":"refresh_token"})
    credentials.update(fresh); credentials["refresh_token"]=refresh; credentials["expires_at"]=time.time()+int(fresh.get("expires_in",3600))
    user.google_drive_credentials_encrypted=encrypt_credentials(credentials); await db.commit()
    return credentials["access_token"]

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
