// Photos layer UI for the Earth view: the strip of famous places in view, and the gallery of
// one place (all its photos in a grid, each opening full size).
// Photos come from Wikimedia Commons; each shows its own author and licence (required by the
// free licences) and links to its Commons page. Online only.
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { fetchPlaceGallery, filePageUrl, thumbUrl } from '../globe/placePhotos';

const MESSAGES = {
  offline: 'Photos need an internet connection. They are not stored for offline use.',
  loading: 'Finding photos of famous places…',
};
const STRIP_MAX = 40;

export function PhotoStrip({ photos, state, selectedId, onOpen, onRetry, onClose }) {
  const [collapsed, setCollapsed] = useState(false);
  const showList = state.status === 'ready' || (state.status === 'loading' && photos.length > 0);
  const shown = photos.slice(0, STRIP_MAX);
  return (
    <section className={`earth-photos ${collapsed ? 'collapsed' : ''}`} aria-label="Photos of famous places in view">
      <header>
        <Icon name="photo" size={16} />
        <strong>Photos</strong>
        <span className="earth-photos-sub">
          {state.status === 'ready'
            ? photos.length > STRIP_MAX
              ? `The ${STRIP_MAX} most famous places in view`
              : `${photos.length} famous place${photos.length === 1 ? '' : 's'} in view`
            : state.status === 'loading'
              ? 'Searching…'
              : ''}
        </span>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={collapsed ? 'Show the photo list' : 'Hide the photo list'} title={collapsed ? 'Show list' : 'Hide list'}>
          <Icon name="chevronDown" size={18} className={collapsed ? 'flip' : ''} />
        </button>
        <button type="button" onClick={onClose} aria-label="Turn photos off" title="Turn photos off">
          <Icon name="close" size={16} />
        </button>
      </header>
      {!collapsed && (
        <>
          {showList && shown.length > 0 && (
            <ul className="earth-photos-list">
              {shown.map((p) => (
                <li key={p.id}>
                  <button type="button" className={p.id === selectedId ? 'on' : ''} onClick={() => onOpen(p)} title={p.description || p.title}>
                    <img src={thumbUrl(p.file, 330)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    <span>{p.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.status === 'ready' && photos.length === 0 && <p className="earth-photos-msg">No photos of well-known places here. Try zooming out a little.</p>}
          {MESSAGES[state.status] && !(showList && photos.length) && <p className="earth-photos-msg">{MESSAGES[state.status]}</p>}
          {state.status === 'error' && (
            <p className="earth-photos-msg">
              Photos could not be loaded ({state.message}).{' '}
              <button type="button" className="link-btn" onClick={onRetry}>
                Try again
              </button>
            </p>
          )}
          <p className="earth-photos-credit">Places: Wikidata · Photos: Wikimedia Commons contributors (online only)</p>
        </>
      )}
    </section>
  );
}

function Credit({ img }) {
  return (
    <>
      Photo: {img.author}
      {img.date && ` · ${img.date}`}
      {img.licence && (
        <>
          {' · '}
          {img.licenceUrl ? (
            <a href={img.licenceUrl} target="_blank" rel="noopener noreferrer">
              {img.licence}
            </a>
          ) : (
            img.licence
          )}
        </>
      )}
      {' · Wikimedia Commons'}
    </>
  );
}

/** One photo full size, with its credit; arrows / arrow keys step through the gallery. */
function Lightbox({ images, index, title, onIndex, onClose }) {
  const img = images[index];
  // Commons thumbnail URLs end in /<width>px-<name>: ask for a large one (falls back to the grid size)
  const large = /\/\d+px-[^/]+$/.test(img.thumb) ? img.thumb.replace(/\/\d+px-([^/]+)$/, '/1280px-$1') : img.thumb;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation(); // close only the photo, not the gallery
        onClose();
      } else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [index, images.length, onIndex, onClose]);
  return (
    <div className="earth-lightbox" role="dialog" aria-modal="true" aria-label={`${title}: photo ${index + 1} of ${images.length}`}>
      <div className="earth-lightbox-top">
        <button type="button" onClick={onClose} aria-label="Back to the gallery">
          <Icon name="close" size={22} />
        </button>
        <span>
          {title} · {index + 1} / {images.length}
        </span>
      </div>
      <div className="earth-lightbox-frame" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <img
          key={img.file}
          src={large}
          alt={`${title} - photo ${index + 1}`}
          referrerPolicy="no-referrer"
          onError={(e) => {
            if (e.currentTarget.src !== img.thumb) e.currentTarget.src = img.thumb;
          }}
        />
        {index > 0 && (
          <button type="button" className="earth-photo-nav prev" onClick={() => onIndex(index - 1)} aria-label="Previous photo">
            <Icon name="chevron" size={26} />
          </button>
        )}
        {index < images.length - 1 && (
          <button type="button" className="earth-photo-nav next" onClick={() => onIndex(index + 1)} aria-label="Next photo">
            <Icon name="chevron" size={26} />
          </button>
        )}
      </div>
      <p className="earth-lightbox-credit">
        <Credit img={img} />
        {' · '}
        <a href={img.page || filePageUrl(img.file)} target="_blank" rel="noopener noreferrer">
          Photo page
        </a>
      </p>
    </div>
  );
}

/**
 * Gallery screen for one place: back arrow, name, number of photos, and the photos in rows of
 * equal height (each keeps its shape). Click a photo to see it full size.
 */
export default function PhotoGallery({ place, onClose, onFly }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(null);
  const [open, setOpen] = useState(null); // index of the photo shown full size
  const [attempt, setAttempt] = useState(0);
  const backRef = useRef(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(null);
    setOpen(null);
    fetchPlaceGallery(place)
      .then((d) => live && setData(d))
      .catch((err) => live && setFailed(err.message || 'The photos could not be loaded.'));
    return () => {
      live = false;
    };
  }, [place, attempt]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    backRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const images = data?.images || [];
  return (
    <div className="earth-gallery" role="dialog" aria-modal="true" aria-labelledby="earth-gallery-title">
      <header className="earth-gallery-head">
        <button type="button" ref={backRef} className="earth-gallery-back" onClick={onClose} aria-label="Back to the Earth">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M20 12H5m6-7-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="earth-gallery-title">
          <h2 id="earth-gallery-title">{place.title}</h2>
          <span>{data ? `${images.length} image${images.length === 1 ? '' : 's'}` : failed ? 'Photos unavailable' : 'Loading photos…'}</span>
        </div>
        <div className="earth-gallery-actions">
          {data?.article && (
            <a href={data.article} target="_blank" rel="noopener noreferrer">
              Wikipedia <Icon name="external" size={14} />
            </a>
          )}
          <button type="button" onClick={() => onFly(place)}>
            <Icon name="pin" size={16} /> Fly there
          </button>
        </div>
      </header>

      <div className="earth-gallery-body">
        {place.description && <p className="earth-gallery-desc">{place.description}</p>}
        {!data && !failed && (
          <div className="earth-gallery-grid" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="earth-gallery-item skeleton" style={{ flexGrow: 150, flexBasis: '330px' }}>
                <i style={{ paddingBottom: '66%' }} />
              </div>
            ))}
          </div>
        )}
        {failed && (
          <p className="earth-gallery-msg">
            Photos could not be loaded ({failed}).{' '}
            <button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </p>
        )}
        {data && images.length === 0 && <p className="earth-gallery-msg">Wikimedia Commons has no photos for this place yet.</p>}
        {images.length > 0 && (
          <div className="earth-gallery-grid">
            {images.map((img, i) => {
              const ratio = img.width && img.height ? Math.min(Math.max(img.width / img.height, 0.5), 2.6) : 1.5;
              return (
                <button
                  key={img.file}
                  type="button"
                  className="earth-gallery-item"
                  style={{ flexGrow: ratio * 100, flexBasis: `${ratio * 230}px` }}
                  onClick={() => setOpen(i)}
                  aria-label={`Photo ${i + 1} of ${images.length}`}
                  title={`Photo: ${img.author}`}
                >
                  <i style={{ paddingBottom: `${100 / ratio}%` }} />
                  <img src={img.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                </button>
              );
            })}
            <span className="earth-gallery-filler" />
          </div>
        )}
        <p className="earth-gallery-credit">
          Photos by Wikimedia Commons contributors - open a photo to see its author and licence.
          {data?.category && (
            <>
              {' '}
              <a href={`https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(data.category.replace(/ /g, '_'))}`} target="_blank" rel="noopener noreferrer">
                More photos on Wikimedia Commons
              </a>
            </>
          )}
        </p>
      </div>

      {open != null && images[open] && <Lightbox images={images} index={open} title={place.title} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
