import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PanelOperationRef } from "@ontomato/contracts/panel-agent";
import { PANEL_UPLOAD_TTL_MINUTES, type PanelUploadFile, type PanelUploadReceipt } from "@ontomato/contracts/panel-upload";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { HttpError } from "../../utils/errors";
import { tForLocale } from "../../i18n";
import type { AssistantOwner } from "../assistant/store";

/** A staged file as its owner receives it. */
export type PanelUploadedFile = PanelUploadFile & { bytes: Buffer };

const db = () => getPostgresPool();
const table = () => t("panel_operation_uploads");

/** The operation a file was staged for, without the optional fields a request may leave out. */
function operationKey({ applicationId, useId, root, operationId, memberPath }: PanelOperationRef) {
  return { applicationId, useId, operationId, ...(root && { root }), ...(memberPath && { memberPath }) };
}

/**
 * Files a person staged for one operation: readable only by that person, for that operation, until they expire. Each
 * person keeps at most one file per operation.
 */
export const panelUploadStore = {
  async stage(owner: AssistantOwner, operation: PanelOperationRef, file: PanelUploadedFile): Promise<PanelUploadReceipt> {
    const id = randomUUID();
    const key = operationKey(operation);
    await db().query(`DELETE FROM ${table()} WHERE expires_at <= now() OR (domain_id=$1 AND owner_id=$2 AND operation=$3::jsonb)`,
      [owner.domainId, owner.userId, key]);
    await db().query(
      `INSERT INTO ${table()} (domain_id,id,owner_id,operation,name,mime,size,bytes,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,now() + make_interval(mins => $9))`,
      [owner.domainId, id, owner.userId, key, file.name, file.mime, file.size, file.bytes, PANEL_UPLOAD_TTL_MINUTES],
    );
    return { uploadId: id, name: file.name, size: file.size, mime: file.mime };
  },
  /** The staged file, or a refusal the reader can act on when it expired or was staged for something else. */
  async read(owner: AssistantOwner, operation: PanelOperationRef, uploadId: string, locale?: string): Promise<PanelUploadedFile> {
    const row = (await db().query(
      `SELECT operation,name,mime,size,bytes FROM ${table()} WHERE domain_id=$1 AND owner_id=$2 AND id=$3 AND expires_at > now()`,
      [owner.domainId, owner.userId, uploadId],
    )).rows[0];
    if (!row || !isDeepStrictEqual(row.operation, operationKey(operation)))
      throw new HttpError(409, tForLocale(locale, "panels.upload.notFound"), "UPLOAD_NOT_FOUND");
    return { name: row.name, mime: row.mime, size: row.size, bytes: row.bytes };
  },
  async remove(owner: AssistantOwner, uploadId: string) {
    await db().query(`DELETE FROM ${table()} WHERE domain_id=$1 AND owner_id=$2 AND id=$3`, [owner.domainId, owner.userId, uploadId]);
  },
};
