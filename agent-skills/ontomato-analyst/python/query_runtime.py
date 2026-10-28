"""Ontology-owned HTTP helper. The runtime only supplies its private binding."""
import json
import os
from pathlib import Path
import requests

_target = os.environ["ONTOMATO_TARGET_URL"].rstrip("/")
_credential = json.loads(os.environ["ONTOMATO_CREDENTIAL_JSON"])
_status = Path("query-status.json")
_status.write_text("{}", encoding="utf-8")
parameters = json.loads(Path("parameters.json").read_text(encoding="utf-8")) if Path("parameters.json").exists() else {}


def _call(path, body):
    headers = {"X-Ontomato-Run-Id": json.loads(os.environ.get("ONTOMATO_CONTEXT_JSON", "{}")).get("credentialRunId", os.environ["ONTOMATO_RUN_ID"]),
               "X-Correlation-Id": os.environ["ONTOMATO_CORRELATION_ID"]}
    if _credential["kind"] != "bearer":
        raise RuntimeError("An ontology execution grant is required")
    headers["Authorization"] = "Bearer " + _credential["value"]
    response = requests.post(_target + path, json=body, headers=headers, timeout=120, allow_redirects=False)
    if not response.ok:
        raise RuntimeError("Ontology request failed (%s): %s" % (response.status_code, response.text))
    result = response.json()
    if result.get("error") or result.get("success") is False:
        raise RuntimeError(str(result.get("error") or result.get("message")))
    return result


def execute_dsl(dsl):
    result = _call("/ontology/query/execute-dsl", {"dsl": dsl})
    data = result["data"]
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0].get("answer"), list):
        raise RuntimeError("Invalid ontology DSL result")
    datum = data[0]
    if datum.get("truncated") is True:
        marker = {key: datum[key] for key in ("truncated", "rowLimit", "truncationHint")}
        if not isinstance(marker["rowLimit"], int) or marker["rowLimit"] <= 0 or not marker["truncationHint"]:
            raise RuntimeError("Invalid partial-query marker")
        if _status.read_text(encoding="utf-8") == "{}":
            _status.write_text(json.dumps(marker, ensure_ascii=False), encoding="utf-8")
    return datum["answer"]


def write_operation(operation, **arguments):
    if operation not in ("query", "insert", "update", "delete", "createEdge", "deleteEdge", "appendVector", "updateVector", "deleteVector"):
        raise ValueError("Unsupported write operation")
    return _call("/writeFunctionOperation/" + operation, arguments)


def query(dsl):
    return write_operation("query", dsl=dsl)["data"][0]["answer"]


def insert(className, objs):
    return write_operation("insert", className=className, objs=objs)


def update(className, setValues, where):
    return write_operation("update", className=className, setValues=setValues, where=where)


def delete(className, where):
    return write_operation("delete", className=className, where=where)


def createEdge(relationName, sourceClassName, sourceObjId, targetClassName, targetObjId):
    return write_operation("createEdge", relationName=relationName, sourceClassName=sourceClassName,
                           sourceObjId=sourceObjId, targetClassName=targetClassName, targetObjId=targetObjId)


def deleteEdge(relationName, sourceClassName, sourceObjId, targetClassName, targetObjId):
    return write_operation("deleteEdge", relationName=relationName, sourceClassName=sourceClassName,
                           sourceObjId=sourceObjId, targetClassName=targetClassName, targetObjId=targetObjId)


def appendVector(className, attrName, objectId, text, fileBase64=None, fileName="document.txt"):
    return write_operation("appendVector", className=className, attrName=attrName, objectId=objectId,
                           text=text, fileBase64=fileBase64, fileName=fileName)


def updateVector(className, attrName, objectId, fileId, text, fileBase64=None):
    return write_operation("updateVector", className=className, attrName=attrName, objectId=objectId,
                           fileId=fileId, text=text, fileBase64=fileBase64)


def deleteVector(className, attrName, objectId, fileId):
    return write_operation("deleteVector", className=className, attrName=attrName, objectId=objectId, fileId=fileId)
