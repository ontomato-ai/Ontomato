<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {resolveViewParameters} from '@ontomato/contracts/object-views';
import {formFieldKey,type FormField} from '@ontomato/contracts/form-fields';
import {FormFields} from '@ontomato/foundation-ui/form';
import {useManagerClient} from '../context';
import ManagerDialog from '../ManagerDialog.vue';
import {ElAlert,ElButton,ElForm} from 'element-plus';
const props=defineProps<{asset:ProductAsset;pageState?:Record<string,unknown>;preview?:boolean}>();
const emit=defineEmits<{refresh:[]}>();
const client=useManagerClient();
const projection=computed(()=>props.asset.document.kind==='action-view'?props.asset.document:null);
const fields=ref<FormField[]>([]),values=ref<Record<string,string>>({}),errors=ref<Record<string,string>>({});
const open=ref(false),loading=ref(false),error=ref(''),completed=ref(false);
let generation=0;onBeforeUnmount(()=>{generation++;});
const bindings=computed(()=>projection.value?Object.fromEntries(Object.entries(resolveViewParameters(projection.value.parameters,{},props.pageState??{})).map(([name,value])=>[name,value??null])):{});
const displayFields=computed(()=>fields.value.map((field):FormField=>{
  const presentation=projection.value?.presentation;
  const label=presentation?.fieldLabels[field.key]??field.label;
  const options=presentation?.fieldOptions[field.key];
  return options?{key:field.key,label,required:field.required,defaultValue:null,help:field.help,type:'select',refreshOnChange:false,options:options.map(option=>({...option,description:null,disabled:false,disabledReason:null}))}:{...field,label};
}));
async function load(){
  if(!projection.value||loading.value)return;
  const current=++generation;loading.value=true;error.value='';
  try{const form=await client.actions.form({id:projection.value.renders.id,parameters:bindings.value,readOnlyParameters:projection.value.readOnlyParameters});if(current!==generation)return;fields.value=form.fields;values.value=Object.fromEntries(Object.entries(form.values).map(([name,value])=>{const options=projection.value?.presentation?.fieldOptions[name];return [name,options&&!projection.value?.readOnlyParameters.includes(name)&&!options.some(option=>option.value===value)?'':value];}));errors.value={};open.value=true;}
  catch(reason){if(current===generation)error.value=reason instanceof Error?reason.message:String(reason);}finally{if(current===generation)loading.value=false;}
}
watch(()=>JSON.stringify([props.asset,props.pageState,props.preview]),()=>{generation++;open.value=false;error.value='';completed.value=false;fields.value=[];values.value={};loading.value=false;if(projection.value&&['form','inline'].includes(projection.value.renderer))void load();},{immediate:true});
async function submit(){
  if(!projection.value||loading.value||props.preview)return;
  for(const [name,options] of Object.entries(projection.value.presentation?.fieldOptions??{}))if(!projection.value.readOnlyParameters.includes(name)&&!options.some(option=>option.value===values.value[name])){errors.value[name]='请选择有效选项';return;}
  const current=generation;loading.value=true;error.value='';completed.value=false;
  try{
    const form=await client.actions.form({id:projection.value.renders.id,parameters:bindings.value,values:values.value,readOnlyParameters:projection.value.readOnlyParameters});
    if(current!==generation)return;
    errors.value=Object.fromEntries(form.errors.map(item=>[formFieldKey(item.field,'/values/')!,item.message]));
    if(!form.parameters)return;
    await client.actions.execute({id:projection.value.renders.id,parameters:form.parameters});
    if(current!==generation)return;completed.value=true;emit('refresh');if(['button','dialog'].includes(projection.value.renderer))open.value=false;
  }catch(reason){if(current===generation)error.value=reason instanceof Error?reason.message:String(reason);}finally{if(current===generation)loading.value=false;}
}
function enter(name:string,value:string){values.value[name]=value;delete errors.value[name];completed.value=false;}
</script>
<template><section v-if="projection" class="action-projection"><el-alert v-if="error" :title="error" type="error" :closable="false"/><el-alert v-if="completed" title="操作成功" type="success" :closable="false"/><el-button v-if="['button','dialog'].includes(projection.renderer)" :disabled="preview" :loading="loading" @click="load">{{asset.name}}</el-button><component :is="['button','dialog'].includes(projection.renderer)?ManagerDialog:'section'" v-if="open" v-model="open" :title="asset.name"><el-form label-position="top" @submit.prevent="submit"><FormFields :fields="displayFields" :values="values" :errors="errors" :disabled="loading||preview" :read-only="projection.readOnlyParameters" choose-placeholder="请选择" @input="enter" @choose="(field,value)=>enter(field.key,value)"/><el-button native-type="submit" type="primary" :loading="loading" :disabled="preview">{{asset.name}}</el-button></el-form></component></section></template>
