"""Ontology-owned HTTP helper. The runtime only supplies its private binding."""
import json
import os
from pathlib import Path
import requests

_target = os.environ["ONTOMATO_ONTOLOGY_URL"].rstrip("/")
_token = os.environ["ONTOMATO_TK"]
_status = Path("query-status.json")
_status.write_text("{}", encoding="utf-8")
parameters = json.loads(Path("parameters.json").read_text(encoding="utf-8")) if Path("parameters.json").exists() else {}


def _call(path, body):
    headers = {"Accept-Language": os.environ.get("ONTOMATO_LANGUAGE", "en")}
    if _token:
        headers["tk"] = _token
    for _name, _header in (("ONTOMATO_SESSION_ID", "X-Ontomato-Session-Id"), ("ONTOMATO_RUN_ID", "X-Ontomato-Run-Id"), ("ONTOMATO_CORRELATION_ID", "X-Correlation-Id")):
        if os.environ.get(_name):
            headers[_header] = os.environ[_name]
    response = requests.post(_target + path, json=body, headers=headers, timeout=120, allow_redirects=False)
    if not response.ok:
        raise RuntimeError("Ontology request failed (%s): %s" % (response.status_code, response.text))
    result = response.json()
    if result.get("error") or result.get("success") is False:
        raise RuntimeError(str(result.get("error") or result.get("message")))
    return result


def execute_dsl(dsl):
    """Execute one read-only DSL object outside the write sandbox.

    Args:
        dsl: a single ontology DSL object. It is the query plan itself, not a
            class name. Use the `ontomato-analyst` `dsl-reference` command for
            the current class-specific syntax.

    Returns:
        A list of result rows.
    """
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
    """Low-level writeFunctionOperation dispatcher; prefer the named helpers."""
    if operation not in ("query", "insert", "update", "delete", "createEdge", "deleteEdge", "appendVector", "updateVector", "deleteVector"):
        raise ValueError("Unsupported write operation")
    return _call("/writeFunctionOperation/" + operation, arguments)


def query(dsl):
    """Run one read-only query in the write sandbox.

    Args:
        dsl: a single ontology DSL object. It is the query plan itself, not a
            class name. Use the `ontomato-analyst` `dsl-reference` command for
            the current class-specific syntax.

    Returns:
        A list of result rows.
    """
    return write_operation("query", dsl=dsl)["data"][0]["answer"]


def insert(className, objs):
    """Insert objects into one class.

    Args:
        className: full class name from the object class list.
        objs: list of object dictionaries. Each must have a unique id or
            primary key. Vector attributes are not written here; use
            appendVector for vector files.
    """
    return write_operation("insert", className=className, objs=objs)


def update(className, setValues, where):
    """Update objects in one class.

    Args:
        className: full class name.
        setValues: attribute values to change. Must not include vector
            attributes; use updateVector for vector files.
        where: filter for the objects to update. A single condition is
            {"field": "...", "operator": "...", "value": ...}; operators are
            =, !=, >, >=, <, <=, between, like, in, is, is not. Multiple
            conditions use {"operator": "logic", "and": [...]} or
            {"operator": "logic", "or": [...]}; logic blocks can nest.
    """
    return write_operation("update", className=className, setValues=setValues, where=where)


def delete(className, where):
    """Delete objects from one class.

    Args:
        className: full class name.
        where: filter for the objects to delete. Shape is the same as the
            `where` argument of `update`.
    """
    return write_operation("delete", className=className, where=where)


def createEdge(relationName, sourceClassName, sourceObjId, targetClassName, targetObjId):
    """Create a relation edge between two existing objects.

    Args:
        relationName: relation name from the relationship definition.
        sourceClassName: full class name of the source object.
        sourceObjId: id of the source object.
        targetClassName: full class name of the target object.
        targetObjId: id of the target object.
    """
    return write_operation("createEdge", relationName=relationName, sourceClassName=sourceClassName,
                           sourceObjId=sourceObjId, targetClassName=targetClassName, targetObjId=targetObjId)


def deleteEdge(relationName, sourceClassName, sourceObjId, targetClassName, targetObjId):
    """Delete a relation edge between two existing objects.

    Args:
        relationName: relation name from the relationship definition.
        sourceClassName: full class name of the source object.
        sourceObjId: id of the source object.
        targetClassName: full class name of the target object.
        targetObjId: id of the target object.
    """
    return write_operation("deleteEdge", relationName=relationName, sourceClassName=sourceClassName,
                           sourceObjId=sourceObjId, targetClassName=targetClassName, targetObjId=targetObjId)


def appendVector(className, attrName, objectId, text, fileBase64=None, fileName="document.txt"):
    """Append one vector file to a vector attribute of an existing object.

    Args:
        className: class that owns the vector attribute.
        attrName: vector attribute name.
        objectId: id of the target object.
        text: content used to generate the embedding.
        fileBase64: optional file content; the host fills it at execution time.
        fileName: optional file name.
    """
    return write_operation("appendVector", className=className, attrName=attrName, objectId=objectId,
                           text=text, fileBase64=fileBase64, fileName=fileName)


def updateVector(className, attrName, objectId, fileId, text, fileBase64=None):
    """Replace one vector file attached to an object's vector attribute.

    Args:
        className: class that owns the vector attribute.
        attrName: vector attribute name.
        objectId: id of the target object.
        fileId: existing vector file id (the last path segment).
        text: new content used to generate the embedding.
        fileBase64: optional file content; the host fills it at execution time.
    """
    return write_operation("updateVector", className=className, attrName=attrName, objectId=objectId,
                           fileId=fileId, text=text, fileBase64=fileBase64)


def deleteVector(className, attrName, objectId, fileId):
    """Delete one vector file attached to an object's vector attribute.

    Args:
        className: class that owns the vector attribute.
        attrName: vector attribute name.
        objectId: id of the target object.
        fileId: existing vector file id (the last path segment).
    """
    return write_operation("deleteVector", className=className, attrName=attrName, objectId=objectId, fileId=fileId)
