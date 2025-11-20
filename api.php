<?php
declare(strict_types=1);

// Eenvoudige PHP-backend die databasecontrole, aanmaken en opslaan afhandelt
// zonder dat er een aparte Node/Express-API hoeft te draaien.

const CONFIG_PATH = __DIR__ . '/mysql/config.json';
const DEFAULT_DB = 'vis_trips';

header('Content-Type: application/json; charset=utf-8');

try {
    route_request();
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}

function route_request(): void
{
    $action = $_GET['action'] ?? null;
    if ($action === null && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $action = 'save';
    } elseif ($action === null) {
        $action = 'status';
    }

    switch ($action) {
        case 'status':
            handle_status();
            break;
        case 'config':
            assert_post();
            handle_config();
            break;
        case 'save':
            assert_post();
            handle_save();
            break;
        default:
            json_response(['ok' => false, 'error' => 'Onbekende actie'], 404);
    }
}

function assert_post(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        json_response(['ok' => false, 'error' => 'Gebruik POST voor deze actie.'], 405);
    }
}

function handle_status(): void
{
    $cfg = load_config(true);
    $defaults = default_payloads($cfg);
    $missing = missing_fields($cfg);

    if ($missing) {
        $auto = attempt_auto_provision($defaults);
        if ($auto['ok']) {
            json_response(['ok' => true, 'autoProvisioned' => true]);
        }
        json_response(['ok' => false, 'needsCredentials' => true, 'missing' => $missing, 'defaults' => $defaults]);
    }

    try {
        $pdo = ensure_database_and_tables($cfg);
        $pdo = null;
        json_response(['ok' => true]);
    } catch (Throwable $e) {
        json_response([
            'ok' => false,
            'needsCredentials' => true,
            'defaults' => $defaults,
            'error' => $e->getMessage(),
        ], 503);
    }
}

function handle_config(): void
{
    $body = read_json();
    $cfg = [
        'host' => trim($body['host'] ?? 'localhost'),
        'port' => (int)($body['port'] ?? 3306),
        'database' => trim($body['database'] ?? DEFAULT_DB),
        'user' => trim($body['user'] ?? ''),
        'password' => (string)($body['password'] ?? ''),
    ];

    if ($cfg['user'] === '' || $cfg['password'] === '') {
        json_response(['ok' => false, 'error' => 'Gebruiker en wachtwoord zijn verplicht.'], 400);
    }

    try {
        $pdo = ensure_database_and_tables($cfg);
        write_config($cfg);
        $pdo = null;
        json_response(['ok' => true]);
    } catch (Throwable $e) {
        json_response(['ok' => false, 'error' => $e->getMessage()], 500);
    }
}

function handle_save(): void
{
    $cfg = load_config(true);
    $defaults = default_payloads($cfg);
    $missing = missing_fields($cfg);

    if ($missing) {
        json_response([
            'ok' => false,
            'needsCredentials' => true,
            'missing' => $missing,
            'defaults' => $defaults,
            'error' => 'Database nog niet geconfigureerd. Vul eerst de gegevens in.',
        ], 503);
    }

    $payload = read_json();

    try {
        $pdo = ensure_database_and_tables($cfg);
        $summary = save_all($pdo, $payload);
        $pdo = null;
        json_response(['ok' => true, 'summary' => $summary]);
    } catch (Throwable $e) {
        json_response(['ok' => false, 'error' => $e->getMessage()], 500);
    }
}

function load_config(bool $allowMissing = false): ?array
{
    $cfg = null;
    if (file_exists(CONFIG_PATH)) {
        $cfg = json_decode((string)file_get_contents(CONFIG_PATH), true);
    }

    if (!$cfg && !$allowMissing) {
        throw new RuntimeException('MySQL-config ontbreekt.');
    }

    if (!$cfg) {
        return null;
    }

    return [
        'host' => $cfg['host'] ?? 'localhost',
        'port' => (int)($cfg['port'] ?? 3306),
        'database' => $cfg['database'] ?? DEFAULT_DB,
        'user' => $cfg['user'] ?? null,
        'password' => $cfg['password'] ?? null,
    ];
}

