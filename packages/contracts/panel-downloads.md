# Panel downloads

The host renders each action from the current panel record's `manifest.downloads` and resolves its `labelKey` from the panel message bundle. A click in the host creates one pending request. The panel frame supplies neither the route nor the click that authorizes a local download.

## Owner files

At the click, read the active panel instance's latest admitted `view.state`, using its current frame and address. Every referenced value comes from a declared `deepLink` field and is checked against the declaration again. A skill export is enabled when the object state contains a skill reference. Encode its primary key as one path segment. Feedback export uses the current string filters and omits unset filters. The host supplies the required `timeZone` from the viewer's browser.

Use the exact declared method and route with the viewer's credentials. The owner decides access and handles the existing trusted build-test context for a preview, just as for a current read. Compare the response media type to the declaration and enforce `maxBytes`. Read the filename from `Content-Disposition`, preferring `filename*` to `filename`, and use only its basename. A missing or unusable name is a refusal.

## Frame-generated PNG

A panel declares at most one PNG producer. The host sends `export-png` with a fresh `requestId` to that frame. The frame replies with `exported-png`, the same `requestId`, an `ArrayBuffer`, MIME and a suggested basename. The host checks the current frame, request ID, declared MIME, basename and byte limit before consuming the pending request and saving the file. Canceling or replacing the request uses the existing request association and ends its eligibility. A late, unsolicited or repeated reply cannot trigger a download. The host owns the result, and the frame runs with its existing sandbox.
