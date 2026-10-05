// Run with use_figma in EQX5sbStSZeFf2lZCpvEJI. Creates a review study, not a production replacement.
const reviewPage = await figma.getNodeByIdAsync('11:2');
const existing = reviewPage.children.find(n=>n.name==='Bilby · prop edge cleanup');
if(existing) return {existingBoardId:existing.id,status:'Already created'};
await figma.loadFontAsync({family:'Inter',style:'Regular'});
await figma.loadFontAsync({family:'Inter',style:'Semi Bold'});
const source = await figma.getNodeByIdAsync('1:12994');
const page = reviewPage;
await figma.setCurrentPageAsync(page);
const made = [];
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
const board=box('Bilby · prop edge cleanup','VERTICAL',1024); page.appendChild(board);
board.x=160; board.y=1040; board.paddingTop=32; board.paddingBottom=32; board.paddingLeft=32; board.paddingRight=32; board.itemSpacing=22; board.fills=[paint('F8F3E8')];
text(board,'Bilby · gift-box edge cleanup',30,true);
text(board,'One-frame study: sharpen the gift-box planes and tidy the traced pattern while retaining the soft character and ribbon.',16);
const row=box('Before and after','HORIZONTAL',960); board.appendChild(row); row.itemSpacing=24;
const panels=[];
for(const label of ['Imported vectors','Cleaned detail study']){
  const panel=box(label,'VERTICAL',468); row.appendChild(panel); panel.paddingTop=20;panel.paddingBottom=20;panel.paddingLeft=20;panel.paddingRight=20;panel.cornerRadius=16;panel.fills=[paint('FFFFFF')];
  text(panel,label,20,true);
  const stage=figma.createFrame();made.push(stage.id);panel.appendChild(stage);stage.name='Artwork';stage.resize(428,450);stage.fills=[];stage.clipsContent=false;
  const art=source.clone();stage.appendChild(art);art.name=label+' · gift 01';
  made.push(art.id,...art.findAll().map(n=>n.id));
  panels.push({panel,stage,art});
}
const after=panels[1].art;
const map=new Map(source.children.map((n,i)=>[n.id,after.children[i]]));
const path=(id,name,data)=>{const n=map.get(id);n.name=name;n.vectorPaths=[{windingRule:'NONZERO',data}];};
path('1:13024','Gift front · crisp plane','M 7.425 0 L 19.005 6.039 L 18.48 25.384 L 0 23.04 Z');
path('1:13025','Gift front · clean light plane','M 0 0.273 L 10.393 5.811 L 9.868 25.155 L 2.9 24.05 Z');
path('1:13021','Gift side · crisp plane','M 0.913 0 L 8.999 2.215 L 9.483 23.497 L 0 26 Z');
path('1:13033','Gift edge · straight fold','M 1.274 1.03 L 7.312 0.146 L 2.489 19.269 L 0 20.029 Z');
for(const id of ['1:13022','1:13023','1:13026','1:13027','1:13028']){const n=map.get(id);n.name='Original traced pattern · preserved';n.visible=false;}
for(const [x,y,w,h] of [[147,166,1.9,2.5],[150,176,1.9,2.5],[142,178,1.8,2.4],[165.5,167,1.6,2.3],[166.4,175,1.6,2.3]]){
 const dot=figma.createEllipse();made.push(dot.id);after.insertChild(after.children.indexOf(map.get('1:13028'))+1,dot);dot.name='Gift pattern · clean dot';dot.resize(w,h);dot.x=x;dot.y=y;dot.fills=[paint('E98E81')];
}
for(const {art,stage} of panels){art.rescale(2.5);art.x=(stage.width-art.width)/2;art.y=(stage.height-art.height)/2;}
text(panels[0].panel,'Wavering planar edges and merged, irregular color islands on the gift box.',14);
text(panels[1].panel,'Straight box edges, clear folds and separate editable pattern dots.',14);
text(board,'The source gift sequence is unchanged. This study isolates hard-surface cleanup; the character, hands and soft ribbon retain their original curves.',14);
for(const n of board.query('FRAME')) if(n.layoutMode==='VERTICAL'||n.layoutMode==='HORIZONTAL') n.layoutSizingVertical='HUG';
board.layoutSizingVertical='HUG';
figma.viewport.scrollAndZoomIntoView([board]);
return {createdNodeIds:made,pageId:page.id,boardId:board.id,beforeId:panels[0].art.id,afterId:panels[1].art.id,sourceId:source.id,status:'Review study only; source gift unchanged'};
