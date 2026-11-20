import { z } from "zod";
import { formFieldErrorSchema } from "@ontomato/contracts/form-fields";

/** The owner's typed views of the three model objects, as `OntologyModelController` answers them. */
export const objectTypeViewSchema = z.object({
  className: z.string(),
  showName: z.string(),
  classDesc: z.string(),
  attributeCount: z.number(),
  businessKeyCount: z.number(),
  relationshipCount: z.number(),
  primaryKey: z.object({ status: z.string(), name: z.string().optional() }),
}).strict();

export const attributeViewSchema = z.object({
  className: z.string(),
  name: z.string(),
  showName: z.string(),
  type: z.string(),
  attrDesc: z.string(),
  enable: z.boolean(),
  businessKey: z.boolean(),
  primaryKey: z.boolean(),
}).strict();

export const relationshipViewSchema = z.object({
  relationship: z.string(),
  fromclass: z.string(),
  toclass: z.string(),
  desc: z.string(),
  fromField: z.string(),
  toField: z.string(),
}).strict();

export type ObjectTypeView = z.infer<typeof objectTypeViewSchema>;
export type AttributeView = z.infer<typeof attributeViewSchema>;
export type RelationshipView = z.infer<typeof relationshipViewSchema>;

/** The owner's answer for a refused request, as the controller's error handler shapes it. */
export const modelErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.array(formFieldErrorSchema).optional(),
  }).passthrough(),
});

const attributePrimaryKeySchema = z.tuple([z.string().min(1), z.string().min(1)]);

/** Splits an attribute's two-part JSON primary key into its owning class name and attribute name. */
export function parseAttributePrimaryKey(primaryKey: string): { className: string; name: string } {
  const [className, name] = attributePrimaryKeySchema.parse(JSON.parse(primaryKey));
  return { className, name };
}

/** The owner's label of each field of the three model objects in the reader's language, by field key. */
export const fieldLabelsSchema = z.object({
  objectType: z.record(z.string()),
  attribute: z.record(z.string()),
  relationship: z.record(z.string()),
}).strict();
export type FieldLabels = z.infer<typeof fieldLabelsSchema>;
