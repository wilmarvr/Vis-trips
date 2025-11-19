(function(){
  function dedupeBySummary(titles){
    const seen=new Set();
    document.querySelectorAll('details>summary').forEach(s=>{
      const t=(s.textContent||'').trim();
      if(titles.includes(t)){
        if(seen.has(t)){s.parentElement && s.parentElement.remove();}
        else seen.add(t);
      }
    });
  }
  function dedupeById(){
    const seen=new Set();
    document.querySelectorAll('[id]').forEach(el=>{
      if(!el.id) return;
      if(seen.has(el.id)) el.remove(); else seen.add(el.id);
    });
  }
  dedupeBySummary(['📍 Spots','🔎 Detectie','🌊 Deeper import & Heatmap','📊 Overzicht & beheren','🗺️ Contouren','🧨 Opschonen & export','🛰️ GPS & navigatie']);
  dedupeById();
})();

(function(){
  var _add=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,listener,options){
    if(type==='touchleave'){ type=('PointerEvent'in window)?'pointerleave':'mouseleave'; }
    return _add.call(this,type,listener,options);
  };
  if(window.L&&L.DomEvent&&typeof L.DomEvent.on==='function'){
    var _on=L.DomEvent.on;
    L.DomEvent.on=function(obj,types,fn,ctx){
      if(typeof types==='string'){ types=types.replace(/\btouchleave\b/g,('PointerEvent'in window)?'pointerleave':'mouseleave'); }
      return _on.call(this,obj,types,fn,ctx);
    };
  }
})();

// ===== mini helpers / status =====
function S(m){var el=document.getElementById("statusLine"); if(el) el.textContent=String(m||'');}
function I(m){var el=document.getElementById("footerDetect"); if(el) el.textContent=String(m||''); var di=document.getElementById("detectInfo"); if(di) di.textContent=String(m||'');}
function esc(s){ return String(s).replace(/[&<>"']/g, function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m];}); }
function uid(p){ return p+"_"+Math.random().toString(36).slice(2,9); }

// ===== kaart init =====
var map=L.map("mapContainer",{zoomControl:true,preferCanvas:true}).setView([52.4033055556,5.2391111111],17);
var bases={
  osm:L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20}),
  toner:L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner/{z}/{x}/{y}.png',{maxZoom:20}),
  terrain:L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg',{maxZoom:18}),
  dark:L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:20})
}; bases.osm.addTo(map);

document.getElementById('basemap').addEventListener('change',function(e){
  Object.values(bases).forEach(function(t){map.removeLayer(t);}); (bases[e.target.value]||bases.osm).addTo(map);
});
L.control.scale({position:"bottomright",imperial:false}).addTo(map);

// panes & groepen
map.createPane('waterPane').style.zIndex=400;
map.createPane('heatPane').style.zIndex=510;
map.createPane('isobandPane').style.zIndex=520;
map.createPane('contourPane').style.zIndex=530;
map.createPane('markerPane').style.zIndex=800;
map.createPane('labelsPane').style.zIndex=850;
map.createPane('measurePane').style.zIndex=840;

var waterGroup=L.featureGroup([], {pane:'waterPane'}).addTo(map);
var isobandLayer=L.featureGroup([], {pane:'isobandPane'}).addTo(map);
var contourLayer=L.featureGroup([], {pane:'contourPane'}).addTo(map);
var measureLayer=L.layerGroup([], {pane:'measurePane'}).addTo(map);

map.on('mousemove',function(e){var m=document.getElementById("mouseLL"); if(m) m.textContent=e.latlng.lat.toFixed(6)+", "+e.latlng.lng.toFixed(6);});
map.on('zoomend',function(){var z=document.getElementById("zoomLbl"); if(z) z.textContent="z"+map.getZoom();});

// ===== DB =====
var DB_KEY="lv_db_main";
var db={waters:[],steks:[],rigs:[],bathy:{points:[],datasets:[]},settings:{waterColor:"#33a1ff"}};
try{var raw=localStorage.getItem(DB_KEY); if(raw) db=JSON.parse(raw);}catch(e){}
normalizeDB();
function saveDB(){try{localStorage.setItem(DB_KEY,JSON.stringify(db));}catch(e){}}
function normalizeDB(){
  function num(v){ return (typeof v==='string'? parseFloat(v) : v); }
  db.steks=(db.steks||[]).map(function(s){return {id:s.id||uid('stek'),name:s.name||"",note:s.note||"",lat:num(s.lat),lng:num(s.lng),waterId:s.waterId||null};});
  db.rigs =(db.rigs ||[]).map(function(r){return {id:r.id||uid('rig'), name:r.name||"",note:r.note||"",lat:num(r.lat),lng:num(r.lng),stekId:r.stekId||null,waterId:r.waterId||null};});
  if(!db.waters) db.waters=[]; if(!db.bathy) db.bathy={points:[],datasets:[]};
  else { db.bathy.points=(db.bathy.points||[]).map(function(p){return {lat:num(p.lat),lon:num(p.lon),dep:num(p.dep)};}); }
}

// ===== selectie / cluster =====
var selection={points:new Set(),preview:null,bestWater:null};
function updateSelInfo(){var n=selection.points.size; var sug=selection.bestWater?(" • suggestie: "+(nameOfWater(selection.bestWater.id)||selection.bestWater.id)):""; I("Selectie: "+n+" punten"+sug+".");}
var selectMode=false;

var cluster=L.markerClusterGroup({disableClusteringAtZoom:19}); var useCluster=false;
document.getElementById("useCluster").checked=false;
document.getElementById('useCluster').addEventListener('change',function(){useCluster=this.checked; renderAll();});
document.getElementById('btnForceDragFix').addEventListener('click',function(){useCluster=false; document.getElementById("useCluster").checked=false; renderAll(); S('Drag-fix toegepast (clustering uit).');});

