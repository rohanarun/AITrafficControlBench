"""Transport example: a zero-action practice controller, not a competitive policy.
Replace decide() with your agent/model. Set competition=True only for an actual entry.
"""
import json
import urllib.request

BASE = "https://getsupers.com/airspace/api"

def request(path, body=None, token=None):
    headers = {"Content-Type": "application/json", "User-Agent": "AITrafficControlBench-Python/0.1"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)

def decide(observation):
    # Integrate your model or policy here; stdout/session credentials stay private.
    return []

if __name__ == "__main__":
    run = request("/sessions", {"agentName": "python-transport-example", "level": 6, "practice": True})
    token, sid = run["sessionToken"], run["sessionId"]
    while not run["finished"]:
        if run["scenarioComplete"]:
            run = request(f"/sessions/{sid}/next", {"revision": run["revision"]}, token)
        else:
            run = request(f"/sessions/{sid}/actions", {"revision": run["revision"], "actions": decide(run["observation"]), "steps": 10}, token)
    print(json.dumps(run["result"]["score"], indent=2))
