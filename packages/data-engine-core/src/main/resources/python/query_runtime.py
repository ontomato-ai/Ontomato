"""Ontology-owned HTTP helper. The runtime only supplies its private binding."""
import json
import os
from pathlib import Path
from urllib.parse import quote
import requests

_target = os.environ["ONTOMATO_ONTOLOGY_URL"].rstrip("/")
_token = os.environ["ONTOMATO_TK"]
_status = Path("query-status.json")
_status.write_text("{}", encoding="utf-8")
parameters = json.loads(Path("parameters.json").read_text(encoding="utf-8")) if Path("parameters.json").exists() else {}
# Written by the runtime host, not by the caller: a business rule may read it, authorization may not.
identity = json.loads(Path("identity.json").read_text(encoding="utf-8")) if Path("identity.json").exists() else {}


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


def _praxis_call(method, path, body=None, query=None):
    base = os.environ.get("ONTOMATO_PRAXIS_URL", "").rstrip("/")
    caller_token = os.environ.get("ONTOMATO_CALLER_TK", "")
    if not base:
        raise RuntimeError("Praxis is unavailable: ONTOMATO_PRAXIS_URL is not configured")
    if not caller_token:
        raise RuntimeError("Praxis requires a signed-in caller token")
    headers = {
        "Accept-Language": os.environ.get("ONTOMATO_LANGUAGE", "en"),
        "Authorization": "Bearer " + caller_token,
        "tk": caller_token,
    }
    domain_id = identity.get("domainId")
    if domain_id:
        headers["x-ontomato-domain-id"] = str(domain_id)
    response = requests.request(
        method,
        base + path,
        params=query,
        json=body,
        headers=headers,
        timeout=120,
        allow_redirects=False,
    )
    if not response.ok:
        raise RuntimeError("Praxis request failed (%s): %s" % (response.status_code, response.text))
    result = response.json()
    if result.get("error") or result.get("success") is False:
        raise RuntimeError(str(result.get("error") or result.get("message")))
    return result


def praxis_list_runs(status=None, limit=None):
    """List Runs visible through the product Praxis entry."""
    query = {}
    if status is not None:
        query["status"] = status
    if limit is not None:
        query["limit"] = limit
    return _praxis_call("GET", "/runs", query=query)


def praxis_get_run(run_id):
    """Read one Run."""
    return _praxis_call("GET", "/runs/" + quote(str(run_id), safe=""))


def praxis_start_run(workflow_id, inputs=None, assignments=None, acts_on=None, goal_text=None, auto=True):
    """Start a Run as the signed-in caller.

    assignments maps step ids to candidate.principal values from praxis_step_candidates().
    Those values are normally loginCode, not arbitrary member ids.
    """
    requester = identity.get("loginCode")
    if not requester:
        raise RuntimeError("The Action execution has no caller loginCode")
    body = {
        "workflowId": workflow_id,
        "requester": requester,
        "auto": auto,
    }
    if inputs is not None:
        body["inputs"] = inputs
    if assignments is not None:
        body["assignments"] = assignments
    if acts_on is not None:
        body["actsOn"] = acts_on
    if goal_text is not None:
        body["goalText"] = goal_text
    return _praxis_call("POST", "/runs", body=body)


def praxis_tick_run(run_id):
    """Advance a Run once as the signed-in caller."""
    return _praxis_call("POST", "/runs/" + quote(str(run_id), safe="") + "/tick", body={})


def praxis_bind_run(run_id, target_class, target_id):
    """Bind a Run to its business object."""
    return _praxis_call(
        "POST",
        "/runs/" + quote(str(run_id), safe="") + "/acts-on",
        body={"targetClass": target_class, "targetId": target_id},
    )


def praxis_assign_step(step_id, principal, assigned_by=None):
    """Pin or clear a step using a candidate.principal value from praxis_step_candidates()."""
    return _praxis_call(
        "POST",
        "/steps/" + quote(str(step_id), safe="") + "/assign",
        body={
            "principal": principal,
            "assignedBy": assigned_by or identity.get("loginCode"),
        },
    )


def praxis_decide_step(step_id, verdict, comment=None):
    """Approve or reject a waiting step as the signed-in caller."""
    if verdict not in ("approve", "reject"):
        raise ValueError("verdict must be 'approve' or 'reject'")
    return _praxis_call(
        "POST",
        "/steps/" + quote(str(step_id), safe="") + "/decide",
        body={
            "decider": identity.get("loginCode"),
            "verdict": verdict,
            "comment": comment,
        },
    )


def praxis_inbox(assignee=None):
    """Read the signed-in caller's Praxis inbox."""
    return _praxis_call(
        "GET",
        "/inbox",
        query={"assignee": assignee or identity.get("loginCode")},
    )


def praxis_subjects():
    """Read workflow subjects in the current domain."""
    return _praxis_call("GET", "/subjects")


def praxis_step_candidates(step_id):
    """Read the eligible candidates for a step."""
    return _praxis_call("GET", "/steps/" + quote(str(step_id), safe="") + "/candidates")


def praxis_case(run_id):
    """Read a Run's case."""
    return _praxis_call("GET", "/runs/" + quote(str(run_id), safe="") + "/case")


def praxis_case_submit(run_id, payload):
    """Submit case data as the requester."""
    return _praxis_call(
        "POST",
        "/runs/" + quote(str(run_id), safe="") + "/case/submit",
        body={"payload": payload},
    )


def praxis_case_fill(run_id, payload):
    """Fill case data as the current assignee."""
    return _praxis_call(
        "POST",
        "/runs/" + quote(str(run_id), safe="") + "/case/fill",
        body={"payload": payload},
    )


def praxis_case_close(run_id):
    """Close a case."""
    return _praxis_call("POST", "/runs/" + quote(str(run_id), safe="") + "/case/close", body={})


def execute_dsl_file(path, parameter_values=None):
    """Execute a declared query file from the immutable Java-owned package.

    Only declared parameter values may change. The server resolves the original
    file; this process never uploads or replaces the DSL definition.
    """
    reference = {"path": path}
    if parameter_values is not None:
        reference["parameters"] = parameter_values
    return _query_rows(_call("/ontology/query/execute-dsl", {"queryRef": reference}))


def execute_dsl(dsl):
    """Execute one read-only DSL object outside the write sandbox.

    Args:
        dsl: a single ontology DSL object. It is the query plan itself, not a
            class name. Use the `ontomato-analyst` `dsl-reference` command for
            the current class-specific syntax.

    Returns:
        A list of result rows.
    """
    return _query_rows(_call("/ontology/query/execute-dsl", {"dsl": dsl}))


def _query_rows(result):
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
            primary key. Vector attributes are rejected here; use
            appendVector for vector files.
    """
    return write_operation("insert", className=className, objs=objs)


def update(className, setValues, where):
    """Update objects in one class.

    where must be a condition object, never a list. Unconditional full-table
    updates and deletes are rejected.

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

    where must be a condition object, never a list. Unconditional full-table
    deletes and updates are rejected.

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
        fileBase64: optional base64 file bytes. With None, the nonempty text
            is explicitly stored as a UTF-8 text attachment. text is required
            even when fileBase64 is supplied. Invalid input fails before writes.
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
        fileBase64: optional base64 file bytes. With None, the nonempty text
            is explicitly stored as a UTF-8 text attachment. text is required
            even when fileBase64 is supplied. Invalid input fails before writes.
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
