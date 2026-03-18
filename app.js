// Variabili globali
let photosData = [];
let lkhOrder = [];        // Ordine LKH ottimale (da lkh_tour.json), se disponibile
let useLKHNav = false;    // true = navigazione sinistra/destra segue ordine LKH
let currentView = 'map';  // Default: mappa
let currentMapType = 'osm';
let map = null;
let mapLightbox = null;
let markers = [];
let markerClusterGroup = null;
let currentLightboxIndex = -1;
let previousView = 'map'; // View to return to when closing photo view
// Bootstrap Italia sprite path
const BI_SPRITE = 'https://cdn.jsdelivr.net/npm/bootstrap-italia@2.17.4/dist/svg/sprites.svg';
// Helper per icone SVG Bootstrap Italia
function biIcon(name, extraClass = '') {
const cls = extraClass ? `icon ${extraClass}` : 'icon icon-xs';
return `<svg class="${cls}"><use href="${BI_SPRITE}#${name}"></use></svg>`;
}
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
// Restore state from URL hash on page load (permalink support)
const hash = window.location.hash;
if (PHOTO_HASH_RE.test(hash)) {
openLightboxFromHash(hash);
} else if (MAP_HASH_RE.test(hash)) {
applyMapHash(hash);  // override the fitBounds from initMaps
}
// Try to load LKH precomputed tour (non-blocking)
try {
const lkhRes = await fetch('data/lkh_tour.json');
if (lkhRes.ok) {
const lkhData = await lkhRes.json();
const byIdx = new Map(photosData.map((p, i) => [i, p]));
lkhOrder = (lkhData.tour_indices || [])
.map(i => byIdx.get(i))
.filter(p => p && p.has_gps);
if (lkhOrder.length > 0) {
useLKHNav = true;  // silently use LKH order always
console.info(`LKH nav active: ${lkhOrder.length} photos, ${(lkhData.length_m / 1000).toFixed(2)} km`);
}
}
} catch (_) {  }
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
// Renderizza galleria con Bootstrap Cards
function renderGallery() {
const grid = document.getElementById('photo-grid');
// Mostra solo foto con GPS
const photosToShow = photosData.filter(p => p.has_gps);
if (photosToShow.length === 0) {
grid.innerHTML = '<div class="col-12"><div class="alert alert-warning text-center">Nessuna foto con GPS trovata</div></div>';
return;
}
const html = photosToShow.map((photo) => {
const originalIndex = photosData.indexOf(photo);
const filename = photo.display.split('/').pop();
return `
<div class="col">
<div class="card photo-card shadow-sm h-100" onclick="openLightbox(${originalIndex})">
<img src="${photo.thumb}" class="card-img-top" alt="${filename}" loading="lazy">
<div class="card-body photo-card-body p-2">
<h6 class="card-title photo-card-title mb-1" title="${filename}">${filename}</h6>
<div class="photo-card-meta d-flex flex-wrap gap-1">
${photo.date ? `<span class="badge bg-light text-dark">${biIcon('it-calendar')} ${formatDate(photo.date)}</span>` : ''}
<span class="badge bg-success">${biIcon('it-pin', 'icon icon-xs icon-white')} GPS</span>
${photo.direction !== null && photo.direction !== undefined ?
`<span class="badge bg-info">${biIcon('it-arrow-up', 'icon icon-xs icon-white')} ${Math.round(photo.direction)}°</span>` : ''}
</div>
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
// Map permalink: update URL hash on move/zoom (only when map view is active)
map.on('moveend', () => {
if (currentView !== 'map') return;
const c = map.getCenter();
history.replaceState(null, '', `#${c.lat.toFixed(6)},${c.lng.toFixed(6)},${map.getZoom()}z`);
});
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
photosWithGPS.forEach((photo) => {
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
document.getElementById('gallery-view').style.display = 'none';
document.getElementById('map-view').style.display = 'none';
document.getElementById('photo-view').style.display = 'none';
const btnGallery = document.getElementById('viewGallery');
const btnMap = document.getElementById('viewMap');
if (view === 'gallery') {
document.getElementById('gallery-view').style.display = 'block';
btnGallery.checked = true;
btnMap.checked = false;
} else if (view === 'map') {
document.getElementById('map-view').style.display = 'block';
btnGallery.checked = false;
btnMap.checked = true;
setTimeout(() => { if (map) map.invalidateSize(); }, 100);
} else if (view === 'photo') {
document.getElementById('photo-view').style.display = 'flex';
btnGallery.checked = false;
btnMap.checked = false;
setTimeout(() => { if (mapLightbox) mapLightbox.invalidateSize(); }, 50);
}
}
// Cambia tipo mappa
function switchMapType(type) {
currentMapType = type;
updateMapTiles(map);
if (mapLightbox) updateMapTiles(mapLightbox);
}
// Apre la foto nella photo view (pagina dedicata, non modal)
function openLightbox(index) {
const prevIndex = currentLightboxIndex;
currentLightboxIndex = index;
const photo = photosData[index];
if (!photo.has_gps) return;
// Ricorda da dove siamo venuti per il tasto ✕
if (currentView !== 'photo') {
previousView = currentView;
}
// Mostra la photo view
switchView('photo');
// Re-minimize map on mobile when opening a new photo
if (window.innerWidth <= 768) {
const mapContainer = document.getElementById('lightbox-map-container');
const mapToggleBtn = document.getElementById('map-toggle-btn');
if (mapContainer && !mapContainer.classList.contains('minimized')) {
mapContainer.classList.add('minimized');
mapToggleBtn.innerHTML = biIcon('it-map-marker', 'icon icon-sm');
}
}
// Controlla cambia zona
if (prevIndex >= 0) {
checkZoneChange(photosData[prevIndex], photo);
}
updateLightboxContent(photo);
// Permalink: use file hash from filename (stable across photo additions)
const fileHash = photo.display.split('/').pop().split('.')[0];
history.replaceState(null, '', `#${fileHash}`);
}
function updateLightboxContent(photo) {
const imgElement = document.getElementById('lightbox-image');
const loader = document.getElementById('lightbox-loader');
// Show loader and hide image immediately
loader.style.display = 'block';
imgElement.style.opacity = '0';
// Create a new image to preload
const newImg = new Image();
newImg.onload = function () {
if (currentLightboxIndex === photosData.indexOf(photo)) {
imgElement.src = photo.display;
loader.style.display = 'none';
requestAnimationFrame(() => {
requestAnimationFrame(() => {
imgElement.style.opacity = '1';
});
});
}
};
newImg.src = photo.display;
// Sequence counter in header
const photosWithGPS = photosData.filter(p => p.has_gps);
const seqIndex = photosWithGPS.indexOf(photo) + 1;
document.getElementById('lightbox-sequence').textContent = `${seqIndex} / ${photosWithGPS.length}`;
// Date as plain text in header
const dateEl = document.getElementById('lightbox-date');
if (photo.date) {
dateEl.textContent = formatDate(photo.date);
dateEl.style.display = '';
} else {
dateEl.style.display = 'none';
}
// GPS coordinates (footer)
const gpsEl = document.getElementById('lightbox-gps');
gpsEl.innerHTML = `${biIcon('it-pin', 'icon icon-xs icon-white')} ${photo.lat.toFixed(6)}, ${photo.lon.toFixed(6)}`;
// Direction (footer)
const directionEl = document.getElementById('lightbox-direction');
if (photo.direction !== null && photo.direction !== undefined) {
directionEl.innerHTML = `${biIcon('it-arrow-up', 'icon icon-xs icon-white')} ${Math.round(photo.direction)}°`;
directionEl.style.display = '';
} else {
directionEl.style.display = 'none';
}
// Camera (footer)
const cameraEl = document.getElementById('lightbox-camera');
if (photo.camera) {
cameraEl.innerHTML = `${biIcon('it-camera', 'icon icon-xs icon-white')} ${photo.camera}`;
cameraEl.style.display = '';
} else {
cameraEl.style.display = 'none';
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
const container = document.getElementById('zone-notification');
const alert = container.querySelector('.alert');
const textEl = document.getElementById('zone-text');
textEl.textContent = text;
alert.classList.remove('d-none');
// Nascondi dopo 3 secondi
setTimeout(() => {
alert.classList.add('d-none');
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
photosWithGPS.forEach((p) => {
const isCurrentPhoto = p === photo;
const pIndex = photosData.indexOf(p);
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
currentLightboxIndex = -1;
switchView(previousView);
history.replaceState(null, '', mapHashCurrent() || (window.location.pathname + window.location.search));
}
function navigateLightbox(direction) {
// Choose the ordered sequence depending on the active navigation mode
const navOrder = (useLKHNav && lkhOrder.length > 0)
? lkhOrder
: photosData.filter(p => p.has_gps);
if (navOrder.length === 0) return;
const currentPhoto = photosData[currentLightboxIndex];
let idx = navOrder.indexOf(currentPhoto);
if (idx === -1) idx = 0;
idx = (idx + direction + navOrder.length) % navOrder.length;
const nextPhoto = navOrder[idx];
const nextIndex = photosData.indexOf(nextPhoto);
openLightbox(nextIndex);
}
// Permalink helper: open lightbox from a file hash string (e.g. #5d1c7f1ef4a17046)
const PHOTO_HASH_RE = /^#[0-9a-f]{10,}$/i;
function openLightboxFromHash(hash) {
if (!hash || !PHOTO_HASH_RE.test(hash)) return false;
const fileHash = hash.slice(1);
const index = photosData.findIndex(p => {
const h = p.display.split('/').pop().split('.')[0];
return h === fileHash;
});
if (index >= 0) {
openLightbox(index);
return true;
}
return false;
}
// Regex for map permalink hash: #lat,lon,zoomz  e.g. #45.123456,9.654321,14z
const MAP_HASH_RE = /^#(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+)z$/;
function applyMapHash(hash) {
const m = hash.match(MAP_HASH_RE);
if (m && map) {
map.setView([parseFloat(m[1]), parseFloat(m[2])], parseInt(m[3]));
return true;
}
return false;
}
function mapHashCurrent() {
if (!map) return '';
const c = map.getCenter();
return `#${c.lat.toFixed(6)},${c.lng.toFixed(6)},${map.getZoom()}z`;
}
// hashchange fires when user edits the URL hash in-page (no reload).
// Note: history.replaceState (used in openLightbox/closeLightbox) does NOT trigger this.
window.addEventListener('hashchange', () => {
const hash = window.location.hash;
if (PHOTO_HASH_RE.test(hash)) {
openLightboxFromHash(hash);
} else if (MAP_HASH_RE.test(hash)) {
closeLightbox();
applyMapHash(hash);
} else {
closeLightbox();
}
});
// Event listeners
document.addEventListener('DOMContentLoaded', () => {
switchView('map'); // set initial state explicitly
loadPhotos();
// View buttons (Bootstrap radio buttons)
document.getElementById('viewGallery').addEventListener('change', (e) => {
if (e.target.checked) switchView('gallery');
});
document.getElementById('viewMap').addEventListener('change', (e) => {
if (e.target.checked) switchView('map');
});
// Map type buttons
document.querySelectorAll('input[name="mapType"]').forEach(btn => {
btn.addEventListener('change', (e) => {
if (e.target.checked) switchMapType(e.target.dataset.map);
});
});
// Map toggle
const mapContainer = document.getElementById('lightbox-map-container');
const mapToggleBtn = document.getElementById('map-toggle-btn');
function toggleMap(e) {
if (e) e.stopPropagation();
const isMinimized = mapContainer.classList.toggle('minimized');
mapToggleBtn.innerHTML = isMinimized
? biIcon('it-map-marker', 'icon icon-sm')
: biIcon('it-minimize', 'icon icon-sm');
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
// Auto-minimize on mobile
if (window.innerWidth <= 768) {
mapContainer.classList.add('minimized');
mapToggleBtn.innerHTML = biIcon('it-map-marker', 'icon icon-sm');
}
// Keyboard navigation
document.addEventListener('keydown', (e) => {
if (currentView === 'photo') {
if (e.key === 'Escape') closeLightbox();
if (e.key === 'ArrowLeft') navigateLightbox(-1);
if (e.key === 'ArrowRight') navigateLightbox(1);
if (e.key === 'm' || e.key === 'M') toggleMap();
}
});
// Mobile Zoom & Swipe Support
const imageContainer = document.querySelector('.lightbox-image-container');
const imgElement = document.getElementById('lightbox-image');
// Zoom State
let scale = 1;
let pointX = 0;
let pointY = 0;
let startX = 0;
let startY = 0;
let isDragging = false;
let startDist = 0;
// Swipe Navigation State
let swipeStartX = 0;
let swipeStartY = 0;
// Prevent default touch behavior to stop scrolling/zooming the whole page
imageContainer.addEventListener('gesturestart', (e) => e.preventDefault());
imageContainer.addEventListener('gesturechange', (e) => e.preventDefault());
imageContainer.addEventListener('gestureend', (e) => e.preventDefault());
imageContainer.addEventListener('touchstart', (e) => {
if (e.touches.length === 2) {
// Pinch to Zoom handling
e.preventDefault(); // Prevent page zoom
startDist = Math.hypot(
e.touches[0].pageX - e.touches[1].pageX,
e.touches[0].pageY - e.touches[1].pageY
);
} else if (e.touches.length === 1) {
// Single finger touch - could be pan (if zoomed) or swipe (if not)
startX = e.touches[0].pageX;
startY = e.touches[0].pageY;
swipeStartX = startX;
swipeStartY = startY;
isDragging = true;
}
}, { passive: false }); // passive: false needed for preventDefault
imageContainer.addEventListener('touchmove', (e) => {
if (e.touches.length === 2) {
// Pinching
e.preventDefault();
const dist = Math.hypot(
e.touches[0].pageX - e.touches[1].pageX,
e.touches[0].pageY - e.touches[1].pageY
);
if (startDist > 0) {
const deltaScale = dist / startDist;
// Limit scale change speed and range
const newScale = Math.min(Math.max(scale * deltaScale, 0.5), 5); // Min 0.5x, Max 5x
// Update scale but keep position relative for now (centered zoom)
// Proper focal point zoom is complex, staying with center zoom for simplicity first
scale = newScale;
updateImageTransform();
startDist = dist; // Reset start dist for continuous zoom
}
} else if (e.touches.length === 1 && isDragging) {
// Panning or Swiping
const x = e.touches[0].pageX;
const y = e.touches[0].pageY;
const deltaX = x - startX;
const deltaY = y - startY;
if (scale > 1.1) {
// If zoomed in, Pan
e.preventDefault();
pointX += deltaX;
pointY += deltaY;
updateImageTransform();
} else {
// Check if it's a horizontal swipe for navigation
// allow vertical scrolling of page if needed (though lightbox is fixed)
if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
e.preventDefault(); // Lock scroll if horizontal swipe
}
}
startX = x;
startY = y;
}
}, { passive: false });
imageContainer.addEventListener('touchend', (e) => {
isDragging = false;
if (e.touches.length === 0) {
// All fingers off
if (scale < 1) {
// Reset if zoomed out too much
resetZoom();
} else if (scale > 1) {
// Limit panning to boundaries if needed, or just let it be free
// For now, no strict boundary checks
} else {
// Not zoomed (or barely), check for swipe navigation
const deltaX = startX - swipeStartX;
const deltaY = startY - swipeStartY;
// Only swipe if horizontal move dominates and is long enough
if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
if (deltaX < 0) navigateLightbox(1); // Next
else navigateLightbox(-1); // Prev
}
}
}
});
// MOUSE EVENTS FOR DESKTOP
// Wheel to zoom
imageContainer.addEventListener('wheel', (e) => {
e.preventDefault();
const delta = -Math.sign(e.deltaY) * 0.1;
const newScale = Math.min(Math.max(scale + delta, 0.5), 5); // Min 0.5x, Max 5x
scale = newScale;
updateImageTransform();
}, { passive: false });
// Mouse Drag to Pan
imageContainer.addEventListener('mousedown', (e) => {
if (scale > 1) {
isDragging = true;
startX = e.clientX;
startY = e.clientY;
e.preventDefault(); // Prevent default drag behavior
}
});
imageContainer.addEventListener('mousemove', (e) => {
if (isDragging && scale > 1) {
e.preventDefault();
const deltaX = e.clientX - startX;
const deltaY = e.clientY - startY;
pointX += deltaX;
pointY += deltaY;
startX = e.clientX;
startY = e.clientY;
updateImageTransform();
}
});
imageContainer.addEventListener('mouseup', () => {
isDragging = false;
});
imageContainer.addEventListener('mouseleave', () => {
isDragging = false;
});
// Helper to update transform
function updateImageTransform() {
// Calculate limit ranges
// Image dimensions
const imgWidth = imgElement.offsetWidth * scale;
const imgHeight = imgElement.offsetHeight * scale;
// Container dimensions
const containerWidth = imageContainer.offsetWidth;
const containerHeight = imageContainer.offsetHeight;
// Calculate max offsets (from center)
// If image is smaller than container effectively, max offset is 0 (keep centered)
// If image is larger, max offset is (imgDim - containerDim) / 2
const maxOffsetX = Math.max(0, (imgWidth - containerWidth) / 2);
const maxOffsetY = Math.max(0, (imgHeight - containerHeight) / 2);
// Clamp
pointX = Math.max(-maxOffsetX, Math.min(pointX, maxOffsetX));
pointY = Math.max(-maxOffsetY, Math.min(pointY, maxOffsetY));
imgElement.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
}
// Helper to reset zoom
window.resetZoom = function () {
scale = 1;
pointX = 0;
pointY = 0;
imgElement.style.transform = '';
}
});
// Reset zoom when opening/changing photo
// Hook into existing functions by adding calls or overriding
const originalUpdateLightboxContent = updateLightboxContent;
updateLightboxContent = function (photo) {
if (window.resetZoom) window.resetZoom();
originalUpdateLightboxContent(photo);
};