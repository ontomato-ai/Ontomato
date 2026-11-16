import {z} from 'zod';
const id=z.string().min(1).max(200).refine(value=>!['__proto__','constructor','prototype'].includes(value),'Reserved identifier');
export const definitionParameterSchema=z.object({name:id,type:z.enum(['string','number','boolean']),defaultValue:z.union([z.string(),z.number(),z.boolean(),z.null()]).optional()}).strict();
export const businessDefinitionSchema=z.object({id,name:id,objectType:id,revision:z.number().int().positive(),status:z.enum(['DRAFT','PUBLISHED','RETIRED']),parameters:z.array(definitionParameterSchema).max(30).refine(parameters=>new Set(parameters.map(parameter=>parameter.name)).size===parameters.length,'Duplicate Definition parameter'),predicate:z.object({field:id,operator:z.enum(['=','!=','>','>=','<','<=','in','like','is','is not']),parameter:id.optional(),value:z.union([z.string(),z.number(),z.boolean(),z.null(),z.array(z.string())]).optional()}).strict().optional()}).strict();
export type BusinessDefinition=z.infer<typeof businessDefinitionSchema>;
/** Parameter substitution never accepts a caller-owned predicate. */
export function definitionCondition(definition:BusinessDefinition,parameters:Record<string,unknown>){
  const values:Record<string,unknown>={};
  for(const key of Object.keys(parameters))if(!definition.parameters.some(parameter=>parameter.name===key))throw new Error(`Unknown Definition parameter: ${key}`);
  for(const parameter of definition.parameters){
    const value=Object.hasOwn(parameters,parameter.name)?parameters[parameter.name]:parameter.defaultValue;
    if(value===undefined||value!==null&&typeof value!==parameter.type)throw new Error(`Invalid Definition parameter: ${parameter.name}`);
    values[parameter.name]=value;
  }
  const predicate=definition.predicate;
  if(!predicate)return undefined;
  if(predicate.parameter&&!definition.parameters.some(parameter=>parameter.name===predicate.parameter))throw new Error('Definition predicate references an undeclared parameter');
  return {field:predicate.field,operator:predicate.operator,value:predicate.parameter?values[predicate.parameter]:predicate.value};
}
