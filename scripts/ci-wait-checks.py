#!/usr/bin/env python3
"""Gate image publication on the checks in this workflow attempt."""
import json
import os
import sys
import time
import urllib.request

url = (f"{os.environ['GITHUB_API_URL']}/repos/{os.environ['GITHUB_REPOSITORY']}"
       f"/actions/runs/{os.environ['GITHUB_RUN_ID']}/attempts/{os.environ['GITHUB_RUN_ATTEMPT']}/jobs?per_page=100")
request = urllib.request.Request(url, headers={
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + os.environ["GH_TOKEN"],
})
deadline = time.monotonic() + 1200
expected = {"checks / checks", "checks / java"}
while time.monotonic() < deadline:
    with urllib.request.urlopen(request, timeout=30) as response:
        jobs = {job["name"]: job for job in json.load(response)["jobs"] if job["name"] in expected}
    failed = [name for name, job in jobs.items()
              if job["status"] == "completed" and job["conclusion"] != "success"]
    if failed:
        print("CI_CHECKS_RESULT=failed jobs=" + ",".join(failed), flush=True)
        sys.exit(1)
    if jobs.keys() == expected and all(job["conclusion"] == "success" for job in jobs.values()):
        print("CI_CHECKS_RESULT=success", flush=True)
        sys.exit(0)
    print("Waiting for workflow checks before publishing", flush=True)
    time.sleep(min(15, max(0, deadline - time.monotonic())))
print("CI_CHECKS_RESULT=failed reason=timeout", flush=True)
sys.exit(1)
