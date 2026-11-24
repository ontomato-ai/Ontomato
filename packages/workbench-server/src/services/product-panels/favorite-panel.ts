import { z } from "zod";
import { homePinnedObjectSchema } from "@ontomato/contracts/platform-home";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { ADD_FAVORITE, FAVORITE, REMOVE_FAVORITE } from "@ontomato/contracts/platform-object-types";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { addPinnedObject, readPinnedObjects, removePinnedObject } from "../platform-home/service";
import type { ProductOwner } from "../product-governance/grants";
import type { PanelOperationHost, PanelWriteServerOperation, SinglePanelOperationOutcome } from "./server-operations";

const favoriteRecordKey = (className: string, primaryKey: string) => JSON.stringify([className, primaryKey]);

const addInputSchema = homePinnedObjectSchema;
const removeInputSchema = homePinnedObjectSchema.pick({ className: true, primaryKey: true }).strict();
const addResultSchema = z.object({ favorited: z.literal(true) }).strict();
const removeResultSchema = z.object({ favorited: z.literal(false) }).strict();

const favoriteText = (locale: string | undefined, key: string) => tForLocale(locale, `panels.favorite.${key}`);

function favoriteAffected(className: string, primaryKey: string) {
  return {
    objectTypes: [FAVORITE],
    objects: [
      { objectType: FAVORITE, primaryKey: favoriteRecordKey(className, primaryKey) },
      { objectType: className, primaryKey },
    ],
  };
}

export function createFavoriteReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const fieldLabels = () => ({
    className: favoriteText(viewer.locale, "className"),
    primaryKey: favoriteText(viewer.locale, "primaryKey"),
    title: favoriteText(viewer.locale, "title"),
  });

  return {
    async list(): Promise<PanelRecord[]> {
      const items = await readPinnedObjects(owner);
      const labels = fieldLabels();
      return items.map((item) => ({
        className: FAVORITE,
        primaryKey: favoriteRecordKey(item.className, item.primaryKey),
        label: item.title,
        fields: {
          className: item.className,
          primaryKey: item.primaryKey,
          title: item.title,
        },
        fieldLabels: labels,
        outputs: {
          favorited: true,
          className: item.className,
          primaryKey: item.primaryKey,
          title: item.title,
        },
      }));
    },

    async record(target: { className: string; primaryKey: string }): Promise<PanelRecord> {
      const items = await readPinnedObjects(owner);
      const match = items.find(
        (item) => item.className === target.className && item.primaryKey === target.primaryKey,
      );
      return {
        className: FAVORITE,
        primaryKey: favoriteRecordKey(target.className, target.primaryKey),
        label: match?.title ?? target.primaryKey,
        fields: {
          className: target.className,
          primaryKey: target.primaryKey,
          title: match?.title ?? "",
          status: "",
        },
        fieldLabels: fieldLabels(),
        outputs: {
          favorited: Boolean(match),
          className: target.className,
          primaryKey: target.primaryKey,
          title: match?.title ?? "",
        },
      };
    },
  };
}

export const favoriteServerOperations: readonly PanelWriteServerOperation[] = [
  {
    handlerRef: ADD_FAVORITE,
    labelKey: "panels.favorite.add",
    kind: "action",
    binding: { kind: "PlatformOperation", id: ADD_FAVORITE },
    effect: "write",
    batch: false,
    targetType: FAVORITE,
    targetSchema: z.null(),
    inputSchema: addInputSchema,
    resultSchema: addResultSchema,
    async execute({ executor }: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const parsed = addInputSchema.parse(input);
      await addPinnedObject(executor.owner, parsed);
      return {
        kind: "success",
        data: { favorited: true },
        affected: favoriteAffected(parsed.className, parsed.primaryKey),
      };
    },
  },
  {
    handlerRef: REMOVE_FAVORITE,
    labelKey: "panels.favorite.remove",
    kind: "action",
    binding: { kind: "PlatformOperation", id: REMOVE_FAVORITE },
    effect: "write",
    batch: false,
    targetType: FAVORITE,
    targetSchema: z.null(),
    inputSchema: removeInputSchema,
    resultSchema: removeResultSchema,
    async execute({ executor }: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const parsed = removeInputSchema.parse(input);
      await removePinnedObject(executor.owner, parsed);
      return {
        kind: "success",
        data: { favorited: false },
        affected: favoriteAffected(parsed.className, parsed.primaryKey),
      };
    },
  },
];
