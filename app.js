// Variabili globali
let photosData = [];
let navGraph = null;      // Grafo navigazione spaziale (nav_graph.json)
let lkhOrder = [];        // Ordine LKH ottimale (da lkh_tour.json), se disponibile
let currentView = 'map';  // Default: mappa
let currentMapType = 'osm';
let map = null;
let mapLightbox = null;
let markers = [];
let markerClusterGroup = null;
let tourPolyline = null;
let lkhTourMeta = null;
let tourPlaying = false;
let tourPlayTimer = null;
let currentLightboxIndex = -1;
let previousView = 'map'; // View to return to when closing photo view
let activeZoneFilter = null; // null = tutte le zone
const WELCOME_STORAGE_KEY = 'vitali-gallery-welcome-seen';
const TOUR_PLAY_MS = 3500;
const PHOTO_TRANSITION_MS = 380;
const PANORAMAX_API = 'https://api.panoramax.xyz/api';
const PANORAMAX_SEARCH = `${PANORAMAX_API}/search`;
const PANORAMAX_VIEWER = 'https://api.panoramax.xyz/en/index';
const PANORAMAX_SEARCH_RADIUS_DEG = 0.001; // ~80–110 m intorno al punto
const PANORAMAX_MAX_DIST_M = 120;
const panoramaxCache = new Map();
let currentPanoramaxMatch = null;
let panoramaxPannellumViewer = null;
let lightboxImageTransitionTimer = null;
const ZONE_COLORS = [
'#e94560', '#4ecdc4', '#ffe66d', '#a855f7', '#fb923c',
'#22d3ee', '#86efac', '#f472b6', '#facc15', '#60a5fa',
'#34d399', '#c084fc'
];
// Bootstrap Italia sprite path
const BI_SPRITE = 'https://cdn.jsdelivr.net/npm/bootstrap-italia@2.17.4/dist/svg/sprites.svg';
// ID stabile (hash) — usato solo per permalink, mai mostrato in UI
function photoId(photo) {
return photo.id || photo.display.split('/').pop().split('.')[0];
}
// Etichetta visibile per l'utente (senza nomi file)
function photoLabel(seqIndex) {
return `Foto ${seqIndex}`;
}
let siteMeta = null;
function readSiteMeta() {
const ds = document.body.dataset;
return {
siteUrl: (ds.siteUrl || '').replace(/\/$/, ''),
siteTitle: ds.siteTitle || document.title,
metaDescription: ds.metaDescription || '',
ogImage: ds.ogImage || '',
};
}
function queryMeta(attr, key) {
return document.querySelector(`meta[${attr}="${key}"]`);
}
function setMetaProperty(prop, value) {
let el = queryMeta('property', prop);
if (!el) {
el = document.createElement('meta');
el.setAttribute('property', prop);
document.head.appendChild(el);
}
el.setAttribute('content', value);
}
function setMetaName(name, value) {
let el = queryMeta('name', name);
if (!el) {
el = document.createElement('meta');
el.setAttribute('name', name);
document.head.appendChild(el);
}
el.setAttribute('content', value);
}
function setCanonical(url) {
let el = document.querySelector('link[rel="canonical"]');
if (!el) {
el = document.createElement('link');
el.rel = 'canonical';
document.head.appendChild(el);
}
el.href = url;
}
function absoluteAsset(path) {
if (!path) return '';
if (/^https?:\/\//i.test(path)) return path;
const base = siteMeta?.siteUrl
|| `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '')}`;
return `${base}/${path.replace(/^\//, '')}`;
}
function updatePageMeta(photo, seqIndex = 1) {
if (!siteMeta) siteMeta = readSiteMeta();
if (photo) {
const label = photoLabel(seqIndex);
const title = `${label} — ${siteMeta.siteTitle}`;
const desc = `${label} geolocalizzata (${photo.lat.toFixed(4)}, ${photo.lon.toFixed(4)}) — ${siteMeta.siteTitle}`;
const pageUrl = siteMeta.siteUrl
? `${siteMeta.siteUrl}/?foto=${photoId(photo)}`
: `${window.location.origin}${window.location.pathname}?foto=${photoId(photo)}`;
const image = absoluteAsset(photo.display || photo.thumb);
document.title = title;
setMetaName('description', desc);
setMetaProperty('og:title', title);
setMetaProperty('og:description', desc);
setMetaProperty('og:url', pageUrl);
setMetaProperty('og:image', image);
setMetaName('twitter:title', title);
setMetaName('twitter:description', desc);
setMetaName('twitter:image', image);
setCanonical(pageUrl);
return;
}
document.title = siteMeta.siteTitle;
setMetaName('description', siteMeta.metaDescription);
setMetaProperty('og:title', siteMeta.siteTitle);
setMetaProperty('og:description', siteMeta.metaDescription);
const homeUrl = siteMeta.siteUrl || `${window.location.origin}${window.location.pathname}`;
setMetaProperty('og:url', homeUrl);
setMetaProperty('og:image', siteMeta.ogImage);
setMetaName('twitter:title', siteMeta.siteTitle);
setMetaName('twitter:description', siteMeta.metaDescription);
setMetaName('twitter:image', siteMeta.ogImage);
setCanonical(homeUrl);
}
// Helper per icone SVG Bootstrap Italia
function biIcon(name, extraClass = '') {
const cls = extraClass ? `icon ${extraClass}` : 'icon icon-xs';
return `<svg class="${cls}"><use href="${BI_SPRITE}#${name}"></use></svg>`;
}
function photosWithGps() {
return photosData.filter(p => p.has_gps && p.lat && p.lon);
}
function visiblePhotos() {
const gps = photosWithGps();
if (activeZoneFilter === null) return gps;
return gps.filter(p => p.cluster_id === activeZoneFilter);
}
function clusterColor(id) {
if (!id) return '#0066cc';
return ZONE_COLORS[(id - 1) % ZONE_COLORS.length];
}
function zoneChipTextColor(hex) {
const r = parseInt(hex.slice(1, 3), 16);
const g = parseInt(hex.slice(3, 5), 16);
const b = parseInt(hex.slice(5, 7), 16);
const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
return lum > 0.62 ? '#17324d' : '#fff';
}
function zoneChipStyles(zoneId, isActive) {
const col = clusterColor(zoneId);
const r = parseInt(col.slice(1, 3), 16);
const g = parseInt(col.slice(3, 5), 16);
const b = parseInt(col.slice(5, 7), 16);
if (isActive) {
const text = zoneChipTextColor(col);
return `background:${col};border-color:${col};color:${text}`;
}
return `background:rgba(${r},${g},${b},0.16);border-color:${col};color:#17324d`;
}
function tourPhotosForPolyline() {
if (!lkhOrder.length) return [];
if (activeZoneFilter === null) return lkhOrder;
return lkhOrder.filter(p => p.cluster_id === activeZoneFilter);
}
function updateTourPolyline() {
if (!map) return;
if (tourPolyline) {
map.removeLayer(tourPolyline);
tourPolyline = null;
}
const tour = tourPhotosForPolyline();
if (tour.length < 2) return;
tourPolyline = L.polyline(tour.map(p => [p.lat, p.lon]), {
color: '#14b8a6',
weight: 3,
opacity: 0.8
}).addTo(map);
}
function updateTourControlsVisibility() {
const el = document.getElementById('tour-controls');
if (el) el.classList.toggle('d-none', lkhOrder.length === 0);
}
function tourNavOrder() {
const tour = tourPhotosForPolyline();
if (tour.length > 0) return tour;
return visiblePhotos();
}
function updateTourProgress() {
const navOrder = tourNavOrder();
if (!navOrder.length) return;
let idx = 0;
if (currentLightboxIndex >= 0) {
const current = photosData[currentLightboxIndex];
const found = navOrder.indexOf(current);
if (found >= 0) idx = found;
}
const label = document.getElementById('tour-progress-label');
const bar = document.getElementById('tour-progress-bar');
if (label) label.textContent = `Foto ${idx + 1} / ${navOrder.length}`;
if (bar) {
const pct = ((idx + 1) / navOrder.length) * 100;
bar.style.width = `${pct}%`;
bar.setAttribute('aria-valuenow', Math.round(pct));
}
const km = document.getElementById('tour-km-label');
if (km) {
km.textContent = lkhTourMeta?.length_m
? `${(lkhTourMeta.length_m / 1000).toFixed(1)} km`
: '';
}
}
function startTourPlay() {
if (!lkhOrder.length) return;
stopTourPlay(false);
tourPlaying = true;
document.getElementById('tour-play-btn')?.classList.add('d-none');
document.getElementById('tour-pause-btn')?.classList.remove('d-none');
const navOrder = tourNavOrder();
if (!navOrder.length) return;
if (currentLightboxIndex < 0) {
openLightbox(photosData.indexOf(navOrder[0]));
} else if (currentView !== 'photo') {
switchView('photo');
}
announce('Percorso automatico avviato');
tourPlayTimer = setInterval(() => {
if (currentView !== 'photo') switchView('photo');
if (!spatialNavigate('forward', true)) navigateLightbox(1, true);
updateTourProgress();
}, TOUR_PLAY_MS);
}
function stopTourPlay(updateButtons = true) {
const wasPlaying = tourPlaying;
tourPlaying = false;
if (tourPlayTimer) clearInterval(tourPlayTimer);
tourPlayTimer = null;
if (updateButtons) {
document.getElementById('tour-play-btn')?.classList.remove('d-none');
document.getElementById('tour-pause-btn')?.classList.add('d-none');
}
if (wasPlaying && updateButtons) announce('Percorso automatico in pausa');
}
function announce(message) {
const el = document.getElementById('aria-announcer');
if (!el || !message) return;
el.textContent = '';
requestAnimationFrame(() => { el.textContent = message; });
}
function showToast(message) {
const toast = document.getElementById('app-toast');
if (!toast || !message) return;
toast.textContent = message;
toast.classList.add('show');
announce(message);
clearTimeout(showToast._timer);
showToast._timer = setTimeout(() => {
toast.classList.remove('show');
toast.textContent = '';
}, 2500);
}
function spatialNavEntry(index) {
if (!navGraph?.by_index || index < 0) return null;
return navGraph.by_index[index] || null;
}
function spatialNavigate(direction, fromAutoplay = false) {
if (currentLightboxIndex < 0) return false;
if (tourPlaying && !fromAutoplay) stopTourPlay();
const entry = spatialNavEntry(currentLightboxIndex);
const targetIndex = entry?.[direction];
if (targetIndex === null || targetIndex === undefined) return false;
const navDir = direction === 'forward' ? 1 : direction === 'back' ? -1 : 0;
openLightbox(targetIndex, navDir);
const labels = { forward: 'Avanti', back: 'Indietro', left: 'Sinistra', right: 'Destra' };
announce(`${labels[direction] || direction}`);
return true;
}
function updateSpatialNavUI() {
const entry = spatialNavEntry(currentLightboxIndex);
const labels = {
forward: 'Avanti',
back: 'Indietro',
left: 'Sinistra',
right: 'Destra'
};
const dirs = ['forward', 'back', 'left', 'right'];
dirs.forEach(dir => {
const btn = document.getElementById(`spatial-${dir}`);
if (!btn) return;
const targetIdx = entry?.[dir];
const available = targetIdx !== null && targetIdx !== undefined;
btn.disabled = !available;
if (!available) return;
const neighbor = entry.neighbors?.find(c => c.index === targetIdx);
const dist = neighbor ? ` — ${neighbor.dist_m} m` : '';
btn.title = `${labels[dir]}${dist}`;
});
}
function haversineMeters(lat1, lon1, lat2, lon2) {
const R = 6371000;
const p1 = lat1 * Math.PI / 180;
const p2 = lat2 * Math.PI / 180;
const dp = (lat2 - lat1) * Math.PI / 180;
const dl = (lon2 - lon1) * Math.PI / 180;
const a = Math.sin(dp / 2) ** 2
+ Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function panoramaxCollectionId(feature) {
const link = feature?.links?.find(l => l.rel === 'collection');
if (!link?.href) return null;
const m = link.href.match(/\/collections\/([^/]+)/);
return m ? m[1] : null;
}
function panoramaxThumbUrl(feature) {
return feature?.assets?.thumb?.href
|| `https://api.panoramax.xyz/api/pictures/${feature.id}/thumb.jpg`;
}
function panoramaxPreviewUrl(feature) {
return feature?.assets?.sd?.href
|| panoramaxThumbUrl(feature);
}
function panoramaxHeading(feature) {
const ex = feature?.properties?.exif || {};
const raw = ex['Xmp.GPano.PoseHeadingDegrees']
?? ex['Xmp.GPano.InitialViewHeadingDegrees'];
if (raw == null || raw === '') return null;
const v = parseFloat(raw);
return Number.isFinite(v) ? v : null;
}
function panoramaxMatchFromFeature(feature, photoLat, photoLon) {
const [lon, lat] = feature.geometry?.coordinates || [];
if (!feature?.id || lat == null || lon == null) return null;
const distM = haversineMeters(photoLat, photoLon, lat, lon);
if (distM > PANORAMAX_MAX_DIST_M) return null;
return {
picId: feature.id,
seqId: panoramaxCollectionId(feature),
lat,
lon,
distM,
heading: panoramaxHeading(feature),
thumbUrl: panoramaxThumbUrl(feature),
previewUrl: panoramaxPreviewUrl(feature),
};
}
async function findPanoramaxPicture(lat, lon) {
const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
if (panoramaxCache.has(key)) return panoramaxCache.get(key);
try {
const r = PANORAMAX_SEARCH_RADIUS_DEG;
const bbox = [lon - r, lat - r, lon + r, lat + r].join(',');
const url = `${PANORAMAX_SEARCH}?bbox=${bbox}&limit=12`;
const res = await fetch(url);
if (!res.ok) {
panoramaxCache.set(key, null);
return null;
}
const data = await res.json();
let best = null;
for (const feature of data.features || []) {
const match = panoramaxMatchFromFeature(feature, lat, lon);
if (!match) continue;
if (!best || match.distM < best.distM) best = match;
}
panoramaxCache.set(key, best);
return best;
} catch (_) {
panoramaxCache.set(key, null);
return null;
}
}
function panoramaxViewerUrl(photo, match) {
const picId = typeof match === 'string' ? match : match?.picId;
const seqId = typeof match === 'object' ? match?.seqId : null;
if (!picId) return PANORAMAX_VIEWER;
let url = `${PANORAMAX_VIEWER}?focus=pic&map=18/${photo.lat}/${photo.lon}&pic=${picId}`;
if (seqId) url += `&seq=${seqId}`;
if (photo.direction !== null && photo.direction !== undefined) {
url += `&xyz=${Math.round(photo.direction)}/0/30`;
}
return url;
}
// Yaw Pannellum: direzione bussola archivio rispetto al nord iniziale del panorama Panoramax.
function panoramaxViewYaw(photo, match) {
const archiveHeading = photo?.direction;
if (archiveHeading == null) return 0;
const panoZero = match?.heading ?? 0;
let yaw = archiveHeading - panoZero;
while (yaw > 180) yaw -= 360;
while (yaw < -180) yaw += 360;
return yaw;
}
function destroyPanoramaxPannellum() {
if (panoramaxPannellumViewer) {
try {
panoramaxPannellumViewer.destroy();
} catch (_) {  }
panoramaxPannellumViewer = null;
}
}
function closePanoramaxZoom() {
destroyPanoramaxPannellum();
document.getElementById('panoramax-zoom')?.classList.add('d-none');
}
function openPanoramaxZoom() {
if (!currentPanoramaxMatch?.previewUrl || typeof pannellum === 'undefined') return;
const zoom = document.getElementById('panoramax-zoom');
if (!zoom) return;
destroyPanoramaxPannellum();
zoom.classList.remove('d-none');
const photo = photosData[currentLightboxIndex];
const match = currentPanoramaxMatch;
const yaw = panoramaxViewYaw(photo, match);
requestAnimationFrame(() => {
requestAnimationFrame(() => {
if (!isPanoramaxZoomOpen()) return;
try {
panoramaxPannellumViewer = pannellum.viewer('panoramax-zoom-pano', {
type: 'equirectangular',
panorama: match.previewUrl,
crossOrigin: 'anonymous',
autoLoad: true,
yaw,
pitch: 0,
hfov: 95,
minHfov: 50,
maxHfov: 110,
showZoomCtrl: true,
showFullscreenCtrl: false,
compass: false,
northOffset: match.heading ?? 0,
});
panoramaxPannellumViewer.on('load', () => {
if (!isPanoramaxZoomOpen()) return;
panoramaxPannellumViewer.setYaw(yaw);
panoramaxPannellumViewer.setPitch(0);
});
} catch (err) {
console.error('Panoramax preview failed:', err);
closePanoramaxZoom();
}
});
});
}
function isPanoramaxZoomOpen() {
const zoom = document.getElementById('panoramax-zoom');
return zoom && !zoom.classList.contains('d-none');
}
function hidePanoramaxPreview() {
closePanoramaxZoom();
currentPanoramaxMatch = null;
document.getElementById('panoramax-preview')?.classList.add('d-none');
const thumb = document.getElementById('panoramax-thumb');
if (thumb) thumb.removeAttribute('src');
const link = document.getElementById('lightbox-panoramax');
if (link) {
link.classList.add('d-none');
link.removeAttribute('href');
}
}
function showPanoramaxPreview(photo, match) {
const viewerUrl = panoramaxViewerUrl(photo, match);
const badge = document.getElementById('lightbox-panoramax');
if (badge) {
badge.href = viewerUrl;
badge.classList.remove('d-none');
}
const preview = document.getElementById('panoramax-preview');
const thumb = document.getElementById('panoramax-thumb');
const offset = document.getElementById('panoramax-offset');
if (!preview || !thumb) return;
thumb.src = match.thumbUrl;
thumb.alt = `Panoramax a ${Math.round(match.distM)} m da questa foto`;
if (offset) {
offset.textContent = `${Math.round(match.distM)} m`;
}
preview.classList.remove('d-none');
}
function updatePanoramaxPreview(photo) {
hidePanoramaxPreview();
findPanoramaxPicture(photo.lat, photo.lon).then(match => {
if (currentLightboxIndex !== photosData.indexOf(photo) || !match?.picId) return;
currentPanoramaxMatch = match;
showPanoramaxPreview(photo, match);
});
}
function mapToggleButtonContent(isMinimized) {
return isMinimized
? '<span class="map-toggle-symbol map-toggle-plus" aria-hidden="true"></span>'
: '<span class="map-toggle-symbol map-toggle-minus" aria-hidden="true"></span>';
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
siteMeta = readSiteMeta();
updateStats(data);
renderZoneBar();
renderGallery();
initMaps();
// Restore state from URL (permalink: ?foto=id o #id)
const hash = window.location.hash;
const fotoParam = new URLSearchParams(window.location.search).get('foto');
if (fotoParam) {
const idx = photosData.findIndex(p => photoId(p) === fotoParam);
if (idx >= 0) openLightbox(idx);
} else if (PHOTO_HASH_RE.test(hash)) {
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
lkhTourMeta = lkhData;
updateTourPolyline();
updateTourControlsVisibility();
updateTourProgress();
console.info(`LKH nav active: ${lkhOrder.length} photos, ${(lkhData.length_m / 1000).toFixed(2)} km`);
}
}
} catch (_) {  }
try {
const navRes = await fetch('data/nav_graph.json');
if (navRes.ok) {
navGraph = await navRes.json();
console.info(`Spatial nav: ${navGraph.by_index?.length || 0} entries`);
}
} catch (_) {  }
maybeShowWelcome(hash);
} catch (error) {
console.error('Errore caricamento foto:', error);
}
}
// Aggiorna statistiche
function updateStats(data) {
const gpsPhotos = data.photos.filter(p => p.has_gps).length;
document.getElementById('total-photos').textContent = gpsPhotos;
const welcomeCount = document.getElementById('welcome-photo-count');
if (welcomeCount) welcomeCount.textContent = gpsPhotos;
}
function renderZoneBar() {
const bar = document.getElementById('zone-bar');
if (!bar) return;
const gps = photosWithGps();
const zoneCounts = new Map();
gps.forEach(p => {
const z = p.cluster_id;
if (z) zoneCounts.set(z, (zoneCounts.get(z) || 0) + 1);
});
const zones = [...zoneCounts.keys()].sort((a, b) => a - b);
if (zones.length <= 1) {
bar.classList.add('d-none');
return;
}
bar.classList.remove('d-none');
const chips = [
`<button type="button" class="zone-chip zone-chip--all${activeZoneFilter === null ? ' active' : ''}" data-zone="">Tutte (${gps.length})</button>`
];
zones.forEach(z => {
const active = activeZoneFilter === z ? ' active' : '';
const style = zoneChipStyles(z, activeZoneFilter === z);
chips.push(`<button type="button" class="zone-chip${active}" data-zone="${z}" style="${style}">Zona ${z} (${zoneCounts.get(z)})</button>`);
});
bar.innerHTML = chips.join('');
bar.querySelectorAll('.zone-chip').forEach(btn => {
btn.addEventListener('click', () => {
const raw = btn.dataset.zone;
activeZoneFilter = raw === '' ? null : Number(raw);
const count = visiblePhotos().length;
announce(raw === '' ? `Tutte le zone, ${count} foto` : `Zona ${raw}, ${count} foto`);
renderZoneBar();
renderGallery();
updateMapMarkers();
updateTourPolyline();
updateTourProgress();
});
});
}
function maybeShowWelcome(hash) {
if (localStorage.getItem(WELCOME_STORAGE_KEY)) return;
if (PHOTO_HASH_RE.test(hash) || MAP_HASH_RE.test(hash)) return;
const overlay = document.getElementById('welcome-overlay');
if (overlay) overlay.classList.remove('d-none');
}
function dismissWelcome(persist = true) {
const overlay = document.getElementById('welcome-overlay');
if (overlay) overlay.classList.add('d-none');
if (persist) localStorage.setItem(WELCOME_STORAGE_KEY, '1');
}
function startTourFromWelcome() {
const first = tourNavOrder()[0];
if (first) openLightbox(photosData.indexOf(first));
}
async function copyPhotoLink() {
const url = window.location.href;
try {
await navigator.clipboard.writeText(url);
showToast('Link copiato negli appunti');
} catch (_) {
showToast('Impossibile copiare il link');
}
}
// Renderizza galleria con Bootstrap Cards
function renderGallery() {
const grid = document.getElementById('photo-grid');
const photosToShow = visiblePhotos();
if (photosToShow.length === 0) {
const msg = activeZoneFilter
? 'Nessuna foto in questa zona'
: 'Nessuna foto con GPS trovata';
grid.innerHTML = `<div class="masonry-item"><div class="alert alert-warning text-center">${msg}</div></div>`;
return;
}
const html = photosToShow.map((photo, seqIndex) => {
const originalIndex = photosData.indexOf(photo);
const label = photoLabel(seqIndex + 1);
return `
<div class="masonry-item" role="listitem">
<div class="card photo-card shadow-sm" onclick="openLightbox(${originalIndex})"
onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openLightbox(${originalIndex})}"
role="button" tabindex="0" aria-label="${label}">
<img src="${photo.thumb}" alt="${label}" loading="lazy">
<div class="card-body photo-card-body p-2">
<div class="photo-card-label mb-1">${label}</div>
<div class="photo-card-meta d-flex flex-wrap gap-1">
${photo.cluster_id ? (() => {
const zc = clusterColor(photo.cluster_id);
return `<span class="badge" style="background:${zc};color:${zoneChipTextColor(zc)}">Zona ${photo.cluster_id}</span>`;
})() : ''}
<span class="badge bg-success">GPS</span>
${photo.direction !== null && photo.direction !== undefined ?
`<span class="badge bg-info">${Math.round(photo.direction)}°</span>` : ''}
</div>
</div>
</div>
</div>
`;
}).join('');
grid.innerHTML = html;
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
const photosWithGPS = visiblePhotos();
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
mapLightbox = L.map('lightbox-map', {
zoomControl: false
}).setView(initialView, 15);
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
const photosWithGPS = visiblePhotos();
if (photosWithGPS.length === 0) return;
markerClusterGroup = L.markerClusterGroup({
maxClusterRadius: 50,
spiderfyOnMaxZoom: true,
showCoverageOnHover: false,
zoomToBoundsOnClick: true
});
photosWithGPS.forEach((photo) => {
const photoIndex = photosData.indexOf(photo);
const zoneCol = clusterColor(photo.cluster_id);
const icon = L.divIcon({
className: 'custom-div-icon',
html: `<div class="marker-thumb" style="width:40px;height:40px;border-color:${zoneCol};background-image:url('${photo.thumb}')"></div>`,
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
fitMapToVisiblePhotos();
updateTourPolyline();
}
function fitMapToVisiblePhotos() {
if (!map) return;
const photosWithGPS = visiblePhotos();
if (photosWithGPS.length === 0) return;
const bounds = L.latLngBounds(photosWithGPS.map(p => [p.lat, p.lon]));
if (photosWithGPS.length === 1) {
map.setView([photosWithGPS[0].lat, photosWithGPS[0].lon], 17);
} else {
map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
}
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
setTimeout(() => {
if (!map) return;
map.invalidateSize();
fitMapToVisiblePhotos();
}, 100);
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
function openLightbox(index, navDirection = 0) {
const prevIndex = currentLightboxIndex;
currentLightboxIndex = index;
const photo = photosData[index];
if (!photo.has_gps) return;
// Ricorda da dove siamo venuti per il tasto ✕
if (currentView !== 'photo') {
previousView = currentView;
}
const useTransition = currentView === 'photo' && prevIndex >= 0 && prevIndex !== index;
// Mostra la photo view
switchView('photo');
// Re-minimize map on mobile when opening a new photo
if (window.innerWidth <= 768) {
const mapContainer = document.getElementById('lightbox-map-container');
const mapToggleBtn = document.getElementById('map-toggle-btn');
if (mapContainer && !mapContainer.classList.contains('minimized')) {
mapContainer.classList.add('minimized');
mapToggleBtn.innerHTML = mapToggleButtonContent(true);
}
}
// Controlla cambia zona
if (prevIndex >= 0) {
checkZoneChange(photosData[prevIndex], photo);
}
updateLightboxContent(photo, { transition: useTransition, direction: navDirection });
const navOrder = tourNavOrder();
const seqIndex = Math.max(1, navOrder.indexOf(photo) + 1);
updatePageMeta(photo, seqIndex);
history.replaceState(null, '', `#${photoId(photo)}`);
updateTourProgress();
}
function removeLightboxImageNext() {
document.getElementById('lightbox-image-next')?.remove();
}
function clearLightboxImageTransition() {
if (lightboxImageTransitionTimer) {
clearTimeout(lightboxImageTransitionTimer);
lightboxImageTransitionTimer = null;
}
removeLightboxImageNext();
}
function setLightboxImageInstant(imgElement, loader, src) {
imgElement.style.transition = 'none';
imgElement.style.transform = '';
imgElement.src = src;
imgElement.style.opacity = '1';
loader.style.display = 'none';
void imgElement.offsetWidth;
imgElement.style.transition = '';
}
function updateLightboxImage(photo, options = {}) {
const { transition = false, direction = 0 } = options;
const imgElement = document.getElementById('lightbox-image');
const loader = document.getElementById('lightbox-loader');
const container = imgElement?.parentElement;
if (!imgElement || !container) return;
clearLightboxImageTransition();
const newImg = new Image();
newImg.onload = function () {
if (currentLightboxIndex !== photosData.indexOf(photo)) return;
if (!transition || !imgElement.src) {
setLightboxImageInstant(imgElement, loader, photo.display);
return;
}
let next = document.getElementById('lightbox-image-next');
if (!next) {
next = document.createElement('img');
next.id = 'lightbox-image-next';
next.className = 'lightbox-image-next img-fluid';
container.insertBefore(next, imgElement);
}
const slideIn = direction > 0 ? '2.5%' : direction < 0 ? '-2.5%' : '0';
const slideOut = direction > 0 ? '-2%' : direction < 0 ? '2%' : '0';
const easing = `opacity ${PHOTO_TRANSITION_MS}ms ease, transform ${PHOTO_TRANSITION_MS}ms ease`;
next.style.transition = 'none';
next.style.opacity = '0';
next.style.transform = `translateX(${slideIn})`;
next.src = photo.display;
next.alt = imgElement.alt;
void next.offsetWidth;
next.style.transition = easing;
imgElement.style.transition = easing;
requestAnimationFrame(() => {
imgElement.style.opacity = '0';
imgElement.style.transform = `translateX(${slideOut})`;
next.style.opacity = '1';
next.style.transform = 'translateX(0)';
});
lightboxImageTransitionTimer = setTimeout(() => {
lightboxImageTransitionTimer = null;
if (currentLightboxIndex !== photosData.indexOf(photo)) return;
setLightboxImageInstant(imgElement, loader, photo.display);
}, PHOTO_TRANSITION_MS);
};
newImg.onerror = function () {
if (currentLightboxIndex === photosData.indexOf(photo)) {
loader.style.display = 'none';
}
};
if (transition && imgElement.src) {
loader.style.display = 'none';
} else {
loader.style.display = 'block';
imgElement.style.opacity = '0';
}
newImg.src = photo.display;
}
function updateLightboxContent(photo, options = {}) {
updateLightboxImage(photo, options);
// Sequence counter in header (ordine tour LKH filtrato per zona)
const navOrder = tourNavOrder();
const seqIndex = navOrder.indexOf(photo) + 1;
document.getElementById('lightbox-sequence').textContent =
seqIndex > 0 ? `${seqIndex} / ${navOrder.length}` : `— / ${navOrder.length}`;
document.getElementById('lightbox-image').alt = photoLabel(seqIndex);
const osmEl = document.getElementById('lightbox-osm');
if (osmEl) {
osmEl.href = `https://www.openstreetmap.org/#map=18/${photo.lat}/${photo.lon}`;
osmEl.classList.remove('d-none');
}
const gpsEl = document.getElementById('lightbox-gps');
gpsEl.textContent = `${photo.lat.toFixed(6)}, ${photo.lon.toFixed(6)}`;
const directionEl = document.getElementById('lightbox-direction');
if (photo.direction !== null && photo.direction !== undefined) {
directionEl.textContent = `${Math.round(photo.direction)}°`;
directionEl.classList.remove('d-none');
} else {
directionEl.classList.add('d-none');
}
const cameraEl = document.getElementById('lightbox-camera');
if (photo.camera) {
cameraEl.textContent = photo.camera;
cameraEl.classList.remove('d-none');
} else {
cameraEl.classList.add('d-none');
}
const sfmEl = document.getElementById('lightbox-sfm');
if (sfmEl) {
if (photo.lat_raw != null && photo.lon_raw != null) {
sfmEl.classList.remove('d-none');
} else {
sfmEl.classList.add('d-none');
}
}
updatePanoramaxPreview(photo);
updateSpatialNavUI();
const seqLabel = photoLabel(seqIndex > 0 ? seqIndex : 1);
announce(seqLabel);
updateLightboxMap(photo);
}
function checkZoneChange(prevPhoto, nextPhoto) {
// Se non hanno cluster id, ignora
if (!prevPhoto.cluster_id || !nextPhoto.cluster_id) return;
if (prevPhoto.cluster_id !== nextPhoto.cluster_id) {
showZoneNotification(`Nuova zona ${nextPhoto.cluster_id}`);
}
}
function showZoneNotification(text) {
const container = document.getElementById('zone-notification');
const alert = container.querySelector('.alert');
const textEl = document.getElementById('zone-text');
textEl.textContent = text;
announce(text);
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
const navEntry = spatialNavEntry(photosData.indexOf(photo));
const spatialColors = {
forward: '#22c55e',
back: '#f97316',
left: '#a855f7',
right: '#38bdf8'
};
photosWithGPS.forEach((p) => {
const isCurrentPhoto = p === photo;
const pIndex = photosData.indexOf(p);
if (isCurrentPhoto) {
if (p.direction !== null && p.direction !== undefined) {
const endPoint = destinationPoint(p.lat, p.lon, 30, p.direction);
L.polyline(
[[p.lat, p.lon], [endPoint.lat, endPoint.lon]],
{ color: '#e74c3c', weight: 3, opacity: 0.8 }
).addTo(mapLightbox);
}
L.circleMarker([p.lat, p.lon], {
radius: 12,
fillColor: '#e74c3c',
color: 'white',
weight: 3,
fillOpacity: 1
}).addTo(mapLightbox);
} else {
let fill = clusterColor(p.cluster_id);
let radius = 7;
let weight = 2;
for (const role of ['forward', 'back', 'left', 'right']) {
if (navEntry?.[role] === pIndex) {
fill = spatialColors[role];
radius = 10;
weight = 3;
break;
}
}
L.circleMarker([p.lat, p.lon], {
radius,
fillColor: fill,
color: 'white',
weight,
fillOpacity: 0.95
})
.on('click', () => openLightbox(pIndex))
.addTo(mapLightbox);
}
});
mapLightbox.setView([photo.lat, photo.lon], 18);
}, 100);
}
function closeLightbox() {
stopTourPlay();
clearLightboxImageTransition();
hidePanoramaxPreview();
currentLightboxIndex = -1;
switchView(previousView);
updatePageMeta(null);
history.replaceState(null, '', mapHashCurrent() || window.location.pathname);
updateTourProgress();
}
function navigateLightbox(direction, fromAutoplay = false) {
if (tourPlaying && !fromAutoplay) stopTourPlay();
const navOrder = tourNavOrder();
if (navOrder.length === 0) return;
const currentPhoto = photosData[currentLightboxIndex];
let idx = navOrder.indexOf(currentPhoto);
if (idx === -1) idx = 0;
idx = (idx + direction + navOrder.length) % navOrder.length;
const nextPhoto = navOrder[idx];
const nextIndex = photosData.indexOf(nextPhoto);
openLightbox(nextIndex, direction);
}
// Permalink helper: open lightbox from a file hash string (e.g. #5d1c7f1ef4a17046)
const PHOTO_HASH_RE = /^#[0-9a-f]{10,}$/i;
function openLightboxFromHash(hash) {
if (!hash || !PHOTO_HASH_RE.test(hash)) return false;
const id = hash.slice(1);
const index = photosData.findIndex(p => photoId(p) === id);
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
document.getElementById('welcome-map-btn')?.addEventListener('click', () => {
dismissWelcome();
switchView('map');
});
document.getElementById('welcome-gallery-btn')?.addEventListener('click', () => {
dismissWelcome();
switchView('gallery');
});
document.getElementById('welcome-tour-btn')?.addEventListener('click', () => {
dismissWelcome();
startTourFromWelcome();
});
document.getElementById('welcome-dismiss-btn')?.addEventListener('click', () => dismissWelcome());
document.getElementById('share-photo-btn')?.addEventListener('click', copyPhotoLink);
document.getElementById('tour-play-btn')?.addEventListener('click', startTourPlay);
document.getElementById('tour-pause-btn')?.addEventListener('click', () => stopTourPlay());
document.getElementById('spatial-forward')?.addEventListener('click', () => spatialNavigate('forward'));
document.getElementById('spatial-back')?.addEventListener('click', () => spatialNavigate('back'));
document.getElementById('spatial-left')?.addEventListener('click', () => spatialNavigate('left'));
document.getElementById('spatial-right')?.addEventListener('click', () => spatialNavigate('right'));
document.getElementById('panoramax-thumb-btn')?.addEventListener('click', openPanoramaxZoom);
document.getElementById('panoramax-zoom-close')?.addEventListener('click', closePanoramaxZoom);
document.querySelector('.panoramax-zoom-backdrop')?.addEventListener('click', closePanoramaxZoom);
// Map type buttons
document.querySelectorAll('input[name="mapType"]').forEach(btn => {
btn.addEventListener('change', (e) => {
if (e.target.checked) switchMapType(e.target.dataset.map);
});
});
// Map toggle
const mapContainer = document.getElementById('lightbox-map-container');
const mapToggleBtn = document.getElementById('map-toggle-btn');
mapToggleBtn.innerHTML = mapToggleButtonContent(false);
mapToggleBtn.setAttribute('aria-label', 'Chiudi mappa');
mapToggleBtn.setAttribute('title', 'Chiudi mappa');
function toggleMap(e) {
if (e) e.stopPropagation();
const isMinimized = mapContainer.classList.toggle('minimized');
mapToggleBtn.innerHTML = mapToggleButtonContent(isMinimized);
mapToggleBtn.setAttribute('aria-label', isMinimized ? 'Apri mappa' : 'Chiudi mappa');
mapToggleBtn.setAttribute('title', isMinimized ? 'Apri mappa' : 'Chiudi mappa');
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
mapToggleBtn.innerHTML = mapToggleButtonContent(true);
mapToggleBtn.setAttribute('aria-label', 'Apri mappa');
mapToggleBtn.setAttribute('title', 'Apri mappa');
}
// Keyboard navigation
document.addEventListener('keydown', (e) => {
if (currentView !== 'photo') return;
if (isPanoramaxZoomOpen()) {
if (e.key === 'Escape') closePanoramaxZoom();
return;
}
if (e.key === 'Escape') closeLightbox();
if (e.key === 'ArrowLeft') navigateLightbox(-1);
if (e.key === 'ArrowRight') navigateLightbox(1);
if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
e.preventDefault();
spatialNavigate('forward');
}
if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
e.preventDefault();
spatialNavigate('back');
}
if (e.key === 'a' || e.key === 'A') {
e.preventDefault();
spatialNavigate('left');
}
if (e.key === 'd' || e.key === 'D') {
e.preventDefault();
spatialNavigate('right');
}
if (e.key === 'm' || e.key === 'M') toggleMap();
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
if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
if (deltaX < 0) navigateLightbox(1);
else navigateLightbox(-1);
} else if (Math.abs(deltaY) > 50 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
if (deltaY < 0) spatialNavigate('forward');
else spatialNavigate('back');
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
updateLightboxContent = function (photo, options = {}) {
if (window.resetZoom) window.resetZoom();
originalUpdateLightboxContent(photo, options);
};