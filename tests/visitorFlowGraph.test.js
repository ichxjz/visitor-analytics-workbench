import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisitorFlowGraph, finalFlowRule, flowRuleLabel, matchesFlowSelection } from '../src/admin/visitorFlowGraph.js';

const row = patch => ({source:'ref.example.org',domain:'example.org',path:'/',rules:['static:home-entry'],ruleSource:'logged',status:200,requests:3,bytesSent:120,region:'中国 · 福建省 · 福州市',...patch});

test('每列节点与每段加权连线守恒，Top节点的其他分组可精确反查',()=>{
  const rows=Array.from({length:12},(_,index)=>row({source:`source-${index}.example.org`,domain:`host-${index}.example.org`,path:`/p/${index}`,rules:[`logged:${index}`],status:200+index,requests:index+1,bytesSent:index*100}));
  const graph=buildVisitorFlowGraph(rows),total=rows.reduce((sum,item)=>sum+item.requests,0),bytes=rows.reduce((sum,item)=>sum+item.bytesSent,0);
  assert.equal(graph.requests,total);assert.equal(graph.bytesSent,bytes);
  for(const column of graph.columns){
    assert.equal(column.nodes.length,5);assert.equal(column.nodes.reduce((sum,node)=>sum+node.requests,0),total);assert.equal(column.nodes.reduce((sum,node)=>sum+node.bytesSent,0),bytes);
    const other=column.nodes.find(node=>node.other);assert.equal(other.values.length,8);
    assert.equal(rows.filter(item=>matchesFlowSelection(item,other.selection)).reduce((sum,item)=>sum+item.requests,0),other.requests);
  }
  for(let stage=0;stage<4;stage++)assert.equal(graph.links.filter(link=>link.stage===stage).reduce((sum,link)=>sum+link.requests,0),total);
  assert(graph.links.every(link=>Number.isFinite(link.width)&&link.path.startsWith('M')));
});

test('仅使用日志最终记录规则且不复制多规则请求，来源域名/路径/状态/地区筛选同请求交集',()=>{
  const rows=[row({rules:['edge.allow','proxy:earth']}),row({domain:'other.example.org',rules:['proxy:earth','static:site-files'],requests:7}),row({source:'else.example.org',rules:['proxy:earth'],requests:2})];
  const graph=buildVisitorFlowGraph(rows);
  assert.equal(finalFlowRule(rows[0]),'proxy:earth');assert.equal(finalFlowRule(row({ruleSource:'not-recorded',rules:['invented']})),null);
  assert.equal(graph.columns[3].nodes.find(node=>node.value==='proxy:earth').requests,5);
  assert.deepEqual(rows.filter(item=>matchesFlowSelection(item,{rule:'proxy:earth',source:'ref.example.org',domain:'example.org',status:'200',path:'/',region:'中国 · 福建省 · 福州市'})),[rows[0]]);
  assert.equal(flowRuleLabel('proxy:earth'),'地理数据代理');assert.equal(flowRuleLabel('unknown:id'),'已记录节点');
});

test('缺失与真实零保持区别，空数据不造节点，恶意文本只按文本返回且原数组不变',()=>{
  const input=[row({source:null,domain:'未记录访问域名',path:null,rules:[],status:null,bytesSent:null}),row({source:'<script>alert(1)</script>',bytesSent:0})],before=JSON.stringify(input),graph=buildVisitorFlowGraph(input);
  const missing=graph.columns[0].nodes.find(node=>node.value===null);assert.equal(missing.bytesSent,null);assert.equal(graph.columns[0].nodes.find(node=>node.value?.startsWith('<script>')).bytesSent,0);
  assert(matchesFlowSelection(input[0],{source:null,domain:'未记录访问域名',status:null,rule:null}));
  assert.equal(JSON.stringify(input),before);assert.equal(buildVisitorFlowGraph([]).columns.flatMap(column=>column.nodes).length,0);assert.equal(buildVisitorFlowGraph(null).requests,0);
  assert.equal(buildVisitorFlowGraph([row({requests:0})]).rows.length,0);
});
