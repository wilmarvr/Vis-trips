const statusEl = document.getElementById('status');
const tripForm = document.getElementById('tripForm');
const tripsEl = document.getElementById('trips');

async function fetchTrips() {
  tripsEl.innerHTML = '<p class="empty">Gegevens laden...</p>';
  try {
    const response = await fetch('api.php');
    const data = await response.json();

    if (!data.length) {
      tripsEl.innerHTML = '<p class="empty">Nog geen trips opgeslagen.</p>';
      return;
    }

    tripsEl.innerHTML = data
      .map(
        (trip) => `
          <article class="card">
            <h3>${trip.destination}</h3>
            <p class="meta">${trip.traveler_name} - ${new Date(trip.trip_date).toLocaleDateString()}</p>
            <p>${trip.notes ? trip.notes : 'Geen notities'}</p>
          </article>
        `
      )
      .join('');
  } catch (error) {
    console.error(error);
    tripsEl.innerHTML = '<p class="empty">Kon trips niet laden.</p>';
  }
}

tripForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusEl.textContent = 'Opslaan...';

  const payload = {
    travelerName: tripForm.travelerName.value.trim(),
    destination: tripForm.destination.value.trim(),
    tripDate: tripForm.tripDate.value,
    notes: tripForm.notes.value.trim(),
  };

  try {
    const response = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await response.json();
      throw new Error(message || 'Kon trip niet opslaan');
    }

    tripForm.reset();
    statusEl.textContent = 'Trip opgeslagen!';
    fetchTrips();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

fetchTrips();
