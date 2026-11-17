import {ref,onMounted} from 'vue';
import {useManagerClient,useOntologyText} from '../context';

/** Resolve labels through the current caller; identifiers remain available in tooltips. */
export function useIdentityNames(){
 const {ot}=useOntologyText();
 const client=useManagerClient(),names=ref<Record<string,string>>({});
 onMounted(async()=>{
  const entries=await Promise.allSettled([
   client.request('/user/getUserInfoPage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageNum:1,pageSize:1000,cdt:''})}).then(response=>response.json()),
   client.request('/role/getRoleInfoPage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageNum:1,pageSize:1000,cdt:''})}).then(response=>response.json()),
   client.request('/agent-principals').then(response=>response.json()),
  ]);
  const resolved:Record<string,string>={};
  for(const [index,result] of entries.entries())if(result.status==='fulfilled'){
   const value=result.value as {data?:{data?:Record<string,unknown>[]};principals?:Record<string,unknown>[]};
   const rows=index===2?value.principals:value.data?.data;
   for(const row of rows??[])if(typeof row.id==='string'){const name=row.userName||row.loginCode||row.roleName||row.name;if(typeof name==='string'&&name.trim())resolved[row.id]=name;}
  }
  names.value=resolved;
 });
 return (id:string,kind=ot('productPrincipal'))=>id==='*'?ot('productDomainMembers'):id==='system'?ot('productSystem'):names.value[id]??ot('productIdentityUnavailable',{kind});
}
