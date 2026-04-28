import base64
import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/auth/google", tags=["Auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def get_frontend_app_url():
    explicit_url = (os.getenv("FRONTEND_APP_URL") or "").strip()
    if explicit_url:
        return explicit_url.rstrip("/")

    configured_origins = [
        origin.strip()
        for origin in (os.getenv("FRONTEND_ORIGINS") or "").split(",")
        if origin.strip()
    ]
    if configured_origins:
        return configured_origins[0].rstrip("/")

    return "https://meetings-ecru.vercel.app"


def exchange_code_for_tokens(code: str):
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")

    if not client_id or not client_secret or not redirect_uri:
        raise HTTPException(status_code=500, detail="Google OAuth environment variables are missing")

    payload = urlencode(
        {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")

    request = Request(
        GOOGLE_TOKEN_URL,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    with urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_google_user(access_token: str):
    request = Request(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )

    with urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


@router.get("/login")
async def google_login():
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")

    if not client_id or not redirect_uri:
        raise HTTPException(status_code=500, detail="Google OAuth environment variables are missing")

    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
        }
    )
    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{query}", status_code=302)


@router.get("/callback")
async def google_callback(code: str | None = None, error: str | None = None):
    frontend_url = get_frontend_app_url()

    if error:
        return RedirectResponse(url=f"{frontend_url}/login?auth_error={error}", status_code=302)

    if not code:
        return RedirectResponse(url=f"{frontend_url}/login?auth_error=missing_code", status_code=302)

    try:
        token_data = exchange_code_for_tokens(code)
        user_info = fetch_google_user(token_data["access_token"])

        encoded_user = base64.urlsafe_b64encode(
            json.dumps(
                {
                    "id": user_info.get("email"),
                    "firebaseUid": user_info.get("sub"),
                    "name": user_info.get("name"),
                    "email": user_info.get("email"),
                    "picture": user_info.get("picture"),
                }
            ).encode("utf-8")
        ).decode("utf-8")

        return RedirectResponse(url=f"{frontend_url}/login?auth_success=1&user={encoded_user}", status_code=302)
    except Exception:
        return RedirectResponse(url=f"{frontend_url}/login?auth_error=callback_failed", status_code=302)
