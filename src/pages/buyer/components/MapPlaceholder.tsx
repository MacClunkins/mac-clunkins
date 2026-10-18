import type { ComponentType } from 'react';
import { t } from '../i18n-shim';

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
}

/** The only contract a real map (Leaflet, Google, Mapbox) must satisfy. Swap `BuyerMap` below. */
export interface MapViewProps {
  center: { lat: number; lng: number } | null;
  markers?: MapMarker[];
  className?: string;
}

export function MapPlaceholder({ center, markers = [], className = '' }: MapViewProps) {
  return (
    <div
      role="img"
      aria-label={t('buyer.track.mapAlt')}
      className={`flex min-h-48 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-ink/20 bg-mustard/10 p-4 text-center ${className}`}
    >
      <p className="font-heading font-bold">{t('buyer.track.mapTitle')}</p>
      <p className="text-sm text-ink/60">{center ? t('buyer.track.mapLive') : t('buyer.track.mapSoon')}</p>
      {markers.map((m) => (
        <p key={m.label} className="text-xs text-ink/50">
          {m.label}
        </p>
      ))}
    </div>
  );
}

/** OpenStreetMap embed centred on the driver. No API key, no extra dependency. */
export function OsmMap({ center, className = '' }: MapViewProps) {
  if (!center) return <MapPlaceholder center={null} className={className} />;
  const d = 0.015;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${center.lng - d},${center.lat - d},${center.lng + d},${center.lat + d}&layer=mapnik&marker=${center.lat},${center.lng}`;
  return (
    <iframe
      title={t('buyer.track.mapAlt')}
      src={src}
      loading="lazy"
      className={`h-64 w-full rounded-2xl border-0 ${className}`}
    />
  );
}

export const BuyerMap: ComponentType<MapViewProps> = OsmMap;