// ===== markers / drag =====
var stekMarkers=new Map(), rigMarkers=new Map();
function purgeAllMarkers(){
  stekMarkers.forEach(function(m){try{if(useCluster) cluster.removeLayer(m); map.removeLayer(m);}catch(_){}}); 
  rigMarkers.forEach(function(m){try{if(useCluster) cluster.removeLayer(m); map.removeLayer(m);}catch(_){}}); 
  stekMarkers.clear(); rigMarkers.clear(); 
  try{if(cluster&&map.hasLayer(cluster)){cluster.clearLayers(); map.removeLayer(cluster);}}catch(_){} 
}
function attachMarker(m,type,id){
  if(m.dragging) m.dragging.enable();
  m.on('dragstart',function(){try{map.dragging.disable();}catch(_){ } if(useCluster){try{cluster.removeLayer(m);}catch(_){ } m.addTo(map);}});
  m.on('drag',function(){ drawDistances(); });
  m.on('dragend',function(ev){
    try{map.dragging.enable();}catch(_){ }
    if(useCluster){try{map.removeLayer(m);}catch(_){ } cluster.addLayer(m);}
    var ll=ev.target.getLatLng();
    if(type==='stek'){
      var s=db.steks.find(function(x){return x.id===id;});
      if(s){ s.lat=ll.lat; s.lng=ll.lng; s.waterId = nearestWaterIdForLatLng(ll.lat,ll.lng) || s.waterId || null; }
    }
    if(type==='rig'){
      var r=db.rigs.find(function(x){return x.id===id;});
      if(r){ r.lat=ll.lat; r.lng=ll.lng; r.waterId = nearestWaterIdForLatLng(ll.lat,ll.lng) || r.waterId || null; }
    }
    saveDB(); renderAll(); S(type+' verplaatst & gekoppeld.');
  });
  m.on('click',function(ev){ if(!selectMode) return; ev.originalEvent.preventDefault();ev.originalEvent.stopPropagation(); var ll=m.getLatLng(); var key=String(ll.lat.toFixed(7)+","+ll.lng.toFixed(7)); var icon=ev.target._icon; if(selection.points.has(key)){ selection.points.delete(key); if(icon&&icon.classList) icon.classList.remove('sel'); } else { selection.points.add(key); if(icon&&icon.classList) icon.classList.add('sel'); } updateSelInfo(); });
}
function makeStekMarker(s){var m=L.marker([s.lat,s.lng],{draggable:true,pane:'markerPane',autoPan:true,autoPanPadding:[60,60],riseOnHover:true,bubblingMouseEvents:false}); attachMarker(m,'stek',s.id); m.bindTooltip((s.name||"Stek"),{direction:'top'}); stekMarkers.set(s.id,m); return m;}
function makeRigMarker(r){var s=db.steks.find(function(x){return x.id===r.stekId;}); var m=L.marker([r.lat,r.lng],{draggable:true,pane:'markerPane',autoPan:true,autoPanPadding:[60,60],riseOnHover:true,bubblingMouseEvents:false}); attachMarker(m,'rig',r.id); m.bindTooltip((r.name||"Rig")+(s? " • "+(s.name||s.id):""),{direction:'top'}); rigMarkers.set(r.id,m); return m;}

// ===== v1.1.3: water-koppeling helpers =====
function nearestWaterIdForLatLng(lat, lng, edgeMaxMeters){
  edgeMaxMeters = edgeMaxMeters || (parseFloat(document.getElementById("detMaxEdge").value)||250);
  if(!db.waters || !db.waters.length) return null;
  var pt = turf.point([lng, lat]);
  var best = {id:null, inside:false, dist:Infinity, name:null};

  db.waters.forEach(function(w){
    var f = (w.geojson && w.geojson.features && w.geojson.features[0]) ? w.geojson.features[0] : null;
    if(!f) return;
    var inside=false;
    try{ inside = turf.booleanPointInPolygon(pt, f); }catch(_){ inside=false; }
    var d=Infinity;
    try{
      var line = turf.polygonToLine(f);
      d = turf.pointToLineDistance(pt, line, {units:'meters'});
    }catch(_){}

    var better=false;
    if(inside && !best.inside) better=true;
    else if(inside && best.inside) better = d < best.dist - 1e-9;
    else if(!inside && !best.inside) better = d < best.dist - 1e-9;

    if(better){
      best.id = w.id; best.inside = inside; best.dist = d; best.name = w.name||w.id;
    }
  });

  if(best.id==null) return null;
  if(!best.inside && !(best.dist<=edgeMaxMeters)) return null;
  return best.id;
}

// simpele picker
function pickFromList(title, items){
  var html = '<div style="position:fixed;inset:0;background:#0008;z-index:999999;display:flex;align-items:center;justify-content:center">' +
             '<div style="background:#0e151d;border:1px solid #233;border-radius:10px;padding:12px;min-width:320px">' +
             '<div style="font-weight:600;margin-bottom:8px">'+title+'</div>' +
             '<select id="__pickSel" style="width:100%;margin-bottom:10px">';
  items.forEach(function(it){ html+='<option value="'+esc(it.id)+'">'+esc(it.text)+'</option>'; });
  html+='</select><div style="text-align:right">' +
        '<button id="__pickOk">OK</button> <button id="__pickCancel">Annuleren</button>' +
        '</div></div></div>';
  var wrap=document.createElement('div'); wrap.innerHTML=html;
  document.body.appendChild(wrap);
  return new Promise(function(res){
    wrap.querySelector('#__pickOk').onclick=function(){ var v=wrap.querySelector('#__pickSel').value; wrap.remove(); res(v); };
    wrap.querySelector('#__pickCancel').onclick=function(){ wrap.remove(); res(null); };
  });
}

// Nieuwe stek/rig knoppen (met auto-water koppeling)
document.getElementById('btn-add-stek').addEventListener('click',function(){
  var c=map.getCenter();
  var wId = nearestWaterIdForLatLng(c.lat, c.lng);
  db.steks.push({id:uid('stek'),name:'Stek',lat:c.lat,lng:c.lng,waterId:wId||null});
  saveDB(); renderAll();
});
document.getElementById('btn-add-rig').addEventListener('click',function(){
  var c=map.getCenter();
  var wId = nearestWaterIdForLatLng(c.lat, c.lng);
  db.rigs.push({id:uid('rig'),name:'Rig',lat:c.lat,lng:c.lng,stekId:null,waterId:wId||null});
  saveDB(); renderAll();
});

// ===== afstanden tekenen =====
document.getElementById("showDistances").addEventListener("change", drawDistances);
function drawDistances(){
  measureLayer.clearLayers(); if(!document.getElementById("showDistances").checked) return;
  db.steks.forEach(function(s){ db.rigs.filter(function(r){return r.stekId===s.id;}).forEach(function(r){
    var d=distM({lat:s.lat,lon:s.lng},{lat:r.lat,lon:r.lng});
    L.polyline([[s.lat,s.lng],[r.lat,r.lng]],{color:"#7bf1a8",weight:2,opacity:0.9,pane:'measurePane',interactive:false}).addTo(measureLayer);
    var mid=L.latLng((s.lat+r.lat)/2,(s.lng+r.lng)/2);
    L.tooltip({permanent:true,direction:"center",className:"dist-label",pane:'labelsPane',interactive:false}).setContent(String(Math.round(d))+" m").setLatLng(mid).addTo(measureLayer);
  });});
}

// ===== utils =====
function distM(a,b){ var lat=(a.lat+b.lat)/2, kx=111320*Math.cos(lat*Math.PI/180), ky=110540; var dx=(a.lon-b.lon)*kx, dy=(a.lat-b.lat)*ky; return Math.sqrt(dx*dx+dy*dy); }
function nameOfWater(id){ var w=db.waters.find(function(x){return x.id===id;}); return w? (w.name||w.id) : null; }

// ===== render / overview =====
function renderAll(){
  purgeAllMarkers();
  if(useCluster){ cluster=L.markerClusterGroup({disableClusteringAtZoom:19}); map.addLayer(cluster); }
  waterGroup.clearLayers(); isobandLayer.clearLayers(); contourLayer.clearLayers(); measureLayer.clearLayers();

  db.waters.forEach(function(w){
    var color=db.settings.waterColor||"#33a1ff";
    var gj=L.geoJSON(w.geojson,{pane:'waterPane',interactive:true,style:function(){return {color:color,weight:2,fillOpacity:0.25};}});
    gj.eachLayer(function(layer){
      if(layer.feature && layer.feature.properties){
        layer.feature.properties.id = w.id;
        layer.feature.properties.kind = 'water';
        layer.feature.properties.name = w.name||'';
      }
      layer.on('click',function(){ selectWater(w.id); });
      waterGroup.addLayer(layer);
    });
  });
  waterGroup.addTo(map);

  db.steks.forEach(function(s){ var m=makeStekMarker(s); if(useCluster) cluster.addLayer(m); else m.addTo(map); });
  db.rigs.forEach(function(r){ var m=makeRigMarker(r); if(useCluster) cluster.addLayer(m); else m.addTo(map); });

  drawDistances();
  buildOverview();
}