function write_config(array $cfg): void
{
    $dir = dirname(CONFIG_PATH);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    file_put_contents(CONFIG_PATH, json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

function missing_fields(?array $cfg): array
{
    $missing = [];
    if (!$cfg || ($cfg['host'] ?? '') === '') {
        $missing[] = 'host';
    }
    if (!$cfg || ($cfg['database'] ?? '') === '') {
        $missing[] = 'database';
    }
    if (!$cfg || ($cfg['user'] ?? '') === '') {
        $missing[] = 'user';
    }
    if (!$cfg || ($cfg['password'] ?? '') === '') {
        $missing[] = 'password';
    }
    return $missing;
}

function default_payloads(?array $cfg): array
{
    return [
        'host' => $cfg['host'] ?? 'localhost',
        'port' => $cfg['port'] ?? 3306,
        'database' => $cfg['database'] ?? DEFAULT_DB,
        'user' => $cfg['user'] ?? null,
    ];
}

function attempt_auto_provision(array $defaults): array
{
    $host = $defaults['host'] ?? 'localhost';
    $port = (int)($defaults['port'] ?? 3306);
    $dbName = $defaults['database'] ?? DEFAULT_DB;

    $adminCfg = [
        'host' => $host,
        'port' => $port,
        'database' => $dbName,
        'user' => 'root',
        'password' => '',
    ];

    try {
        $pdo = make_pdo($adminCfg, false);
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }

    try {
        $pdo->exec(sprintf(
            'CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
            str_replace('`', '``', $dbName)
        ));

        $appUser = 'vis_app';
        $appPass = bin2hex(random_bytes(6));

        $pdo->exec(sprintf("CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED BY '%s'", str_replace('`', '``', $appUser), addslashes($appPass)));
        $pdo->exec(sprintf("GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'%%'", str_replace('`', '``', $dbName), str_replace('`', '``', $appUser)));
        $pdo->exec('FLUSH PRIVILEGES');

        $appCfg = [
            'host' => $host,
            'port' => $port,
            'database' => $dbName,
            'user' => $appUser,
            'password' => $appPass,
        ];

        $appPdo = make_pdo($appCfg, true);
        ensure_schema($appPdo);
        write_config($appCfg);

        return ['ok' => true, 'config' => $appCfg];
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

function read_json(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function make_pdo(array $cfg, bool $withDatabase = true): PDO
{
    if (!in_array('mysql', PDO::getAvailableDrivers(), true)) {
        throw new RuntimeException('MySQL driver ontbreekt. Installeer pdo_mysql.');
    }

    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    $dsn = sprintf(
        'mysql:host=%s;port=%s;%s;charset=utf8mb4',
        $cfg['host'] ?? 'localhost',
        $cfg['port'] ?? 3306,
        $withDatabase ? ('dbname=' . ($cfg['database'] ?? DEFAULT_DB) . ';') : ''
    );

    return new PDO($dsn, (string)$cfg['user'], (string)$cfg['password'], $options);
}

function ensure_database_and_tables(array $cfg): PDO
{
    $basePdo = make_pdo($cfg, false);
    $dbName = $cfg['database'] ?? DEFAULT_DB;

    // Maak database en gebruiker indien nodig
    $basePdo->exec(sprintf(
        'CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
        str_replace('`', '``', $dbName)
    ));

    if (($cfg['user'] ?? '') !== '') {
        $user = str_replace('`', '``', (string)$cfg['user']);
        $password = addslashes((string)$cfg['password']);
        $basePdo->exec(sprintf("CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED BY '%s'", $user, $password));
        $basePdo->exec(sprintf("GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'%%'", str_replace('`', '``', $dbName), $user));
        $basePdo->exec('FLUSH PRIVILEGES');
    }

    $pdo = make_pdo($cfg, true);
    ensure_schema($pdo);
    return $pdo;
}

function ensure_schema(PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS waters (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT "",
        geojson JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB');

    $pdo->exec('CREATE TABLE IF NOT EXISTS steks (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT "",
        note TEXT NULL,
        lat DOUBLE NOT NULL,
        lng DOUBLE NOT NULL,
        water_id VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_steks_water FOREIGN KEY (water_id) REFERENCES waters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB');

    $pdo->exec('CREATE TABLE IF NOT EXISTS rigs (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT "",
        note TEXT NULL,
        lat DOUBLE NOT NULL,
        lng DOUBLE NOT NULL,
        stek_id VARCHAR(64) NULL,
        water_id VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_rigs_stek FOREIGN KEY (stek_id) REFERENCES steks(id) ON DELETE SET NULL,
        CONSTRAINT fk_rigs_water FOREIGN KEY (water_id) REFERENCES waters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB');

    $pdo->exec('CREATE TABLE IF NOT EXISTS bathy_points (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        lat DOUBLE NOT NULL,
        lon DOUBLE NOT NULL,
        depth_m DOUBLE NOT NULL,
        dataset VARCHAR(128) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bathy_latlon (lat, lon)
    ) ENGINE=InnoDB');

    $pdo->exec('CREATE TABLE IF NOT EXISTS bathy_datasets (
        id VARCHAR(128) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        source VARCHAR(255) NULL,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        points INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB');

    $pdo->exec('CREATE TABLE IF NOT EXISTS settings (
        name VARCHAR(64) PRIMARY KEY,
        value JSON NOT NULL
    ) ENGINE=InnoDB');

    $stmt = $pdo->prepare('INSERT INTO settings (name, value) VALUES ("waterColor", :val)
        ON DUPLICATE KEY UPDATE value = VALUES(value)');
    $stmt->execute([':val' => json_encode('#33a1ff')]);
}

function save_all(PDO $pdo, array $payload): array
{
    $waters = $payload['waters'] ?? [];
    $steks = $payload['steks'] ?? [];
    $rigs = $payload['rigs'] ?? [];
    $bathy = $payload['bathy'] ?? ['points' => [], 'datasets' => []];

    $pdo->beginTransaction();
    try {
        $pdo->exec('TRUNCATE TABLE rigs');
        $pdo->exec('TRUNCATE TABLE steks');
        $pdo->exec('TRUNCATE TABLE waters');
        $pdo->exec('TRUNCATE TABLE bathy_points');
        $pdo->exec('TRUNCATE TABLE bathy_datasets');

        if (!empty($waters)) {
            $stmt = $pdo->prepare('INSERT INTO waters (id, name, geojson) VALUES (:id, :name, :geojson)
                ON DUPLICATE KEY UPDATE name = VALUES(name), geojson = VALUES(geojson)');
            foreach ($waters as $w) {
                $stmt->execute([
                    ':id' => $w['id'] ?? uniqid('water_', true),
                    ':name' => $w['name'] ?? '',
                    ':geojson' => isset($w['geojson']) ? json_encode($w['geojson']) : null,
                ]);
            }
        }

        if (!empty($steks)) {
            $stmt = $pdo->prepare('INSERT INTO steks (id, name, note, lat, lng, water_id) VALUES (:id, :name, :note, :lat, :lng, :water_id)
                ON DUPLICATE KEY UPDATE name = VALUES(name), note = VALUES(note), lat = VALUES(lat), lng = VALUES(lng), water_id = VALUES(water_id)');
            foreach ($steks as $s) {
                $stmt->execute([
                    ':id' => $s['id'] ?? uniqid('stek_', true),
                    ':name' => $s['name'] ?? '',
                    ':note' => $s['note'] ?? null,
                    ':lat' => (float)($s['lat'] ?? 0),
                    ':lng' => (float)($s['lng'] ?? 0),
                    ':water_id' => $s['waterId'] ?? null,
                ]);
            }
        }

        if (!empty($rigs)) {
            $stmt = $pdo->prepare('INSERT INTO rigs (id, name, note, lat, lng, stek_id, water_id) VALUES (:id, :name, :note, :lat, :lng, :stek_id, :water_id)
                ON DUPLICATE KEY UPDATE name = VALUES(name), note = VALUES(note), lat = VALUES(lat), lng = VALUES(lng), stek_id = VALUES(stek_id), water_id = VALUES(water_id)');
            foreach ($rigs as $r) {
                $stmt->execute([
                    ':id' => $r['id'] ?? uniqid('rig_', true),
                    ':name' => $r['name'] ?? '',
                    ':note' => $r['note'] ?? null,
                    ':lat' => (float)($r['lat'] ?? 0),
                    ':lng' => (float)($r['lng'] ?? 0),
                    ':stek_id' => $r['stekId'] ?? null,
                    ':water_id' => $r['waterId'] ?? null,
                ]);
            }
        }

        $points = $bathy['points'] ?? [];
        if (!empty($points)) {
            $stmt = $pdo->prepare('INSERT INTO bathy_points (lat, lon, depth_m, dataset) VALUES (:lat, :lon, :depth, :dataset)');
            foreach ($points as $p) {
                $stmt->execute([
                    ':lat' => (float)($p['lat'] ?? 0),
                    ':lon' => (float)($p['lon'] ?? $p['lng'] ?? 0),
                    ':depth' => (float)($p['dep'] ?? $p['depth'] ?? $p['depth_m'] ?? 0),
                    ':dataset' => $p['dataset'] ?? null,
                ]);
            }
        }

        $datasets = $bathy['datasets'] ?? [];
        if (!empty($datasets)) {
            $stmt = $pdo->prepare('INSERT INTO bathy_datasets (id, name, source, points) VALUES (:id, :name, :source, :points)
                ON DUPLICATE KEY UPDATE name = VALUES(name), source = VALUES(source), points = VALUES(points)');
            foreach ($datasets as $d) {
                $stmt->execute([
                    ':id' => $d['id'] ?? ($d['name'] ?? uniqid('ds_', true)),
                    ':name' => $d['name'] ?? ($d['id'] ?? 'dataset'),
                    ':source' => $d['source'] ?? null,
                    ':points' => (int)($d['points'] ?? $d['count'] ?? 0),
                ]);
            }
        }

        $pdo->commit();
        return [
            'waters' => count($waters),
            'steks' => count($steks),
            'rigs' => count($rigs),
            'bathyPoints' => count($points),
            'bathyDatasets' => count($datasets),
        ];
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function json_response(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data);
    exit;
}

