// Place card on the Earth page, shown when a city or place is searched: photo, names, region,
// live weather and local time, actions (directions, save, nearby, share), quick facts and famous
// sights with photos. Sources: OpenStreetMap, Wikipedia/Wikidata, Wikimedia Commons, Open-Meteo.
import { useEffect, useState } from 'react';
import Icon from './Icon';
import { fetchPlaceInfo, fetchWikiByName, localTime } from '../globe/placeInfo';
import { describeWeather, fetchWeather } from '../globe/exploreSearch';
import { fetchPlacePhotos, searchKey, thumbUrl } from '../globe/placePhotos';

const radiusFor = (kind, row) => (row.bounds ? Math.min(25, Math.max(4, (row.bounds.north - row.bounds.south) * 55)) : /city|town/i.test(kind || '') ? 15 : 3);

export default function EarthPlaceCard({ row, online, uid, onClose, onDirections, onSave, onNearby, onOpenPhoto }) {
  const [info, setInfo] = useState(null);
  const [wikiFast, setWikiFast] = useState(null);
  const [weather, setWeather] = useState(null);
  const [sights, setSights] = useState(null);
  const [factsOpen, setFactsOpen] = useState(false);
  const [shared, setShared] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setWikiFast(null);
    setWeather(null);
    setSights(null);
    setFactsOpen(false);
    setSaved(false);
    // fast: Wikipedia by name (checked against the coordinates); slower: OpenStreetMap details
    fetchWikiByName(row).then((w) => live && w && setWikiFast(w));
    fetchPlaceInfo(row)
      .then((i) => live && setInfo(i))
      .catch(() => live && setInfo({ name: (row.name || '').split(',')[0], lat: row.lat, lng: row.lng }));
    if (online) {
      fetchWeather(row.lat, row.lng)
        .then((w) => live && setWeather(w))
        .catch(() => {});
      const q = searchKey(row.lat, row.lng, radiusFor(row.type, row));
      fetchPlacePhotos(q)
        .then((list) => live && setSights(list.filter((p) => p.title !== (row.name || '').split(',')[0]).slice(0, 10)))
        .catch(() => live && setSights([]));
    }
    return () => {
      live = false;
    };
  }, [row, online]);

  const name = info?.name || (row.name || '').split(',')[0];
  // until the details arrive: the region from the search result itself
  const rowSub = (row.address || row.name || '').split(',').map((x) => x.trim()).filter((x) => x && x !== name && !/^\d/.test(x)).slice(-2).join(', ');
  const sub = info ? [info.region, info.country].filter(Boolean).join(', ') : rowSub;
  const wiki = info?.wiki || wikiFast;
  const wx = weather ? describeWeather(weather.code, weather.isDay) : null;
  const photo = wiki?.photo;

  const share = async () => {
    const url = `https://www.openstreetmap.org/?mlat=${row.lat.toFixed(5)}&mlon=${row.lng.toFixed(5)}#map=14/${row.lat.toFixed(5)}/${row.lng.toFixed(5)}`;
    const text = `${name}${sub ? `, ${sub}` : ''} (${row.lat.toFixed(5)}, ${row.lng.toFixed(5)})`;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShared('Link copied');
    } catch {
      setShared('');
    }
    setTimeout(() => setShared(''), 2500);
  };

  return (
    <section className="ex-card ex-placecard" aria-label={name}>
      <div className={`ex-pc-photo ${photo ? '' : 'none'}`}>
        {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : <Icon name="pin" size={34} />}
        <button type="button" className="ex-pc-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="ex-pc-head">
        <div className="ex-pc-title">
          <h2>{name}</h2>
          {info?.localName && <div className="ex-pc-local">{info.localName}</div>}
          <div className="ex-pc-sub">{[info?.kind || row.type, sub].filter(Boolean).join(' · ')}</div>
        </div>
        {wx && (
          <div className="ex-pc-wx" title="Weather now (Open-Meteo)">
            <Icon name={wx.icon} size={28} />
            <span>
              {wx.text} · {Math.round(weather.temp)}°C
            </span>
            {weather.utcOffset != null && <span>{localTime(weather.utcOffset)}</span>}
          </div>
        )}
      </div>

      <div className="ex-pc-actions">
        <button type="button" className="primary" onClick={() => onDirections({ name, lat: row.lat, lng: row.lng })}>
          <span>
            <Icon name="navigation" size={20} />
          </span>
          Directions
        </button>
        <button
          type="button"
          onClick={async () => {
            if (await onSave({ name, lat: row.lat, lng: row.lng })) setSaved(true);
          }}
          aria-pressed={saved}
        >
          <span>
            <Icon name={saved ? 'check' : 'pin'} size={20} />
          </span>
          {saved ? 'Saved' : uid ? 'Save' : 'Save'}
        </button>
        <button type="button" onClick={() => onNearby({ lat: row.lat, lng: row.lng })}>
          <span>
            <Icon name="crosshair" size={20} />
          </span>
          Nearby
        </button>
        <button type="button" onClick={share}>
          <span>
            <Icon name="external" size={20} />
          </span>
          {shared || 'Share'}
        </button>
      </div>

      {wiki?.extract && (
        <div className="ex-pc-section">
          <h3>Quick facts</h3>
          <p className={factsOpen ? 'open' : ''}>{wiki.extract}</p>
          <div className="ex-pc-links">
            {wiki.extract.length > 180 && (
              <button type="button" onClick={() => setFactsOpen((o) => !o)}>
                {factsOpen ? 'Less' : 'More'}
              </button>
            )}
            {wiki.url && (
              <a href={wiki.url} target="_blank" rel="noopener noreferrer">
                Wikipedia <Icon name="external" size={12} />
              </a>
            )}
          </div>
        </div>
      )}
      {!wiki && !info && online && <div className="ex-skeleton" />}

      {online && (sights == null || sights.length > 0) && (
        <div className="ex-pc-section">
          <h3>Things to see</h3>
          {sights == null ? (
            <div className="ex-skeleton" />
          ) : (
            <ul className="ex-pc-sights">
              {sights.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpenPhoto(p)} title={p.description || p.title}>
                    <img src={thumbUrl(p.file, 330)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    <span>{p.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!online && <p className="ex-note">Photos, facts and weather need an internet connection.</p>}
      <p className="ex-credit">
        {[
          'Place: © OpenStreetMap contributors',
          wiki ? 'facts and photo: Wikipedia' : null,
          sights?.length ? 'sights: Wikidata, Wikimedia Commons' : null,
          weather ? 'weather: Open-Meteo' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </section>
  );
}
