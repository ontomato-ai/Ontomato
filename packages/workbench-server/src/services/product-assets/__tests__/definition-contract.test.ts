import {expect,it} from 'vitest';
import {businessDefinitionSchema,definitionCondition} from '@ontomato/contracts/business-definitions';
it('substitutes declared collection arguments without accepting caller predicates',()=>{
  const definition=businessDefinitionSchema.parse({id:'active',name:'Active people',objectType:'Person',revision:1,status:'PUBLISHED',parameters:[{name:'status',type:'string',defaultValue:'active'}],predicate:{field:'status',operator:'=',parameter:'status'}});
  expect(definitionCondition(definition,{})).toEqual({field:'status',operator:'=',value:'active'});
  expect(()=>definitionCondition(definition,{predicate:'salary > 0'})).toThrow();
  expect(()=>definitionCondition(definition,{status:3})).toThrow();
});