function selectWater(id){
  waterGroup.eachLayer(function(l){
    if(l.setStyle){
      var propId=(l.feature&&l.feature.properties&&l.feature.properties.id);
      l.setStyle({weight:(propId===id)?4:2});
    }
  });
}

// overzicht-tabellen (met her-koppelen)
function buildOverview(){
  document.querySelectorAll(".tab").forEach(function(btn){
    btn.onclick=function(){
      document.querySelectorAll(".tab").forEach(function(b){b.classList.remove("active");});
      btn.classList.add("active");
      document.getElementById("tab-waters").style.display=(btn.dataset.tab==="waters")?"block":"none";
      document.getElementById("tab-steks").style.display =(btn.dataset.tab==="steks") ?"block":"none";
      document.getElementById("tab-rigs").style.display  =(btn.dataset.tab==="rigs")  ?"block":"none";
    };
  });

  var tw=document.getElementById("tab-waters"); tw.innerHTML="";
  var wTable=document.createElement("table");
  wTable.innerHTML='<thead><tr><th>Naam</th><th>ID</th><th>Stekken</th><th>Rigspots</th><th colspan="2"></th></tr></thead><tbody></tbody>';
  var wBody=wTable.querySelector("tbody");
  db.waters.forEach(function(w){
    var steks=db.steks.filter(function(s){return s.waterId===w.id;});
    var rigs=0; steks.forEach(function(s){ rigs+=db.rigs.filter(function(r){return r.stekId===s.id;}).length; });
    var tr=document.createElement("tr");
    tr.innerHTML='<td>'+esc(w.name||"(onbenoemd)")+'</td><td>'+w.id+'</td><td>'+steks.length+'</td><td>'+rigs+'</td>'+
      '<td><button data-id="'+w.id+'" class="btn small btnRenWater">Hernoem</button></td>'+
      '<td><button data-id="'+w.id+'" class="btn small btnDelWater">Verwijder</button></td>';
    tr.onclick=function(ev){ if(ev.target.closest('button')) return; try{ var g=L.geoJSON(w.geojson); var B=g.getBounds(); if(B.isValid()) map.fitBounds(B.pad(0.08)); }catch(_){ } };
    wBody.appendChild(tr);
  });
  tw.appendChild(wTable);

  var ts=document.getElementById("tab-steks"); ts.innerHTML="";
  var sTable=document.createElement("table");
  sTable.innerHTML='<thead><tr><th>Naam</th><th>ID</th><th>Water</th><th>Rigspots</th><th colspan="3"></th></tr></thead><tbody></tbody>';
  var sBody=sTable.querySelector("tbody");
  db.steks.forEach(function(s){
    var rigs=db.rigs.filter(function(r){return r.stekId===s.id;}).length; var wName=nameOfWater(s.waterId)||"(geen)";
    var tr=document.createElement("tr");
    tr.innerHTML='<td>'+esc(s.name||"(stek)")+'</td><td>'+s.id+'</td><td>'+esc(wName)+'</td><td>'+rigs+'</td>'+
      '<td><button data-id="'+s.id+'" class="btn small btnRenStek">Hernoem</button></td>'+
      '<td><button data-id="'+s.id+'" class="btn small btnReWaterStek">Koppel water</button></td>'+
      '<td><button data-id="'+s.id+'" class="btn small danger btnDelStek">Verwijder</button></td>';
    tr.onclick=function(ev){ if(ev.target.closest('button')) return; map.setView([s.lat,s.lng], Math.max(map.getZoom(),17)); };
    sBody.appendChild(tr);
  });
  ts.appendChild(sTable);

  var trc=document.getElementById("tab-rigs"); trc.innerHTML="";
  var rTable=document.createElement("table");
  rTable.innerHTML='<thead><tr><th>Naam</th><th>ID</th><th>Stek</th><th>Water</th><th colspan="4"></th></tr></thead><tbody></tbody>';
  var rBody=rTable.querySelector("tbody");
  db.rigs.forEach(function(r){
    var s=db.steks.find(function(x){return x.id===r.stekId;});
    var tr=document.createElement("tr");
    tr.innerHTML='<td>'+esc(r.name||"(rig)")+'</td><td>'+r.id+'</td><td>'+esc(s?(s.name||s.id):"(geen)")+'</td><td>'+esc(nameOfWater(r.waterId)||"(auto)")+'</td>'+
      '<td><button data-id="'+r.id+'" class="btn small btnRenRig">Hernoem</button></td>'+
      '<td><button data-id="'+r.id+'" class="btn small btnReStekRig">Koppel stek</button></td>'+
      '<td><button data-id="'+r.id+'" class="btn small btnReWaterRig">Koppel water</button></td>'+
      '<td><button data-id="'+r.id+'" class="btn small btnDelRig danger">Verwijder</button></td>';
    tr.onclick=function(ev){ if(ev.target.closest('button')) return; map.setView([r.lat,r.lng], Math.max(map.getZoom(),18)); };
    rBody.appendChild(tr);
  });
  trc.appendChild(rTable);

  // events voor actieknoppen
  tw.querySelectorAll(".btnRenWater").forEach(function(b){ b.onclick=function(ev){ renameWater(ev.target.dataset.id); }; });
  tw.querySelectorAll(".btnDelWater").forEach(function(b){ b.onclick=function(ev){ var id=ev.target.dataset.id; if(!confirm("Water verwijderen?")) return;
    db.waters=db.waters.filter(function(x){return x.id!==id;}); db.steks.forEach(function(s){ if(s.waterId===id) s.waterId=null; }); db.rigs.forEach(function(r){ if(r.waterId===id) r.waterId=null; }); saveDB(); renderAll(); }; });

  ts.querySelectorAll(".btnRenStek").forEach(function(b){ b.onclick=function(ev){ renameStek(ev.target.dataset.id); }; });
  ts.querySelectorAll(".btnDelStek").forEach(function(b){ b.onclick=function(ev){ var id=ev.target.dataset.id; if(!confirm("Stek verwijderen?")) return; removeStek(id); }; });
  ts.querySelectorAll(".btnReWaterStek").forEach(function(b){
    b.onclick = async function(ev){
      var id = ev.target.dataset.id;
      var s = db.steks.find(function(x){return x.id===id;});
      if(!s){ return; }
      var pt=turf.point([s.lng,s.lat]);
      var arr=db.waters.map(function(w){
        var f=(w.geojson && w.geojson.features && w.geojson.features[0])?w.geojson.features[0]:null;
        var d=1e12,inside=false;
        if(f){
          try{inside=turf.booleanPointInPolygon(pt,f);}catch(_){}
          try{var line=turf.polygonToLine(f); d=turf.pointToLineDistance(pt,line,{units:'meters'});}catch(_){}
        }
        return {id:w.id, text:(w.name||w.id)+(inside?' (binnen)':'')+' • '+Math.round(d)+' m', d:d, inside:inside};
      }).sort(function(a,b){ return (a.inside===b.inside)?(a.d-b.d):(a.inside?-1:1); });
      var pick = await pickFromList('Koppel stek aan water', arr.slice(0,30));
      if(pick){ s.waterId=pick; saveDB(); renderAll(); S("Stek gekoppeld aan water."); }
    };
  });

  trc.querySelectorAll(".btnRenRig").forEach(function(b){ b.onclick=function(ev){ renameRig(ev.target.dataset.id); }; });
  trc.querySelectorAll(".btnDelRig").forEach(function(b){ b.onclick=function(ev){ var id=ev.target.dataset.id; if(!confirm("Rigspot verwijderen?")) return; removeRig(id); }; });
  trc.querySelectorAll(".btnReStekRig").forEach(function(b){
    b.onclick = async function(ev){
      var id = ev.target.dataset.id;
      var r = db.rigs.find(function(x){return x.id===id;});
      if(!r) return;
      var arr=db.steks.map(function(s){
        var d = distM({lat:r.lat,lon:r.lng},{lat:s.lat,lon:s.lng});
        return {id:s.id, text:(s.name||s.id)+' • '+Math.round(d)+' m', d:d};
      }).sort(function(a,b){ return a.d-b.d; });
      var pick = await pickFromList('Koppel rig aan stek', arr.slice(0,50));
      if(pick){ r.stekId=pick; saveDB(); renderAll(); S("Rig gekoppeld aan stek."); }
    };
  });
  trc.querySelectorAll(".btnReWaterRig").forEach(function(b){
    b.onclick = async function(ev){
      var id = ev.target.dataset.id;
      var r = db.rigs.find(function(x){return x.id===id;});
      if(!r) return;
      var pt=turf.point([r.lng,r.lat]);
      var arr=db.waters.map(function(w){
        var f=(w.geojson && w.geojson.features && w.geojson.features[0])?w.geojson.features[0]:null;
        var d=1e12,inside=false;
        if(f){
          try{inside=turf.booleanPointInPolygon(pt,f);}catch(_){}
          try{var line=turf.polygonToLine(f); d=turf.pointToLineDistance(pt,line,{units:'meters'});}catch(_){}
        }
        return {id:w.id, text:(w.name||w.id)+(inside?' (binnen)':'')+' • '+Math.round(d)+' m', d:d, inside:inside};
      }).sort(function(a,b){ return (a.inside===b.inside)?(a.d-b.d):(a.inside?-1:1); });
      var pick = await pickFromList('Koppel rig aan water', arr.slice(0,30));
      if(pick){ r.waterId=pick; saveDB(); renderAll(); S("Rig gekoppeld aan water."); }
    };
  });
}

