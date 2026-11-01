import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('published weekly view initializes, highlights teams, switches spacing and navigates history',async()=>{
  const html=await fs.readFile(new URL('../weekly/index.html',import.meta.url),'utf8');
  const app=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const markup=html.replace(/<script>[\s\S]*?<\/script>/g,'');
  class Element{
    constructor(){this.style={setProperty(){}};this.dataset={};this.children=[];this.handlers={};this.attributes={};this.hidden=false;this.innerHTML='';this.classList={add(){}};}
    setAttribute(key,value){this.attributes[key]=value}append(node){this.children.push(node)}remove(){}replaceChildren(...nodes){this.children=nodes}
    addEventListener(event,fn){(this.handlers[event]??=[]).push(fn)}emit(event,args={}){for(const fn of this.handlers[event]??[])fn(args)}
    getContext(){return{measureText:text=>({width:text.length*7})}}getBoundingClientRect(){return{width:554,left:0,top:0}}
  }
  const nodes=new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  nodes.get('ranking-ruler-mode').value='score';
  const document={getElementById:id=>{assert.ok(nodes.has(id),`Missing element: ${id}`);return nodes.get(id)},createElement:()=>new Element(),createElementNS:()=>new Element(),body:new Element(),documentElement:new Element(),addEventListener(){}};
  const axis=(lo,hi,length,invert=false)=>({_length:length,_offset:82,l2p:value=>(invert?hi-value:value-lo)/(hi-lo)*length,p2l:value=>invert?hi-value/length*(hi-lo):lo+value/length*(hi-lo)});
  const Plotly={async newPlot(node,traces,layout){node.data=structuredClone(traces);node.layout=structuredClone(layout);node._fullLayout={xaxis:axis(...layout.xaxis.range,400),yaxis:axis(...layout.yaxis.range,535,true)};node.on=()=>{}},
    async restyle(node,updates,indices=node.data.map((_,i)=>i)){for(const [key,value]of Object.entries(updates))indices.forEach((index,i)=>{const parts=key.split('.'),field=parts.pop();let target=node.data[index];for(const part of parts)target=target[part];target[field]=Array.isArray(value)?value[i%value.length]:value})},
    async relayout(node,updates){Object.assign(node.layout,updates)},Plots:{async resize(){}},Fx:{hover(){},unhover(){}}};
  const window={},navigated=[];
  vm.runInNewContext(app,{document,window,Plotly,console,Intl,Date,Math,Number,String,Set,Map,Promise,JSON,Error,setTimeout,clearTimeout,
    getComputedStyle:()=>({color:'#263742'}),matchMedia:()=>({matches:false,addEventListener(){}}),ResizeObserver:class{observe(){}},location:{reload(){},assign:value=>navigated.push(value)}});
  await new Promise(setImmediate);
  const api=window.leagueChart;assert.ok(api);assert.equal(api.getRulerLayout().mode,'score');
  assert.equal(nodes.get('legend').children.length,api.data.teams.length);assert.equal(nodes.get('power-ranking').children.length,api.data.teams.length);
  for(const button of nodes.get('legend').children){button.emit('pointerenter');await api.whenSettled();assert.equal(api.getActive(),button.dataset.teamId);button.emit('pointerleave');await api.whenSettled();assert.equal(api.getActive(),null);}
  nodes.get('ranking-ruler-mode').value='distance';nodes.get('ranking-ruler-mode').emit('change');assert.equal(api.getRulerLayout().mode,'distance');
  const href='/fantasy-league-explorer/weekly/snapshots/example.html';nodes.get('weekly-history').emit('change',{target:{value:href}});assert.deepEqual(navigated,[href]);
  nodes.get('weekly-history').emit('change',{target:{value:'https://example.com/'}});assert.equal(navigated.length,1);
  assert.equal(nodes.get('chart-corners-top').style.paddingLeft,'82px');assert.equal(nodes.get('chart-corners-bottom').style.paddingRight,'72px');
  assert.notEqual(nodes.get('error').style.display,'block');
});
