import urllib.request
import json
import os

api_key = "re_ZA3dtUiX_6WTSKTGSyomXG6ezZtTJ96A9"

req = urllib.request.Request(
    "https://api.resend.com/domains",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    },
    method="GET"
)

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error: {e}")
