// Run with use_figma in EQX5sbStSZeFf2lZCpvEJI. Creates a review study, not a production replacement.
const existing = figma.root.children.find(p => p.name === 'Vector cleanup · face study');
if (existing) return { existingPageId: existing.id, status: 'Already created; inspect before editing.' };
await figma.loadFontAsync({family:'Inter',style:'Regular'});
await figma.loadFontAsync({family:'Inter',style:'Semi Bold'});
const source = await figma.getNodeByIdAsync('1:3');
const page = figma.createPage();
page.name = 'Vector cleanup · face study';
await figma.setCurrentPageAsync(page);
const made = [page.id];
const paint = hex => ({type:'SOLID',color:{r:parseInt(hex.slice(0,2),16)/255,g:parseInt(hex.slice(2,4),16)/255,b:parseInt(hex.slice(4,6),16)/255}});
const box = (name, direction, width) => {
  const n = figma.createAutoLayout(direction); made.push(n.id); n.name=name;
  n.resize(width,100); n.primaryAxisSizingMode='AUTO'; n.counterAxisSizingMode='FIXED';
  n.itemSpacing=16; n.fills=[]; return n;
};
const text = (parent, value, size, bold=false) => {
  const n=figma.createText(); made.push(n.id); parent.appendChild(n);
  n.fontName={family:'Inter',style:bold?'Semi Bold':'Regular'}; n.fontSize=size;
  n.characters=value; n.fills=[paint(bold?'1C2948':'617088')];
  n.textAutoResize='HEIGHT'; n.resize(parent.width-parent.paddingLeft-parent.paddingRight,20);
  return n;
};
const board=box('Bilby · facial detail cleanup','VERTICAL',1024); page.appendChild(board);
board.x=160; board.y=160; board.paddingTop=32; board.paddingBottom=32; board.paddingLeft=32; board.paddingRight=32; board.itemSpacing=22; board.fills=[paint('F8F3E8')];
text(board,'Bilby · vector detail cleanup',30,true);
text(board,'One-frame study: compare at app size and enlarged before extending the facial edits to an animation.',16);
const row=box('Before and after','HORIZONTAL',960); board.appendChild(row); row.itemSpacing=24;
const panels=[];
for(const label of ['Imported vectors','Cleaned detail study']){
  const panel=box(label,'VERTICAL',468); row.appendChild(panel); panel.paddingTop=20;panel.paddingBottom=20;panel.paddingLeft=20;panel.paddingRight=20;panel.cornerRadius=16;panel.fills=[paint('FFFFFF')];
  text(panel,label,20,true);
  const stage=figma.createFrame();made.push(stage.id);panel.appendChild(stage);stage.name='Artwork';stage.resize(428,450);stage.fills=[];stage.clipsContent=false;
  const art=source.clone();stage.appendChild(art);art.name=label+' · wave 01';
  made.push(art.id,...art.findAll().map(n=>n.id));
  panels.push({panel,stage,art});
}
const after=panels[1].art;
const map=new Map(source.children.map((n,i)=>[n.id,after.children[i]]));
const path=(id,name,data)=>{const n=map.get(id);n.name=name;n.vectorPaths=[{windingRule:'NONZERO',data}];return n;};
path('1:16','Left eye · smooth white','M 2.865 3.725 C 6.9 -0.3 11.5 -0.6 15.318 2.318 C 16.4 4.5 16.5 9.3 14.1 12.8 C 11.4 16.5 6.6 16.6 3.1 13.7 C 0.8 12.2 -0.8 10.5 0.5 8.1 C 1.3 6.5 2.2 4.9 2.865 3.725 Z');
path('1:17','Left pupil · continuous contour','M 2.1 10.5 C -0.7 7.8 0.7 3.8 3.4 1.2 C 6.1 -1.4 9.8 -0.1 10.1 2.9 C 10.4 6 8.3 10 5.8 11.1 C 4.4 11.8 3.1 11.7 2.1 10.5 Z');
path('1:20','Right eye · smooth white','M 6.8 1.93 C 11.2 -1.8 17.7 1 19 6.4 C 20.4 12.1 14.4 20.5 9.2 19 C 6.2 18.1 3.8 16 1.8 14.4 C -2.1 10.5 2.3 5.4 6.8 1.93 Z');
path('1:21','Right pupil · continuous contour','M 1.2 10.6 C -0.8 8.4 0.7 4.4 3.15 1.8 C 5.6 -0.8 8.5 -0.5 9.8 2 C 11.3 4.9 9.6 8.6 7.4 10.8 C 5.2 13 2.8 13.4 1.2 10.6 Z');
const muzzle=map.get('1:36');muzzle.name='Muzzle · matched cream';muzzle.fills=JSON.parse(JSON.stringify(map.get('1:5').fills));
for(const [id,x,y,w,h] of [['1:17',121.1,84.85,3.7,4.4],['1:21',145.4,95.4,3.4,4.1]]){
  const glint=figma.createEllipse();made.push(glint.id);after.insertChild(after.children.indexOf(map.get(id))+1,glint);
  glint.name='Eye highlight · restored';glint.resize(w,h);glint.x=x;glint.y=y;glint.fills=[paint('FEFEFE')];
}
for(const {art,stage} of panels){art.rescale(2.5);art.x=(stage.width-art.width)/2;art.y=(stage.height-art.height)/2;}
text(panels[0].panel,'Traced pupil notches, angular eye whites and a bright muzzle sliver.',14);
text(panels[1].panel,'Continuous pupil curves, separate eye highlights and consistent muzzle color.',14);
text(board,'The source wave sequence is unchanged. Detailed edits need semantic matching per frame: the imported layers and vertex counts vary throughout the sequence.',14);
for(const n of board.query('FRAME')) if(n.layoutMode==='VERTICAL'||n.layoutMode==='HORIZONTAL') n.layoutSizingVertical='HUG';
board.layoutSizingVertical='HUG';
figma.viewport.scrollAndZoomIntoView([board]);
return {createdNodeIds:made,pageId:page.id,boardId:board.id,beforeId:panels[0].art.id,afterId:panels[1].art.id,sourceId:source.id,status:'Review study only; source face unchanged'};
