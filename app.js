// Variabili globali
let photosData = [];
let currentView = 'map';  // Default: mappa
let currentMapType = 'osm';
let map = null;
let mapLightbox = null;
let markers = [];
let markerClusterGroup = null;
let currentLightboxIndex = -1;
// Tile layers
const tileLayers = {
osm: {
url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
attribution: '&copy; OpenStreetMap contributors'
}
};
// Calcola punto a distanza in metri da un punto dato
function destinationPoint(lat, lon, distanceMeters, bearingDegrees) {
const R = 6371000; // Raggio terra in metri
const d = distanceMeters / R;
const brng = bearingDegrees * Math.PI / 180;
const lat1 = lat * Math.PI / 180;
const lon1 = lon * Math.PI / 180;
const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
return {
lat: lat2 * 180 / Math.PI,
lon: lon2 * 180 / Math.PI
};
}
// Carica dati
async function loadPhotos() {
try {
const response = await fetch('data/photos.json');
const data = await response.json();
photosData = data.photos;
updateStats(data);
renderGallery();
initMaps();
} catch (error) {
console.error('Errore caricamento foto:', error);
}
}
// Aggiorna statistiche
function updateStats(data) {
// Mostra solo foto con GPS
const gpsPhotos = data.photos.filter(p => p.has_gps).length;
document.getElementById('total-photos').textContent = gpsPhotos;
document.getElementById('gps-photos').textContent = gpsPhotos;
}
// Renderizza galleria
function renderGallery() {
const grid = document.getElementById('photo-grid');
// Mostra solo foto con GPS
const photosToShow = photosData.filter(p => p.has_gps);
if (photosToShow.length === 0) {
grid.innerHTML = '<div class="loading">Nessuna foto con GPS trovata</div>';
return;
}
const html = photosToShow.map((photo, index) => {
const originalIndex = photosData.indexOf(photo);
// Use filename (basename of display path)
const filename = photo.display.split('/').pop();
return `
<div class="photo-card" onclick="openLightbox(${originalIndex})">
<img src="${photo.thumb}" alt="${filename}" loading="lazy">
<div class="photo-card-info">
<div class="photo-card-name">${filename}</div>
<div class="photo-card-meta">
${photo.date ? `<span>📅 ${formatDate(photo.date)}</span>` : ''}
<span class="gps-badge has-gps">📍 GPS</span>
${photo.direction !== null && photo.direction !== undefined ?
`<span>🧭 ${Math.round(photo.direction)}°</span>` : ''}
</div>
</div>
</div>
`;
}).join('');
grid.innerHTML = html;
}
// Formatta data
function formatDate(dateStr) {
if (!dateStr) return '';
const parts = dateStr.split(' ')[0].split(':');
if (parts.length === 3) {
return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
return dateStr;
}
// Calcola bounding box che contiene il 95% delle foto
function calculate95PercentBounds(photos) {
if (photos.length === 0) return null;
// Ordina per lat e lon
const lats = photos.map(p => p.lat).sort((a, b) => a - b);
const lons = photos.map(p => p.lon).sort((a, b) => a - b);
// Rimuovi 2.5% da ogni lato (totale 5% escluso)
const trim = Math.floor(photos.length * 0.025);
const lats95 = lats.slice(trim, lats.length - trim);
const lons95 = lons.slice(trim, lons.length - trim);
return {
minLat: lats95[0],
maxLat: lats95[lats95.length - 1],
minLon: lons95[0],
maxLon: lons95[lons95.length - 1]
};
}
// Inizializza mappe
function initMaps() {
// Calcola centro e bounds per il 95% delle foto
const photosWithGPS = photosData.filter(p => p.has_gps && p.lat && p.lon);
const bounds95 = calculate95PercentBounds(photosWithGPS);
let initialView = [45.4642, 9.1900];
let initialZoom = 6;
if (bounds95) {
// Calcola centro di massa
const centerLat = (bounds95.minLat + bounds95.maxLat) / 2;
const centerLon = (bounds95.minLon + bounds95.maxLon) / 2;
initialView = [centerLat, centerLon];
}
// Mappa principale
map = L.map('map').setView(initialView, initialZoom);
updateMapTiles(map);
// Mappa lightbox
mapLightbox = L.map('lightbox-map').setView(initialView, 15);
updateMapTiles(mapLightbox);
// Aggiungi marker
updateMapMarkers();
// Fit alla bounding box del 95%
if (bounds95 && photosWithGPS.length > 1) {
const leafletBounds = L.latLngBounds(
[bounds95.minLat, bounds95.minLon],
[bounds95.maxLat, bounds95.maxLon]
);
map.fitBounds(leafletBounds, { padding: [50, 50] });
}
}
// Aggiorna tiles della mappa
function updateMapTiles(mapInstance) {
// Rimuovi layer esistenti
mapInstance.eachLayer(layer => {
if (layer instanceof L.TileLayer) {
mapInstance.removeLayer(layer);
}
});
const layer = tileLayers[currentMapType];
L.tileLayer(layer.url, {
attribution: layer.attribution,
maxZoom: 19,
opacity: 0.7  // Trasparenza per evidenziare i marker
}).addTo(mapInstance);
}
// Aggiorna marker sulla mappa
function updateMapMarkers() {
// Rimuovi marker e cluster esistenti
if (markerClusterGroup) {
map.removeLayer(markerClusterGroup);
}
markers.forEach(m => {
if (m.line) map.removeLayer(m.line);
});
markers = [];
const photosWithGPS = photosData.filter(p => p.has_gps && p.lat && p.lon);
if (photosWithGPS.length === 0) return;
// Crea nuovo gruppo cluster
markerClusterGroup = L.markerClusterGroup({
maxClusterRadius: 50,
spiderfyOnMaxZoom: true,
showCoverageOnHover: false,
zoomToBoundsOnClick: true
});
photosWithGPS.forEach((photo, index) => {
const title = photo.date ? formatDate(photo.date) : 'Foto';
const popupContent = `
<div style="text-align:center">
<img src="${photo.thumb}" style="width:100px;height:100px;object-fit:cover;border-radius:4px"><br>
<strong>${title}</strong>
</div>
`;
const photoIndex = photosData.indexOf(photo);
// Icona thumbnail
const icon = L.divIcon({
className: 'custom-div-icon',
html: `<div class="marker-thumb" style="width: 40px; height: 40px; background-image: url('${photo.thumb}')"></div>`,
iconSize: [40, 40],
iconAnchor: [20, 20]
});
const marker = L.marker([photo.lat, photo.lon], { icon: icon })
.on('click', () => openLightbox(photoIndex));
// Linea direzione se presente
let directionLine = null;
if (photo.direction !== null && photo.direction !== undefined) {
const endPoint = destinationPoint(photo.lat, photo.lon, 20, photo.direction);
directionLine = L.polyline(
[[photo.lat, photo.lon], [endPoint.lat, endPoint.lon]],
{ color: '#e74c3c', weight: 2, opacity: 0.5 }
).addTo(map);
}
markerClusterGroup.addLayer(marker);
markers.push({ marker, line: directionLine });
});
// Aggiungi il gruppo cluster alla mappa
map.addLayer(markerClusterGroup);
// Fit bounds
const bounds = L.latLngBounds(photosWithGPS.map(p => [p.lat, p.lon]));
map.fitBounds(bounds, { padding: [50, 50] });
}
// Cambia vista
function switchView(view) {
currentView = view;
document.querySelectorAll('.view-btn').forEach(btn => {
btn.classList.toggle('active', btn.dataset.view === view);
});
document.querySelectorAll('.gallery-view, .map-view').forEach(v => {
v.classList.remove('active');
});
document.getElementById(`${view}-view`).classList.add('active');
// Ridimensiona mappa se necessario
setTimeout(() => {
if (view === 'map') map.invalidateSize();
}, 100);
}
// Cambia tipo mappa
function switchMapType(type) {
currentMapType = type;
document.querySelectorAll('.map-btn').forEach(btn => {
btn.classList.toggle('active', btn.dataset.map === type);
});
updateMapTiles(map);
if (mapLightbox) updateMapTiles(mapLightbox);
}
// Lightbox
function openLightbox(index) {
const prevIndex = currentLightboxIndex;
currentLightboxIndex = index;
const photo = photosData[index];
// Salta foto senza GPS
if (!photo.has_gps) {
console.log('Foto senza GPS, skip');
return;
}
const lightbox = document.getElementById('lightbox');
const imgElement = document.getElementById('lightbox-image');
// Se la lightbox non è attiva, aprila direttamente
if (!lightbox.classList.contains('active')) {
updateLightboxContent(photo);
lightbox.classList.add('active');
imgElement.classList.remove('fade-out'); // Assicurati che sia visibile
} else {
// Altrimenti, fai la transizione
imgElement.classList.add('fade-out');
// Controlla cambia zona
if (prevIndex >= 0) {
const prevPhoto = photosData[prevIndex];
checkZoneChange(prevPhoto, photo);
}
setTimeout(() => {
updateLightboxContent(photo);
// Piccolo delay per permettere il rendering del nuovo src prima del fade-in
requestAnimationFrame(() => {
imgElement.classList.remove('fade-out');
});
}, 300);
}
}
function updateLightboxContent(photo) {
const imgElement = document.getElementById('lightbox-image');
imgElement.src = photo.display;
// Use filename as title
const filename = photo.display.split('/').pop();
document.getElementById('lightbox-title').textContent = filename;
const dateEl = document.getElementById('lightbox-date');
dateEl.textContent = photo.date ? '📅 ' + formatDate(photo.date) : '';
const cameraEl = document.getElementById('lightbox-camera');
cameraEl.textContent = photo.camera ? '📷 ' + photo.camera : '';
const gpsEl = document.getElementById('lightbox-gps');
gpsEl.textContent = `📍 ${photo.lat.toFixed(6)}, ${photo.lon.toFixed(6)}`;
const directionEl = document.getElementById('lightbox-direction');
if (photo.direction !== null && photo.direction !== undefined) {
directionEl.textContent = `🧭 ${Math.round(photo.direction)}°`;
} else {
directionEl.textContent = '';
}
// Aggiorna mappa lightbox
updateLightboxMap(photo);
}
function checkZoneChange(prevPhoto, nextPhoto) {
// Se non hanno cluster id, ignora
if (!prevPhoto.cluster_id || !nextPhoto.cluster_id) return;
if (prevPhoto.cluster_id !== nextPhoto.cluster_id) {
showZoneNotification(`📍 Nuova Zona`);
}
}
function showZoneNotification(text) {
const el = document.getElementById('zone-notification');
el.textContent = text;
el.classList.add('show');
// Nascondi dopo 3 secondi
setTimeout(() => {
el.classList.remove('show');
}, 3000);
}
function updateLightboxMap(photo) {
if (!mapLightbox) return;
setTimeout(() => {
mapLightbox.invalidateSize();
// Rimuovi tutti i layer esistenti tranne tile layer
mapLightbox.eachLayer(layer => {
if (!(layer instanceof L.TileLayer)) {
mapLightbox.removeLayer(layer);
}
});
// Mostra tutti i marker
const photosWithGPS = photosData.filter(p => p.has_gps && p.lat && p.lon);
photosWithGPS.forEach((p, i) => {
const isCurrentPhoto = p === photo;
const pIndex = photosData.indexOf(p);
const pFilename = p.display.split('/').pop();
if (isCurrentPhoto) {
// Marker corrente rosso semplice
if (p.direction !== null && p.direction !== undefined) {
// Calcola punto finale per la linea (30 metri)
const endPoint = destinationPoint(p.lat, p.lon, 30, p.direction);
// Linea di connessione
L.polyline(
[[p.lat, p.lon], [endPoint.lat, endPoint.lon]],
{ color: '#e74c3c', weight: 3, opacity: 0.8 }
).addTo(mapLightbox);
}
// Marker rosso
L.circleMarker([p.lat, p.lon], {
radius: 12,
fillColor: '#e74c3c',
color: 'white',
weight: 3,
fillOpacity: 1
})
.addTo(mapLightbox);
} else {
// Altri marker - usa circleMarker
// Color coding by cluster if available?
// Per ora standard blu
L.circleMarker([p.lat, p.lon], {
radius: 8,
fillColor: '#3498db',
color: 'white',
weight: 2,
fillOpacity: 1
})
.on('click', () => openLightbox(pIndex))
.addTo(mapLightbox);
}
});
// Centra sulla foto corrente con zoom più alto
mapLightbox.setView([photo.lat, photo.lon], 18);
}, 100);
}
function closeLightbox() {
document.getElementById('lightbox').classList.remove('active');
if (map) {
map.closePopup();
}
}
function navigateLightbox(direction) {
const photosWithGPS = photosData.filter(p => p.has_gps);
if (photosWithGPS.length === 0) return;
// Nota: currentLightboxIndex è l'indice nell'array globale photosData
// Dobbiamo trovarlo in photosWithGPS
const currentPhoto = photosData[currentLightboxIndex];
let currentGPSIndex = photosWithGPS.indexOf(currentPhoto);
if (currentGPSIndex === -1) {
// Fallback
currentGPSIndex = 0;
}
currentGPSIndex += direction;
if (currentGPSIndex < 0) currentGPSIndex = photosWithGPS.length - 1;
if (currentGPSIndex >= photosWithGPS.length) currentGPSIndex = 0;
const nextPhoto = photosWithGPS[currentGPSIndex];
const nextIndex = photosData.indexOf(nextPhoto);
openLightbox(nextIndex);
}
// Event listeners
document.addEventListener('DOMContentLoaded', () => {
loadPhotos();
// View buttons
document.querySelectorAll('.view-btn').forEach(btn => {
btn.addEventListener('click', () => switchView(btn.dataset.view));
});
// Map buttons
document.querySelectorAll('.map-btn').forEach(btn => {
btn.addEventListener('click', () => switchMapType(btn.dataset.map));
});
// Map toggle
const mapContainer = document.getElementById('lightbox-map-container');
const mapToggleBtn = document.getElementById('map-toggle-btn');
function toggleMap(e) {
if (e) e.stopPropagation();
const isMinimized = mapContainer.classList.toggle('minimized');
mapToggleBtn.textContent = isMinimized ? '🗺️' : '↘️';
if (!isMinimized) {
setTimeout(() => {
if (mapLightbox) mapLightbox.invalidateSize();
}, 300); // Wait for transition
}
}
mapToggleBtn.addEventListener('click', toggleMap);
// Expand when clicking on minimized container
mapContainer.addEventListener('click', (e) => {
if (mapContainer.classList.contains('minimized')) {
toggleMap(e);
}
});
// Keyboard navigation
document.addEventListener('keydown', (e) => {
if (document.getElementById('lightbox').classList.contains('active')) {
if (e.key === 'Escape') closeLightbox();
if (e.key === 'ArrowLeft') navigateLightbox(-1);
if (e.key === 'ArrowRight') navigateLightbox(1);
if (e.key === 'm') toggleMap(); // Shortcut for map
}
});
// Mobile Swipe Support
let touchStartX = 0;
let touchEndX = 0;
let isZooming = false;
const lightbox = document.getElementById('lightbox');
lightbox.addEventListener('touchstart', (e) => {
if (e.touches.length > 1) {
isZooming = true;
return;
}
isZooming = false;
touchStartX = e.changedTouches[0].screenX;
}, { passive: true });
lightbox.addEventListener('touchend', (e) => {
if (isZooming || e.touches.length > 0) return;
touchEndX = e.changedTouches[0].screenX;
handleSwipe();
}, { passive: true });
// Background click to close (optional but good UX), ensure not dragging
lightbox.addEventListener('click', (e) => {
if (e.target === lightbox) {
closeLightbox();
}
});
function handleSwipe() {
// Threshold for swipe detection
if (Math.abs(touchEndX - touchStartX) > 50) {
if (touchEndX < touchStartX) {
// Swipe Left -> Next
navigateLightbox(1);
}
if (touchEndX > touchStartX) {
// Swipe Right -> Previous
navigateLightbox(-1);
}
}
}
});