// eenvoudige rename/remove
function renameWater(id){ var w=db.waters.find(function(x){return x.id===id;}); if(!w) return; var nv=prompt("Nieuwe waternaam:", w.name||""); if(nv==null) return; w.name=String(nv).trim(); if(w.geojson&&w.geojson.features){ w.geojson.features.forEach(function(f){if(!f.properties) f.properties={}; f.properties.name=w.name; f.properties.id=w.id; f.properties.kind='water';}); } saveDB(); renderAll(); S("Water hernoemd."); }
function renameStek(id){ var s=db.steks.find(function(x){return x.id===id;}); if(!s) return; var nv=prompt("Nieuwe steknaam:", s.name||""); if(nv==null) return; s.name=String(nv).trim(); saveDB(); renderAll(); S("Stek hernoemd."); }
function renameRig(id){ var r=db.rigs.find(function(x){return x.id===id;}); if(!r) return; var nv=prompt("Nieuwe rigspotnaam:", r.name||""); if(nv==null) return; r.name=String(nv).trim(); saveDB(); renderAll(); }
function removeStek(id){ db.steks=db.steks.filter(function(s){return s.id!==id;}); db.rigs.forEach(function(r){ if(r.stekId===id) r.stekId=null; }); saveDB(); renderAll(); }
function removeRig(id){ db.rigs=db.rigs.filter(function(r){return r.id!==id;}); saveDB(); renderAll(); }

// init
renderAll();
S('Klaar.');

(function(global){
  function nodeMap(elements){var m=new Map();for(var i=0;i<elements.length;i++){var el=elements[i];if(el.type==='node')m.set(el.id,[el.lon,el.lat]);}return m;}
  function wayMap(elements){var m=new Map();for(var i=0;i<elements.length;i++){var el=elements[i];if(el.type==='way')m.set(el.id,{nodes:el.nodes||[],tags:el.tags||{}});}return m;}
  function getCoordsOfWay(way,nmap){var c=[];for(var i=0;i<way.nodes.length;i++){var nid=way.nodes[i];var p=nmap.get(nid);if(!p)return null;c.push(p);}return c;}
  function isClosed(c){if(!c||c.length<4)return false;var a=c[0],b=c[c.length-1];return a[0]===b[0]&&a[1]===b[1];}
  function stitchRings(list){var rings=[];var segs=list.map(function(a){return a.slice();});while(segs.length){var ring=segs.shift(),loop=true;while(loop){loop=false;for(var i=0;i<segs.length;i++){var s=segs[i],h=ring[0],t=ring[ring.length-1],sh=s[0],st=s[s.length-1];if(t[0]===sh[0]&&t[1]===sh[1]){ring=ring.concat(s.slice(1));segs.splice(i,1);loop=true;break;}if(t[0]===st[0]&&t[1]===st[1]){ring=ring.concat(s.slice(0,-1).reverse());segs.splice(i,1);loop=true;break;}if(h[0]===st[0]&&h[1]===st[1]){ring=s.concat(ring.slice(1));segs.splice(i,1);loop=true;break;}if(h[0]===sh[0]&&h[1]===sh[1]){ring=s.slice(0,-1).reverse().concat(ring);segs.splice(i,1);loop=true;break;}}}if(ring.length&&(ring[0][0]!==ring[ring.length-1][0]||ring[0][1]!==ring[ring.length-1][1]))ring.push(ring[0]);if(ring.length>=4)rings.push(ring);}return rings;}
  function relationToMP(rel,wmap,nmap){var outerWays=[],innerWays=[];for(var i=0;i<rel.members.length;i++){var m=rel.members[i];if(m.type!=='way')continue;var w=wmap.get(m.ref);if(!w)continue;var coords=getCoordsOfWay(w,nmap);if(!coords)continue;(m.role==='inner'?innerWays:outerWays).push(coords);}var outers=stitchRings(outerWays),inners=stitchRings(innerWays);if(!outers.length)return null;function bbox(r){var minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=Infinity*-1;for(var i=0;i<r.length;i++){var c=r[i];if(c[0]<minx)minx=c[0];if(c[0]>maxx)maxx=c[0];if(c[1]<miny)miny=c[1];if(c[1]>maxy)maxy=c[1];}return[minx,miny,maxx,maxy]}function inside(bi,bo){return bi[0]>=bo[0]-1e-10&&bi[2]<=bo[2]+1e-10&&bi[1]>=bo[1]-1e-10&&bi[3]<=bo[3]+1e-10}
    var ouB=outers.map(bbox);var polys=outers.map(function(o){return[o];});
    for(var j=0;j<inners.length;j++){var inner=inners[j];var bi=bbox(inner);var idx=-1;for(var k=0;k<outers.length;k++){if(inside(bi,ouB[k])){idx=k;break;}}if(idx>=0)polys[idx].push(inner);}
    return polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys.map(function(p){return[p];})};
  }
  function overpassToGeoJSON(data){var elements=data.elements||[],nmap=nodeMap(elements),wmap=wayMap(elements),features=[];for(var i=0;i<elements.length;i++){var el=elements[i];if(el.type==='way'){var way=wmap.get(el.id),coords=getCoordsOfWay(way,nmap);if(coords&&isClosed(coords)){features.push({type:'Feature',properties:{id:el.id,kind:'way',tags:el.tags||{}},geometry:{type:'Polygon',coordinates:[coords]}});}}}for(var j=0;j<elements.length;j++){var el2=elements[j];if(el2.type==='relation'&&el2.tags&&(el2.tags.type==='multipolygon'||el2.tags.type==='boundary')){var geom=relationToMP(el2,wmap,nmap);if(geom){features.push({type:'Feature',properties:{id:el2.id,kind:'relation',tags:el2.tags||{}},geometry:geom});}}}return{type:'FeatureCollection',features:features};}
  global.__overpassToGeoJSON=overpassToGeoJSON;
})(window);

