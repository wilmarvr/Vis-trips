const fs = require('fs');
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json({limit:'20mb'}));
app.use(express.static(path.join(__dirname)));

function loadConfig({allowMissing=false}={}){
  const cfgPath = path.join(__dirname, 'mysql', 'config.json');
  if(fs.existsSync(cfgPath)){
    const fileCfg = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
    return {...fileCfg, host: fileCfg.host || 'localhost', database: fileCfg.database || 'vis_trips'};
  }
  const envCfg = {
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'vis_trips'
  };
  const hasEnv = ['MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE'].some(key => process.env[key]);
  if(hasEnv) return envCfg;
  if(allowMissing) return null;
  throw new Error('MySQL config ontbreekt. Maak mysql/config.json of stel MYSQL_* variabelen in.');
}

function writeConfigFile(cfg){
  const cfgPath = path.join(__dirname, 'mysql', 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

let pool;
let poolConfig = null;

async function ensureDatabaseAndTables(config){
  const adminConfig = {...config};
  delete adminConfig.database;

  const schemaPath = path.join(__dirname, 'mysql', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const connection = await mysql.createConnection({...adminConfig, multipleStatements:true});

  const [[dbExists]] = await connection.query('SELECT SCHEMA_NAME as name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [config.database]);
  let finalUser = config.user;
  let finalPassword = config.password;

  if(!dbExists){
    console.log(`Database ${config.database} bestaat niet. We maken hem aan.`);
    if(!config.user || !config.password){
      throw new Error('Gebruikersnaam/wachtwoord ontbreken voor het aanmaken van de database.');
    }
    const dbName = mysql.escapeId(config.database);
    const userIdent = mysql.escape(config.user);
    await connection.query(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`CREATE USER IF NOT EXISTS ${userIdent}@'%' IDENTIFIED BY ${mysql.escape(config.password)}`);
    await connection.query(`GRANT ALL PRIVILEGES ON ${dbName}.* TO ${userIdent}@'%'`);
    await connection.query('FLUSH PRIVILEGES');
  }

  await connection.query(schemaSql);
  await connection.end();

  return {...config, user:finalUser, password:finalPassword};
}

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
  if(!pool){
    try{
      const cfg = loadConfig({allowMissing:true});
      const defaults = {
        host: (cfg && cfg.host) || 'localhost',
        database: (cfg && cfg.database) || 'vis_trips',
        user: cfg && cfg.user,
      };
      const missing = missingFields(cfg);
      if(missing.length){
        return res.status(503).json({ok:false,needsCredentials:true,defaults,missing,error:'Database nog niet geconfigureerd. Vul de gegevens eerst in.'});
      }
      const ensured = await ensureDatabaseAndTables(cfg);
      await initPool(ensured);
    }catch(err){
      const cfg = loadConfig({allowMissing:true}) || {};
      const defaults = {host: cfg.host || 'localhost', database: cfg.database || 'vis_trips', user: cfg.user};
      console.error('Pool ontbreekt en initialisatie faalde', err);
      return res.status(503).json({ok:false,needsCredentials:true,defaults,error:err.message||String(err)});
    }
  }
  try{
    const summary = await saveAll(req.body || {});
    res.json({ok:true, summary});
  }catch(err){
    console.error('Save failed', err);
    res.status(500).json({ok:false,error:err.message||String(err)});
  }
});

function missingFields(cfg){
  const missing = [];
  if(!cfg || !cfg.host) missing.push('host');
  if(!cfg || !cfg.database) missing.push('database');
  if(!cfg || !cfg.user) missing.push('user');
  if(!cfg || !cfg.password) missing.push('password');
  return missing;
}

async function initPool(cfg){
  if(pool){
    try{ await pool.end(); }catch(_){ }
  }
  pool = mysql.createPool({
    ...cfg,
    waitForConnections:true,
    connectionLimit:5,
    namedPlaceholders:true
  });
  poolConfig = cfg;
}

app.get('/api/db/status', async (req,res)=>{
  try{
    const cfg = loadConfig({allowMissing:true});
    const defaults = {
      host: (cfg && cfg.host) || 'localhost',
      database: (cfg && cfg.database) || 'vis_trips'
    };
    const missing = missingFields(cfg);
    if(missing.length){
      return res.json({ok:false, needsCredentials:true, missing, defaults});
    }

    if(!pool){
      const ensured = await ensureDatabaseAndTables(cfg);
      await initPool(ensured);
    }

    res.json({ok:true});
  }catch(err){
    console.error('DB status failed', err);
    res.status(500).json({ok:false,error:err.message||String(err)});
  }
});

app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname,'index.html'));
});

app.post('/api/db/config', async (req,res)=>{
  const {host='localhost', database='vis_trips', user, password} = req.body || {};
  if(!user || !password){
    return res.status(400).json({ok:false,error:'Gebruiker en wachtwoord zijn verplicht.'});
  }
  try{
    const cfg = {host, database, user, password};
    const ensured = await ensureDatabaseAndTables(cfg);
    writeConfigFile(ensured);
    await initPool(ensured);
    res.json({ok:true});
  }catch(err){
    console.error('DB config failed', err);
    res.status(500).json({ok:false,error:err.message||String(err)});
  }
});

async function start(){
  try{
    const config = loadConfig({allowMissing:true});
    if(config && !missingFields(config).length){
      const ensuredConfig = await ensureDatabaseAndTables(config);
      await initPool(ensuredConfig);
      console.log('Database en tabellen zijn klaar.');
    }else{
      console.warn('Databaseconfig ontbreekt of is incompleet. Wacht op invoer via de UI.');
    }
  }catch(err){
    console.warn('Kon de database niet initialiseren bij start:', err.message || err);
  }

  const port = process.env.PORT || 3000;
  app.listen(port, ()=>{
    console.log(`Vis-trips API luistert op :${port}`);
  });
}

start().catch(err => {
  console.error('Kon de server niet starten:', err);
  process.exit(1);
});
