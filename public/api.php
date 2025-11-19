<?php
// Simpele PHP API voor het opslaan en ophalen van trips in MySQL.
// Werkt met standaard hosting of een lokale XAMPP-installatie.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$config = [
    'DB_HOST' => getenv('DB_HOST') ?: 'localhost',
    'DB_PORT' => getenv('DB_PORT') ?: '3306',
    'DB_NAME' => getenv('DB_NAME') ?: 'vis_trips',
    'DB_USER' => getenv('DB_USER') ?: 'root',
    'DB_PASSWORD' => getenv('DB_PASSWORD') ?: '',
];

// Optioneel: overschrijf waardes via public/config.php (niet in git)
$configPath = __DIR__ . '/config.php';
if (file_exists($configPath)) {
    $fileConfig = include $configPath;
    if (is_array($fileConfig)) {
        $config = array_merge($config, $fileConfig);
    }
}

function respond($status, $body)
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function get_db($config)
{
    $mysqli = new mysqli(
        $config['DB_HOST'],
        $config['DB_USER'],
        $config['DB_PASSWORD'],
        $config['DB_NAME'],
        (int) $config['DB_PORT']
    );

    if ($mysqli->connect_errno) {
        respond(500, ['message' => 'Databaseverbinding mislukt: ' . $mysqli->connect_error]);
    }

    // Zorg dat de tabel bestaat
    $createTableSql = "CREATE TABLE IF NOT EXISTS trips (\n        id INT AUTO_INCREMENT PRIMARY KEY,\n        traveler_name VARCHAR(100) NOT NULL,\n        destination VARCHAR(150) NOT NULL,\n        trip_date DATE NOT NULL,\n        notes TEXT,\n        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

    if (!$mysqli->query($createTableSql)) {
        respond(500, ['message' => 'Kon tabel niet aanmaken: ' . $mysqli->error]);
    }

    return $mysqli;
}

$db = get_db($config);

switch ($_SERVER['REQUEST_METHOD']) {
    case 'GET':
        $result = $db->query('SELECT id, traveler_name, destination, trip_date, notes, created_at FROM trips ORDER BY created_at DESC');
        if (!$result) {
            respond(500, ['message' => 'Kon trips niet ophalen: ' . $db->error]);
        }
        $trips = $result->fetch_all(MYSQLI_ASSOC);
        respond(200, $trips);

    case 'POST':
        $input = json_decode(file_get_contents('php://input'), true) ?: [];

        $travelerName = trim($input['travelerName'] ?? '');
        $destination = trim($input['destination'] ?? '');
        $tripDate = trim($input['tripDate'] ?? '');
        $notes = trim($input['notes'] ?? '');

        if ($travelerName === '' || $destination === '' || $tripDate === '') {
            respond(400, ['message' => 'Naam, bestemming en datum zijn verplicht.']);
        }

        $stmt = $db->prepare('INSERT INTO trips (traveler_name, destination, trip_date, notes) VALUES (?, ?, ?, ?)');
        if (!$stmt) {
            respond(500, ['message' => 'Kon statement niet voorbereiden: ' . $db->error]);
        }

        $stmt->bind_param('ssss', $travelerName, $destination, $tripDate, $notes);
        if (!$stmt->execute()) {
            respond(500, ['message' => 'Kon trip niet opslaan: ' . $stmt->error]);
        }

        respond(201, ['message' => 'Trip opgeslagen']);

    default:
        respond(405, ['message' => 'Methode niet toegestaan']);
}