// merge helpers (aansluitende wateren)
function featuresTouchOrOverlap(a,b){
  try{
    if (turf.booleanIntersects(a,b)) return true;
    var eps=0.00001; // ~1 m in km-units buffer
    var ab=turf.buffer(a, eps, {units:'kilometers'});
    return turf.booleanIntersects(ab,b);
  }catch(_){ return false; }
}
function mergeTouchingPolys(features){
  var list = features.slice();
  var changed=true;
  while(changed && list.length>1){
    changed=false;
    outer: for(var i=0;i<list.length;i++){
      for(var j=i+1;j<list.length;j++){
        var A=list[i], B=list[j];
        var bbA=turf.bbox(A), bbB=turf.bbox(B);
        if(bbA[2]<bbB[0]||bbB[2]<bbA[0]||bbA[3]<bbB[1]||bbB[3]<bbA[1]) continue;
        if(featuresTouchOrOverlap(A,B)){
          var U=null;
          try{ U=turf.union(A,B); }catch(_){}
          if(U){
            U.properties = Object.assign({}, A.properties||{}, B.properties||{}, {merged:true});
            list.splice(j,1); list.splice(i,1,U);
          }
          changed=true;
          break outer;
        }
      }
    }
  }
  return list;
}

// Detectie OSM
var OVERPASS="https://overpass-api.de/api/interpreter";
document.getElementById("btnDetectOSM").addEventListener('click', function(){
  var b=map.getBounds();
  var bbox=[b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(',');
  var q='[out:json][timeout:25];(way["natural"="water"]('+bbox+'); relation["natural"="water"]('+bbox+');way["waterway"="riverbank"]('+bbox+'); relation["waterway"="riverbank"]('+bbox+');way["water"]('+bbox+'); relation["water"]('+bbox+'););out body; >; out skel qt;';
  S("OSM: ophalen…");
  fetch(OVERPASS,{method:'POST',body:q,headers:{'Content-Type':'text/plain;charset=UTF-8'}}).then(function(res){
    if(!res.ok){ S("OSM: status "+res.status); return null; }
    return res.json();
  }).then(function(data){
    if(!data) return;
    var gj=__overpassToGeoJSON(data);
    var bb=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
    var polys=[];
    (gj.features||[]).forEach(function(f){
      if(!f.geometry) return;
      if(f.geometry.type==="Polygon"||f.geometry.type==="MultiPolygon"){
        try{
          var c=turf.bboxClip(f,bb);
          if(c && c.geometry && c.geometry.coordinates && c.geometry.coordinates.length){
            polys.push(c);
          }
        }catch(_){}
      }
    });
    if(!polys.length){ S("Geen OSM-water in beeld."); I("0 polygonen"); return; }

    var mergedList = mergeTouchingPolys(polys);
    var fc = {type:'FeatureCollection',features:mergedList};
    if(selection.preview){ map.removeLayer(selection.preview); selection.preview=null; }
    selection.preview=L.geoJSON(fc,{pane:'waterPane',style:{color:'#00e5ff',weight:2,fillOpacity:0.25}}).addTo(map);

    var msg = (mergedList.length===1) ? "1 samengevoegd waterpoly (eilanden behouden)" : (mergedList.length+" water-polys (samengevoegd waar mogelijk)");
    I(msg); S("OSM-water gedetecteerd. Klik ‘Opslaan’ om als water op te slaan.");
  }).catch(function(){ S("OSM: netwerkfout / rate-limit."); });
});

// Opslaan naar water
document.getElementById("btnSaveAsWater").addEventListener('click', function(){
  var gj=null;
  if(selection.preview){ selection.preview.eachLayer(function(l){ try{ gj=l.toGeoJSON(); }catch(_){ } }); }
  else {
    var pts=pointsInViewport(800);
    gj=polygonFromPtsLngLat(pts);
  }
  if(!gj){ S("Geen poly om op te slaan. Gebruik detectie-knoppen."); return; }
  var name=(document.getElementById("detName").value||("Water "+new Date().toISOString().slice(0,16).replace('T',' '))).trim();
  saveWaterFeature(gj,name);
  if(selection.preview){ map.removeLayer(selection.preview); selection.preview=null; }
  selection.points.clear(); selection.bestWater=null; 
});
function saveWaterFeature(feat,name){
  var id=uid("water"); var f=JSON.parse(JSON.stringify(feat));
  if(!f.properties) f.properties={};
  f.properties.kind='water'; f.properties.name=name; f.properties.id=id;
  var fc={type:'FeatureCollection',features:[f]};
  db.waters.push({id:id,name:name,geojson:fc}); saveDB(); renderAll(); S("Water aangemaakt: "+name);
}

// ——— Deeper import & Heatmap ———
var hmRadius = document.getElementById("hmRadius"),
    hmBlur   = document.getElementById("hmBlur"),
    hmMin    = document.getElementById("hmMin"),
    hmMax    = document.getElementById("hmMax"),
    hmInvert = document.getElementById("hmInvert"),
    hmClip   = document.getElementById("hmClip"),
    hmFixed  = document.getElementById("hmFixed");

document.getElementById("hmR").textContent = hmRadius.value;
document.getElementById("hmB").textContent = hmBlur.value;

hmRadius.addEventListener("input", function(){ document.getElementById("hmR").textContent = hmRadius.value; if(window.heatLayer) applyHeatFromRaw(); });
hmBlur  .addEventListener("input", function(){ document.getElementById("hmB").textContent = hmBlur.value; if(window.heatLayer) applyHeatFromRaw(); });
[hmMin, hmMax, hmInvert, hmClip].forEach(function(el){ el.addEventListener("change", applyHeatFromRaw); });
hmFixed.addEventListener("change", function(){
  if(hmFixed.checked){ hmMin.value=0; hmMax.value=20; hmMin.disabled=true; hmMax.disabled=true; }
  else { hmMin.disabled=false; hmMax.disabled=false; }
  applyHeatFromRaw();
});

var fImpBar=document.getElementById("impBarAll"), fImpPct=document.getElementById("impPctAll"), fImpCount=document.getElementById("impCount");
function setOverall(done,total){
  var pct=Math.round((done/Math.max(1,total))*100);
  if(fImpCount) fImpCount.textContent=done+"/"+total;
  if(fImpPct) fImpPct.textContent=pct+"%";
  if(fImpBar) fImpBar.style.width=pct+"%";
}

// DB koppeling
var heatLayer = window.heatLayer || null;
var rawAll = (db.bathy && Array.isArray(db.bathy.points)) ? db.bathy.points.slice() : [];
var currentPoints = [];
var autoMin=0, autoMax=0;

function setBathyTotal(n){ var el=document.getElementById("bathyTotal"); if(el) el.textContent=String(n||0); }
function setHeatCount(n){ var el=document.getElementById("heatCount"); if(el) el.textContent=String(n||0); }

function updateLegend(min,max,inv){
  var st=document.getElementById("hmStats");
  if(st) st.textContent = "Min: " + (min==null?"auto":min) + " m • Max: " + (max==null?"auto":max) + " m";
  var lg=document.getElementById("legend");
  if(lg){ lg.classList.toggle('inv', !!inv); }
}
function scaleDepth(val,min,max,inv){
  if(min==null||max==null||isNaN(min)||isNaN(max)){
    return 1 - Math.max(0,Math.min(1,(val - autoMin)/((autoMax - autoMin)||1)));
  }
  var t = Math.max(0,Math.min(1,(val - min)/((max - min)||1)));
  return inv ? (1 - t) : t;
}
function buildHeat(points){
  if (!window.L || !L.heatLayer) { S("Heatmap plugin niet geladen (controleer internet/CDN)."); return; }
  if(heatLayer){ try{ map.removeLayer(heatLayer); }catch(_){} }
  heatLayer = L.heatLayer(points, {radius: Number(hmRadius.value), blur: Number(hmBlur.value), pane:'heatPane'}).addTo(map);
  window.heatLayer = heatLayer;
  setHeatCount(points.length||0);
}
function applyHeatFromRaw(){
  currentPoints = [];
  if(!rawAll.length){
    if(heatLayer){ map.removeLayer(heatLayer); heatLayer=null; }
    setHeatCount(0); return;
  }
  var minV = (hmFixed.checked ? 0 : parseFloat(hmMin.value));
  var maxV = (hmFixed.checked ? 20 : parseFloat(hmMax.value));
  var inv  = !!hmInvert.checked;
  var clip = !!hmClip.checked;

  var dmin=Infinity, dmax=-Infinity;
  for(var i=0;i<rawAll.length;i++){
    var d=rawAll[i].dep; if(!isNaN(d)){ if(d<dmin)dmin=d; if(d>dmax)dmax=d; }
  }
  autoMin=dmin; autoMax=dmax;

  var b=map.getBounds();
  for(var j=0;j<rawAll.length;j++){
    var p=rawAll[j];
    if(clip && !(p.lat>=b.getSouth()&&p.lat<=b.getNorth()&&p.lon>=b.getWest()&&p.lon<=b.getEast())) continue;
    var w=scaleDepth(p.dep, isNaN(minV)?null:minV, isNaN(maxV)?null:maxV, inv);
    currentPoints.push([p.lat,p.lon,w]);
  }
  updateLegend(isNaN(minV)?null:minV, isNaN(maxV)?null:maxV, inv);
  buildHeat(currentPoints);
}

// Import UI
var btnFiles = document.getElementById("btn-import-files"),
    btnDir   = document.getElementById("btn-import-dir"),
    fileInp  = document.getElementById("fileDeeper"),
    dirInp   = document.getElementById("dirDeeper");

btnFiles.addEventListener("click", function(){ try{ fileInp.value=null; }catch(_){} fileInp.click(); });
btnDir  .addEventListener("click", function(){ try{ dirInp.value=null; }catch(_){} dirInp.click(); });
fileInp.addEventListener("change", function(e){ handleFiles([].slice.call(e.target.files||[])); });
dirInp .addEventListener("change", function(e){ handleFiles([].slice.call(e.target.files||[])); });

var queueDiv   = document.getElementById("queue");
function setQueue(names){ if(queueDiv) queueDiv.textContent = names.join("\n"); }

// CSV parse
function parseCSV(text, seen){
  var lines = text.replace(/\r\n?/g,"\n").split("\n").filter(function(x){return x.trim().length>0;});
  if(lines.length<1) return {points:[], raw:[]};
  var first = lines[0];
  var semi = (first.split(";").length-1) > (first.split(",").length-1);
  var delim = semi ? ";" : ",";
  var header = lines[0].split(delim).map(function(h){return h.trim();});
  var startIdx = 1;

  var iLat = header.findIndex(function(h){return /^latitude$/i.test(h)||/lat/i.test(h);});
  var iLon = header.findIndex(function(h){return /^longitude$/i.test(h)||/(lon|lng)/i.test(h);});
  var iDep = header.findIndex(function(h){return /^depth( ?\(m\))?$/i.test(h)||/^(depth|dep|diepte)/i.test(h);});
  if(iLat<0||iLon<0||iDep<0){ iLat=0;iLon=1;iDep=2; startIdx=0; }

  function toNum(v){ if(v==null) return NaN; v=String(v).trim().replace(/^"(.*)"$/,'$1'); v=v.replace(',', '.'); var n=parseFloat(v); return (Number.isFinite(n)?n:NaN); }

  var rawPts=[], dmin=Infinity, dmax=-Infinity;
  for(var i=startIdx;i<lines.length;i++){
    var cols=lines[i].split(delim);
    var lat=toNum(cols[iLat]), lon=toNum(cols[iLon]), dep=toNum(cols[iDep]);
    if(Number.isFinite(lat)&&Number.isFinite(lon)&&Number.isFinite(dep)){
      if(!(Math.abs(lat)<1e-9 && Math.abs(lon)<1e-9)){
        var k=lat.toFixed(6)+","+lon.toFixed(6)+","+dep.toFixed(2);
        if(!seen.has(k)){ seen.add(k); rawPts.push({lat:lat,lon:lon,dep:dep}); dmin=Math.min(dmin,dep); dmax=Math.max(dmax,dep); }
      }
    }
  }
  autoMin=dmin; autoMax=dmax;

  var minV = (hmFixed && hmFixed.checked) ? 0 : parseFloat(hmMin.value);
  var maxV = (hmFixed && hmFixed.checked) ? 20 : parseFloat(hmMax.value);
  var inv  = !!hmInvert.checked, clip=!!hmClip.checked;
  var b=map.getBounds();

  var out=[];
  for(var t=0;t<rawPts.length;t++){
    var p=rawPts[t];
    if(clip && !(p.lat>=b.getSouth()&&p.lat<=b.getNorth()&&p.lon>=b.getWest()&&p.lon<=b.getEast())) continue;
    var w=scaleDepth(p.dep, isNaN(minV) ? null : minV, isNaN(maxV) ? null : maxV, inv);
    out.push([p.lat,p.lon,w]);
  }
  updateLegend(isNaN(minV) ? null : minV, isNaN(maxV) ? null : maxV, inv);
  return {points:out, raw:rawPts};
}

// ZIP + CSV handling
function handleFiles(files){
  if(!files.length){ S("Geen bestanden."); return; }
  S("Voorbereiden: ZIPs uitpakken en CSVs verzamelen…");
  var saveToDB = !!document.getElementById("saveBathy").checked;
  var rawAccumulator=[], seen=new Set(), live=[], tasks=[], q=[], done=0, total=0, pendingZips=0;

  for(var i=0;i<files.length;i++){
    (function(f){
      var name=(f.webkitRelativePath||f.name||"onbekend");
      if(/\.csv$/i.test(name)){
        tasks.push({label:name, fetchText:function(){ return f.text(); }});
      }else if(/\.zip$/i.test(name)){
        pendingZips++;
        JSZip.loadAsync(f).then(function(zip){
          Object.keys(zip.files).forEach(function(k){
            var zf=zip.files[k];
            if(zf.dir) return;
            if(/\.csv$/i.test(k)){
              tasks.push({label:name+"::"+k, fetchText:function(){ return zf.async("text"); }});
            }
          });
        }).catch(function(){ /* ignore */ })
          .finally(function(){ pendingZips--; if(pendingZips===0) afterEnumerate(); });
      }
    })(files[i]);
  }
  if(pendingZips===0) afterEnumerate();

  function afterEnumerate(){
    q = tasks.map(function(t){ return t.label; });
    total = tasks.length;
    setQueue(q); setOverall(0, Math.max(1,total));
    if(!total){ S("Geen CSVs gevonden."); return; }
    S("Importeren gestart… ("+total+" CSVs)");

    (function nextTask(idx){
      if(idx>=tasks.length){
        setOverall(total,total);
        if(saveToDB && rawAccumulator.length){
          if(!db.bathy) db.bathy={points:[],datasets:[]};
          var seenDB=new Set();
          for(var i=0;i<db.bathy.points.length;i++){
            var p=db.bathy.points[i];
            seenDB.add(p.lat.toFixed(6)+","+p.lon.toFixed(6)+","+p.dep.toFixed(2));
          }
          var added=0;
          for(var j=0;j<rawAccumulator.length;j++){
            var qpt=rawAccumulator[j];
            var key=qpt.lat.toFixed(6)+","+qpt.lon.toFixed(6)+","+qpt.dep.toFixed(2);
            if(!seenDB.has(key)){ seenDB.add(key); db.bathy.points.push(qpt); added++; }
          }
          db.bathy.datasets.push({id:"ds_"+Math.random().toString(36).slice(2,9), ts:Date.now(), files: total, added: added});
          saveDB();
          rawAll = db.bathy.points.slice();
          setBathyTotal(db.bathy.points.length);
          applyHeatFromRaw();
          S("Import klaar. DB +"+added+" punt(en).");
        }else{
          if(live.length){ buildHeat(live); S("Heatmap: "+live.length+" punt(en)."); }
          else { S("Geen punten gevonden."); }
        }
        return;
      }

      var t=tasks[idx];
      t.fetchText().then(function(txt){
        var res = parseCSV(txt, seen);
        if(res.points && res.points.length){
          live = live.concat(res.points);
          buildHeat(live);
        }
        if(res.raw && res.raw.length){
          rawAccumulator = rawAccumulator.concat(res.raw);
          setBathyTotal((db.bathy.points.length||0) + rawAccumulator.length);
        }
        done++;
        q = q.filter(function(n){return n!==t.label;});
        setQueue(q); setOverall(done, Math.max(1,total));
        nextTask(idx+1);
      }).catch(function(){
        done++;
        q = q.filter(function(n){return n!==t.label;});
        setQueue(q); setOverall(done, Math.max(1,total));
        nextTask(idx+1);
      });
    })(0);
  }
}

// Buttons wissen
document.getElementById("btn-clear-heat").addEventListener("click", function(){
  if(heatLayer){ map.removeLayer(heatLayer); heatLayer=null; currentPoints=[]; setHeatCount(0); S("Heatmap gewist."); }
});
document.getElementById("btn-clear-bathy").addEventListener("click", function(){
  if(!confirm("Alle bathymetrie (DB) wissen?")) return;
  db.bathy.points=[]; db.bathy.datasets=[];
  saveDB();
  rawAll=[]; if(heatLayer){ map.removeLayer(heatLayer); heatLayer=null; }
  currentPoints=[]; setBathyTotal(0); setHeatCount(0);
  S("Bathymetrie uit DB gewist.");
});

// Auto-update bij kaartbeweging indien clip aan
map.on("moveend", function(){ if(document.getElementById("hmClip").checked){ applyHeatFromRaw(); } });

// Init heatmap indien DB data
setBathyTotal((db.bathy && Array.isArray(db.bathy.points)) ? db.bathy.points.length : 0);
if(db.bathy && Array.isArray(db.bathy.points) && db.bathy.points.length){
  rawAll = db.bathy.points.slice();
  applyHeatFromRaw();
}

// ===== Detectie eigen punten / selectie =====
function pointsInViewport(maxTake){
  var b=map.getBounds(), pts=[];
  db.steks.forEach(function(s){ if(b.contains([s.lat,s.lng])) pts.push([s.lng,s.lat]); });
  db.rigs .forEach(function(r){ if(b.contains([r.lat,r.lng])) pts.push([r.lng,r.lat]); });
  var inView=(db.bathy.points||[]).filter(function(p){ return b.contains([p.lat,p.lon]); });
  var step=Math.max(1,Math.floor(inView.length/600));
  for(var i=0;i<inView.length;i+=step){ pts.push([inView[i].lon,inView[i].lat]); if(maxTake && pts.length>=maxTake) break; }
  return pts;
}
function polygonFromPtsLngLat(pts){
  if(pts.length<3) return null;
  var fc=turf.featureCollection(pts.map(function(c){return turf.point(c);}));
  var maxEdge=parseFloat(document.getElementById("detMaxEdge").value)||250;
  var poly=null;
  try{ poly=turf.concave(fc,{maxEdge:maxEdge,units:'meters'});}catch(_){}
  if(!poly){ try{ poly=turf.convex(fc);}catch(_){} }
  return poly;
}
document.getElementById("btnDetectViewport").addEventListener("click", function(){
  var pts=pointsInViewport(800);
  if(pts.length<3){ S("Te weinig punten in beeld."); return; }
  var poly=polygonFromPtsLngLat(pts);
  if(!poly){ S("Detectie mislukte: geen poly."); return; }
  if(selection.preview){ map.removeLayer(selection.preview); }
  selection.preview=L.geoJSON(poly,{pane:'waterPane',style:{color:'#00e5ff',weight:2,fillOpacity:0.25}}).addTo(map);
  I("Voorbeeld (viewport) klaar — klik ‘Opslaan’.");
});
document.getElementById("btnDetectFromPoints").addEventListener("click", function(){
  var pts=Array.from(selection.points).map(function(k){ var p=k.split(','); return [parseFloat(p[1]),parseFloat(p[0])];});
  if(pts.length<3){ S("Selecteer eerst ≥3 punten."); return; }
  var poly=polygonFromPtsLngLat(pts);
  if(!poly){ S("Selectie → geen poly."); return; }
  if(selection.preview){ map.removeLayer(selection.preview); }
  selection.preview=L.geoJSON(poly,{pane:'waterPane',style:{color:'#00e5ff',weight:2,fillOpacity:0.25}}).addTo(map);
  I("Voorbeeld (selectie) klaar — klik ‘Opslaan’.");
});

// ===== Contouren =====
function interpIDW(lat,lon,pts,R,K){
  R=R||60; K=K||12;
  var cand=[];
  for(var i=0;i<pts.length;i++){
    var p=pts[i];
    var d=distM({lat:lat,lon:lon},{lat:p.lat,lon:p.lon});
    if(d<=R) cand.push({d:d,p:p});
  }
  cand.sort(function(a,b){return a.d-b.d;});
  var take=cand.slice(0,Math.min(K,cand.length));
  if(!take.length) return NaN;
  var num=0,den=0;
  for(var j=0;j<take.length;j++){
    var it=take[j]; var w=1/Math.max(1e-6,it.d*it.d); num+=w*it.p.dep; den+=w;
  }
  return num/den;
}
function generateContours(){
  var pts=db.bathy.points||[]; if(pts.length<5){ S("Te weinig dieptepunten voor contouren."); return; }
  var b=map.getBounds();
  var bb=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
  var min=Infinity,max=-Infinity; pts.forEach(function(p){ if(isFinite(p.dep)){ if(p.dep<min)min=p.dep; if(p.dep>max)max=p.dep; } });
  if(!isFinite(min)||!isFinite(max)||max===min){ S("Geen spreiding in diepte."); return; }
  var step=0.5, vmin=min, vmax=max;
  try{
    var uMin=parseFloat(document.getElementById("hmMin").value), uMax=parseFloat(document.getElementById("hmMax").value);
    if(document.getElementById("hmFixed").checked){ vmin=0; vmax=20; }
    else {
      if(!isNaN(uMin)) vmin=uMin;
      if(!isNaN(uMax)) vmax=uMax;
    }
  }catch(_){}
  var levels=[]; for(var v=vmin; v<=vmax+1e-9; v+=step) levels.push(parseFloat(v.toFixed(3)));

  var degPerM=1/111320; var cellM=14; var cellDeg=cellM*degPerM;
  var grid=[]; for(var y=bb[1]; y<=bb[3]; y+=cellDeg){ var row=[]; for(var x=bb[0]; x<=bb[2]; x+=cellDeg){ row.push(interpIDW(y,x, pts, 60, 12)); } grid.push(row); }
  var fcs=[]; var yy=bb[1];
  for(var i=0;i<grid.length;i++){ var xx=bb[0]; for(var j=0;j<grid[i].length;j++){ var val=grid[i][j]; if(isFinite(val)) fcs.push(turf.point([xx,yy],{value:val})); xx+=cellDeg; } yy+=cellDeg; }
  var ptsFC=turf.featureCollection(fcs);
  var lines=null; try{ lines=turf.isolines(ptsFC, levels, {zProperty:'value'});}catch(e){ console.error(e); S("Fout bij isolines."); return; }

  contourLayer.clearLayers(); isobandLayer.clearLayers();
  L.geoJSON(lines,{style:{color:'#44f1c6',weight:1.5,opacity:0.9},pane:'contourPane'}).addTo(contourLayer);
  S("Contouren klaar: "+(lines.features||[]).length+" lijnen.");
}
document.getElementById('btn-gen-contours').addEventListener('click', generateContours);
document.getElementById('btn-clear-contours').addEventListener('click', function(){ contourLayer.clearLayers(); isobandLayer.clearLayers(); S("Contouren gewist."); });

// ===== GPS volgen =====
var gpsWatchId = null;
function startGPS(){
  if (!navigator.geolocation) { S("GPS niet beschikbaar."); return; }
  if (gpsWatchId != null) return;
  var opts = { enableHighAccuracy:true, maximumAge:5000, timeout:20000 };
  gpsWatchId = navigator.geolocation.watchPosition(function(pos){
    var crd = pos.coords;
    document.getElementById('gpsStatus').textContent = 'aan';
    var p=document.getElementById('gpsPanel'); if (p && p.style) p.style.display='block';
    document.getElementById('gpsLat').textContent = crd.latitude.toFixed(6);
    document.getElementById('gpsLon').textContent = crd.longitude.toFixed(6);
    document.getElementById('gpsAcc').textContent = isFinite(crd.accuracy)? crd.accuracy.toFixed(1) : '—';
    document.getElementById('gpsSpd').textContent = (crd.speed!=null && isFinite(crd.speed))? crd.speed.toFixed(1) : '—';
    document.getElementById('gpsBrg').textContent = (crd.heading!=null && isFinite(crd.heading))? crd.heading.toFixed(0) : '—';
    var ll = L.latLng(crd.latitude, crd.longitude);
    map.setView(ll, Math.max(16, map.getZoom()), {animate:true});
    if (!window.__gpsMarker){
      window.__gpsMarker = L.circleMarker(ll, {radius:6, color:'#4EA1FF', weight:2, fillColor:'#4EA1FF', fillOpacity:0.6, pane:'markerPane'}).addTo(map);
    } else {
      window.__gpsMarker.setLatLng(ll);
    }
  }, function(err){
    S("GPS fout: "+err.message);
    stopGPS();
  }, opts);
  S("GPS volgen gestart.");
}
function stopGPS(){
  if (gpsWatchId!=null) {
    try { navigator.geolocation.clearWatch(gpsWatchId); } catch(_){}
    gpsWatchId = null;
  }
  document.getElementById('gpsStatus').textContent = 'uit';
  S("GPS volgen gestopt.");
}
document.getElementById('btnGps').addEventListener('click', function(){
  var p=document.getElementById('gpsPanel'); if (p && p.style) p.style.display= p.style.display==='none'?'block':'none';
  if (gpsWatchId==null) startGPS(); else stopGPS();
});

// ===== Export/Import/Local opslaan =====
document.getElementById("btnExport").addEventListener("click", function(){
  var payload={waters:db.waters,steks:db.steks,rigs:db.rigs,bathy:db.bathy,settings:db.settings,version:"1.1.3"};
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  var url=URL.createObjectURL(blob); var a=document.createElement("a");
  a.href=url; a.download="vislokaties_1.1.3.geojson.json";
  document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(url);a.remove();},0);
});
document.getElementById("btn-import-files2").addEventListener("click", function(){ document.getElementById("fileMerge").click(); });
document.getElementById("fileMerge").addEventListener("change", function(e){
  var f=e.target.files[0]; if(!f) return;
  f.text().then(function(t){
    try{
      var o=JSON.parse(t);
      if(o.waters) db.waters=o.waters;
      if(o.steks)  db.steks =o.steks;
      if(o.rigs)   db.rigs  =o.rigs;
      if(o.bathy)  db.bathy =o.bathy;
      if(o.settings) db.settings=o.settings;
      saveDB(); renderAll();
      S("Import GeoJSON/JSON klaar.");
    }catch(err){ S("Fout bij import: "+err.message); }
  });
});
document.getElementById("btnLocalSave").addEventListener("click", function(){ saveDB(); S("Data in browser bewaard."); });
document.getElementById("btnLocalLoad").addEventListener("click", function(){
  try{var raw=localStorage.getItem(DB_KEY); if(raw) db=JSON.parse(raw);}catch(e){}
  normalizeDB(); renderAll(); S("Data uit browser geladen.");
});
document.getElementById("btnLocalReset").addEventListener("click", function(){
  if(!confirm("Browser-opslag resetten?")) return;
  try{localStorage.removeItem(DB_KEY);}catch(_){}
  db={waters:[],steks:[],rigs:[],bathy:{points:[],datasets:[]},settings:{waterColor:"#33a1ff"}};
  renderAll(); S("Browser-opslag gereset.");
});
document.getElementById("btnSaveHtml").addEventListener("click", function(){
  try{
    var html='<!doctype html>'+document.documentElement.outerHTML;
    var blob=new Blob([html],{type:"text/html"});
    var url=URL.createObjectURL(blob); var a=document.createElement("a");
    a.href=url; a.download="Vis Lokaties v1.1.3.html";
    document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(url);a.remove();},0);
    S("HTML gedownload.");
  }catch(e){ S("Kon HTML niet downloaden: "+e.message); }
});
