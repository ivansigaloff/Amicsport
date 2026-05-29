import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { GoogleMap, useJsApiLoader, InfoWindow, OverlayView } from '@react-google-maps/api';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";

// Persist geocoded venue coordinates so we don't re-hit the Google Geocoder API
// on every mount (it was sequential at 400ms/venue and lost on navigation).
const GEOCODE_CACHE_KEY = 'amicsport_geocode_v1';
type GeoEntry = { lat: number; lng: number; address: string; link: string; approx?: boolean };

const loadGeocodeCache = (): Record<string, GeoEntry> => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(GEOCODE_CACHE_KEY);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return {};
};

interface MapViewProps {
  matches: any[];
  selectedVenue: string | null;
  selectedMatchId?: string | null;
  onSelectVenue: (venue: string | null) => void;
}

const mapContainerStyle = {
  width: '100%',
  height: '100%'
};

const center = {
  lat: 41.3851,
  lng: 2.1734 // Plaza Catalunya
};

export default function MapView({ matches, selectedVenue, selectedMatchId, onSelectVenue }: MapViewProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: ['places'] as any
  });

  // Lazy-init from the persisted cache so previously geocoded venues render instantly.
  const [geocodedVenues, setGeocodedVenues] = useState<Record<string, GeoEntry>>(loadGeocodeCache);
  const geocoderRef = useRef<any>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);

  // Persist successful geocodes (skip the random "approx" fallbacks so they retry next time).
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const persistable = Object.fromEntries(
          Object.entries(geocodedVenues).filter(([, v]) => !v.approx)
        );
        if (Object.keys(persistable).length > 0) {
          window.localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(persistable));
        }
      }
    } catch {}
  }, [geocodedVenues]);

  const uniqueVenues = useMemo(() => {
     const map = new Map<string, { count: number, location_url: string, max_free_percent: number }>();
     matches.forEach(m => {
       if (!map.has(m.venue)) map.set(m.venue, { count: 0, location_url: m.location_url || '', max_free_percent: 0 });
       const vData = map.get(m.venue)!;
       vData.count += 1;
       if (m.location_url && !vData.location_url) vData.location_url = m.location_url;
       
       // Calcular disponibilidad (mismo criterio que nativo)
       const freeSlots = Math.max(0, (m.max_players || 0) - (m.computed_joined || 0));
       const freePercent = (m.max_players > 0) ? (freeSlots / m.max_players) * 100 : 0;
       
       if (freePercent > vData.max_free_percent) {
          vData.max_free_percent = freePercent;
       }
     });
     return Array.from(map.entries()).map(([venue, data]) => ({ venue, count: data.count, location_url: data.location_url, max_free_percent: data.max_free_percent }));
  }, [matches]);

  const effectiveSelectedVenue = useMemo(() => {
    if (selectedMatchId) {
      const match = matches.find(m => m.id === selectedMatchId);
      if (match) return match.venue;
    }
    return selectedVenue;
  }, [selectedMatchId, selectedVenue, matches]);

  const getMarkerColor = (percent: number) => {
    if (percent === 0) return '#C05E5E'; // Rojo (0 plazas)
    if (percent > 25) return '#5FAD80';  // Verde (>25% libre)
    return '#D4C480'; // Amarillo (1-25% libre)
  };

  useEffect(() => {
    if (mapInstance && Object.keys(geocodedVenues).length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      let hasPoints = false;
      Object.values(geocodedVenues).forEach(loc => {
        if (!isNaN(loc.lat) && !isNaN(loc.lng)) {
          bounds.extend({ lat: loc.lat, lng: loc.lng });
          hasPoints = true;
        }
      });
      if (hasPoints) {
        mapInstance.fitBounds(bounds);
        // Evitaremos un zoom exagerado si hay un solo venue
        const listener = window.google.maps.event.addListener(mapInstance, "idle", () => { 
           if (mapInstance.getZoom() > 15) mapInstance.setZoom(15); 
           window.google.maps.event.removeListener(listener); 
        });
      }
    }
  }, [geocodedVenues, mapInstance]);

  const parseMapsUrl = (url: string) => {
    if (!url) return null;
    
    // 1. Exact marker coordinates (!3d and !4d)
    const exactMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (exactMatch) return { location: { lat: parseFloat(exactMatch[1]), lng: parseFloat(exactMatch[2]) } };

    // 2. Query coordinates
    const qCoordMatch = url.match(/(?:\?|&)q=(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/\/search\/(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qCoordMatch) return { location: { lat: parseFloat(qCoordMatch[1]), lng: parseFloat(qCoordMatch[2]) } };
    
    // 3. Viewport center as fallback
    const coordsMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordsMatch) return { location: { lat: parseFloat(coordsMatch[1]), lng: parseFloat(coordsMatch[2]) } };
    
    // 4. Place name
    const placeMatch = url.match(/\/place\/([^\/\?]+)/);
    if (placeMatch) return { address: decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')) };
    
    // 5. Query text
    const qMatch = url.match(/(?:\?|&)q=([^&]+)/);
    if (qMatch && !qMatch[1].match(/^-?\d+\.\d+,-?\d+\.\d+/)) return { address: decodeURIComponent(qMatch[1].replace(/\+/g, ' ')) };
    
    return null;
  };

  useEffect(() => {
    if (!isLoaded || typeof window === 'undefined' || !window.google) return;
    if (!geocoderRef.current) {
      geocoderRef.current = new window.google.maps.Geocoder();
    }

    const unmappedVenues = uniqueVenues.filter(v => !geocodedVenues[v.venue]);
    if (unmappedVenues.length === 0) return;

    unmappedVenues.forEach((v, i) => {
      setTimeout(() => {
          let locationUrlToParse = v.location_url;
          
          const processGeocode = (url: string) => {
              const parsedUrl = parseMapsUrl(url);
              let geocodeRequest: any = {};
              
              if (parsedUrl?.location) {
                 geocodeRequest = { location: parsedUrl.location };
              } else if (parsedUrl?.address) {
                 geocodeRequest = { address: parsedUrl.address + ', Barcelona, Spain' };
              } else {
                 geocodeRequest = { address: v.venue.toLowerCase().includes('barcelona') ? v.venue : `${v.venue}, Barcelona, Spain` };
              }
              
              geocoderRef.current?.geocode(geocodeRequest, (results: any, status: string) => {
                  if (status === 'OK' && results && results[0]) {
                      setGeocodedVenues(prev => ({
                          ...prev,
                          [v.venue]: {
                              lat: results[0].geometry.location.lat(),
                              lng: results[0].geometry.location.lng(),
                              address: results[0].formatted_address,
                              link: v.location_url || ''
                          }
                      }));
                  } else {
                      // Fallback: If Geocoder fails completely (generic venue + short URL), place marker near center.
                      // Marked approx so it is NOT persisted — it will be retried on the next mount.
                      setGeocodedVenues(prev => ({
                          ...prev,
                          [v.venue]: {
                              lat: center.lat + (Math.random() * 0.02 - 0.01),
                              lng: center.lng + (Math.random() * 0.02 - 0.01),
                              address: `${v.venue} (No pudimos extraer ubicación exacta del link)`,
                              link: v.location_url || '',
                              approx: true
                          }
                      }));
                  }
              });
          };

          processGeocode(locationUrlToParse);
      }, i * 400); // 400ms throttle para evitar límites
    });
  }, [uniqueVenues, isLoaded]);

  useEffect(() => {
    if (mapInstance && effectiveSelectedVenue && geocodedVenues[effectiveSelectedVenue]) {
      const { lat, lng } = geocodedVenues[effectiveSelectedVenue];
      mapInstance.panTo({ lat, lng });
      if (mapInstance.getZoom() < 14) mapInstance.setZoom(15);
    }
  }, [effectiveSelectedVenue, geocodedVenues, mapInstance]);

  if (loadError) {
    return (
      <View style={styles.container}>
        <Text style={{color: 'red', textAlign: 'center'}}>Error al cargar Google Maps API</Text>
      </View>
    );
  }

  if (!isLoaded) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#556080" />
        <Text style={{color: '#64748B', marginTop: 10, fontWeight: '600'}}>Cargando mapa interactivo...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={13}
        onLoad={setMapInstance}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          styles: [
            {
              "featureType": "landscape",
              "elementType": "geometry",
              "stylers": [{ "color": "#f5f5f5" }]
            },
            {
              "featureType": "water",
              "elementType": "geometry",
              "stylers": [{ "color": "#e9e9e9" }]
            }
          ]
        }}
      >
        {uniqueVenues.map(item => {
           const info = geocodedVenues[item.venue];
           if (!info) return null;
           
           const isSelected = effectiveSelectedVenue === item.venue;
           return (
             <React.Fragment key={item.venue}>
                <OverlayView
                 position={{lat: info.lat, lng: info.lng}}
                 mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                 getPixelPositionOffset={() => ({ x: -25, y: -25 })}
               >
                  <div 
                    onClick={() => onSelectVenue(isSelected ? null : item.venue)}
                    style={{
                      width: '50px',
                      height: '50px',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: item.max_free_percent === 0 
                        ? '#EF4444' 
                        : (item.max_free_percent > 25 ? '#10B981' : '#F59E0B'),
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      transition: 'transform 0.2s',
                      transform: isSelected ? 'scale(1.2)' : 'scale(1)',
                      boxShadow: isSelected ? '0 8px 24px rgba(85, 96, 128, 0.4)' : '0 4px 12px rgba(0,0,0,0.15)',
                      fontSize: '20px',
                      lineHeight: '1',
                      border: isSelected ? '3px solid #556080' : '2px solid white',
                    }}>
                      ⚽
                    </div>
                  </div>
                </OverlayView>

               {isSelected && (
                 <InfoWindow position={{lat: info.lat, lng: info.lng}} onCloseClick={() => onSelectVenue(null)}>
                   <div style={{ padding: 4, color: '#333' }}>
                     <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 2 }}>{item.venue}</div>
                     <div style={{ fontSize: 11, color: '#555' }}>📍 {info.address}</div>
                     <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>⚽ {item.count} partido{item.count !== 1 ? 's' : ''}</div>
                   </div>
                 </InfoWindow>
               )}
             </React.Fragment>
           );
        })}
      </GoogleMap>
      
      {selectedVenue && (
        <View style={styles.resetContainer}>
            <Text style={styles.resetText}>{selectedVenue}</Text>
            <TouchableOpacity onPress={() => onSelectVenue(null)}>
              <Text style={styles.clearMapText}>Borrar filtro</Text>
            </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  resetContainer: {
    position: 'absolute',
    top: 16,
    right: 16,
    left: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8
  },
  resetText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14,
    maxWidth: '65%'
  },
  clearMapText: {
    color: '#556080',
    fontWeight: '800',
    fontSize: 14
  }
});
