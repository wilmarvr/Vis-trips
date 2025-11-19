const fs = require('fs');
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json({limit:'20mb'}));

function loadConfig(){
  const cfgPath = path.join(__dirname, 'mysql', 'config.json');
  if(fs.existsSync(cfgPath)){
    return JSON.parse(fs.readFileSync(cfgPath,'utf8'));
  }
  const envCfg = {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'vis_trips'
  };
  const hasEnv = Object.values(envCfg).some(Boolean);
  if(hasEnv) return envCfg;
  throw new Error('MySQL config ontbreekt. Maak mysql/config.json of stel MYSQL_* variabelen in.');
}

const config = loadConfig();
const pool = mysql.createPool({
  ...config,
  waitForConnections:true,
  connectionLimit:5,
  namedPlaceholders:true
});

async function saveAll(payload){
  const {waters=[],steks=[],rigs=[],bathy={points:[],datasets:[]}} = payload || {};
  const conn = await pool.getConnection();
  try{
    await conn.beginTransaction();

    await conn.query('TRUNCATE TABLE rigs');
    await conn.query('TRUNCATE TABLE steks');
    await conn.query('TRUNCATE TABLE waters');
    await conn.query('TRUNCATE TABLE bathy_points');
    await conn.query('TRUNCATE TABLE bathy_datasets');

    if(waters.length){
      const rows = waters.map(w => [w.id, w.name || '', JSON.stringify(w.geojson || null)]);
      await conn.query('INSERT INTO waters (id,name,geojson) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), geojson=VALUES(geojson)', [rows]);
    }

    if(steks.length){
      const rows = steks.map(s => [s.id, s.name || '', s.note || null, Number(s.lat), Number(s.lng), s.waterId || null]);
      await conn.query('INSERT INTO steks (id,name,note,lat,lng,water_id) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), note=VALUES(note), lat=VALUES(lat), lng=VALUES(lng), water_id=VALUES(water_id)', [rows]);
    }

    if(rigs.length){
      const rows = rigs.map(r => [r.id, r.name || '', r.note || null, Number(r.lat), Number(r.lng), r.stekId || null, r.waterId || null]);
      await conn.query('INSERT INTO rigs (id,name,note,lat,lng,stek_id,water_id) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), note=VALUES(note), lat=VALUES(lat), lng=VALUES(lng), stek_id=VALUES(stek_id), water_id=VALUES(water_id)', [rows]);
    }

    if(bathy.points && bathy.points.length){
      const pointRows = bathy.points.map(p => [Number(p.lat), Number(p.lon), Number(p.dep ?? p.depth ?? p.depth_m), p.dataset || null]);
      await conn.query('INSERT INTO bathy_points (lat,lon,depth_m,dataset) VALUES ?', [pointRows]);
    }

    if(bathy.datasets && bathy.datasets.length){
      const dsRows = bathy.datasets.map(d => [d.id || d.name, d.name || d.id || 'dataset', d.source || null, d.points || (d.count ?? 0)]);
      await conn.query('INSERT INTO bathy_datasets (id,name,source,points) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), source=VALUES(source), points=VALUES(points)', [dsRows]);
    }

    await conn.commit();
    return {waters:waters.length,steks:steks.length,rigs:rigs.length,bathyPoints:(bathy.points||[]).length,bathyDatasets:(bathy.datasets||[]).length};
  }catch(err){
    await conn.rollback();
    throw err;
  }finally{
    conn.release();
  }
}

app.post('/api/save', async (req,res)=>{
  try{
    const summary = await saveAll(req.body || {});
    res.json({ok:true, summary});
  }catch(err){
    console.error('Save failed', err);
    res.status(500).json({ok:false,error:err.message||String(err)});
  }
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>{
  console.log(`Vis-trips API luistert op :${port}`);
});
