import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Image, Platform } from 'react-native';
import MapViewNative, { Marker, Callout } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

// Static marker images — bypasses Android's broken View-to-Bitmap snapshotting
const markerImages = {
  green: require('../assets/markers/ball-green.png'),
  yellow: require('../assets/markers/ball-yellow.png'),
  red: require('../assets/markers/ball-red.png'),
};

const getMarkerImage = (maxFreePercent: number) => {
  if (maxFreePercent === 0) return markerImages.red;
  if (maxFreePercent > 25) return markerImages.green;
  return markerImages.yellow;
};

const GOOGLE_MAPS_API_KEY = "AIzaSyB_AnkpMAjZxw7lu78ZSjfKLpaiilxO0tk";

interface MapViewProps {
  matches?: any[];
  selectedVenue?: string | null;
  selectedMatchId?: string | null;
  onSelectVenue?: (venue: string | null) => void;
}

const parseMapsUrl = (url: string) => {
    if (!url) return null;
    const exactMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (exactMatch) return { location: { lat: parseFloat(exactMatch[1]), lng: parseFloat(exactMatch[2]) } };
    const qCoordMatch = url.match(/(?:\?|&)q=(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/\/search\/(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qCoordMatch) return { location: { lat: parseFloat(qCoordMatch[1]), lng: parseFloat(qCoordMatch[2]) } };
    const coordsMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordsMatch) return { location: { lat: parseFloat(coordsMatch[1]), lng: parseFloat(coordsMatch[2]) } };
    const placeMatch = url.match(/\/place\/([^\/\?]+)/);
    if (placeMatch) return { address: decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')) };
    const qMatch = url.match(/(?:\?|&)q=([^&]+)/);
    if (qMatch && !qMatch[1].match(/^-?\d+\.\d+,-?\d+\.\d+/)) return { address: decodeURIComponent(qMatch[1].replace(/\+/g, ' ')) };
    return null;
};

export default function MapView({ matches = [], selectedVenue, selectedMatchId, onSelectVenue }: MapViewProps) {
  const mapRef = useRef<MapViewNative>(null);
  const [geocodedVenues, setGeocodedVenues] = useState<Record<string, { lat: number, lng: number, address: string, link: string }>>({});
  const [loading, setLoading] = useState(true);

   const uniqueVenues = useMemo(() => {
      const map = new Map<string, { count: number, location_url: string, max_free_percent: number }>();
      matches.forEach(m => {
        if (!map.has(m.venue)) map.set(m.venue, { count: 0, location_url: m.location_url || '', max_free_percent: 0 });
        const vData = map.get(m.venue)!;
        vData.count += 1;
        if (m.location_url && !vData.location_url) vData.location_url = m.location_url;
        
        // Calcular disponibilidad de este partido concreto
        const freeSlots = Math.max(0, (m.max_players || 0) - (m.computed_joined || 0));
        const freePercent = (m.max_players > 0) ? (freeSlots / m.max_players) * 100 : 0;
        
        // Nos quedamos con el "mejor" porcentaje del lugar (el más vacío)
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



  useEffect(() => {
    const geocodeVenues = async () => {
      const unmappedVenues = uniqueVenues.filter(v => !geocodedVenues[v.venue]);
      if (unmappedVenues.length === 0) {
        setLoading(false);
        return;
      }
      
      let newGeocoded = { ...geocodedVenues };
      
      for (const v of unmappedVenues) {
        let locationUrlToParse = v.location_url;
        const parsedUrl = parseMapsUrl(locationUrlToParse);
        
        let apiUrl = '';
        if (parsedUrl?.location) {
          apiUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${parsedUrl.location.lat},${parsedUrl.location.lng}&key=${GOOGLE_MAPS_API_KEY}`;
        } else {
          let addr = parsedUrl?.address ? parsedUrl.address + ', Barcelona, Spain' : (v.venue.toLowerCase().includes('barcelona') ? v.venue : `${v.venue}, Barcelona, Spain`);
          apiUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${GOOGLE_MAPS_API_KEY}`;
        }
        
        try {
           const res = await fetch(apiUrl);
           const data = await res.json();
           if (data.status === 'OK' && data.results && data.results[0]) {
               const loc = data.results[0].geometry.location;
               newGeocoded[v.venue] = {
                   lat: loc.lat,
                   lng: loc.lng,
                   address: data.results[0].formatted_address,
                   link: v.location_url || ''
               };
           } else {
               newGeocoded[v.venue] = {
                   lat: 41.3851 + (Math.random() * 0.02 - 0.01),
                   lng: 2.1734 + (Math.random() * 0.02 - 0.01),
                   address: `${v.venue} (No pudimos localizar la ubicación exacta)`,
                   link: v.location_url || ''
               };
           }
        } catch {
           newGeocoded[v.venue] = {
               lat: 41.3851, lng: 2.1734, address: v.venue, link: v.location_url || ''
           };
        }
      }
      
      setGeocodedVenues(newGeocoded);
      setLoading(false);
    };

    geocodeVenues();
  }, [uniqueVenues]);

  useEffect(() => {
    if (effectiveSelectedVenue && geocodedVenues[effectiveSelectedVenue]) {
      const { lat, lng } = geocodedVenues[effectiveSelectedVenue];
      mapRef.current?.animateToRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01
      }, 1000);
    }
  }, [effectiveSelectedVenue, geocodedVenues]);

  useEffect(() => {
    if (mapRef.current && Object.keys(geocodedVenues).length > 0 && !loading) {
        const coords = Object.values(geocodedVenues).map(loc => ({ latitude: loc.lat, longitude: loc.lng }));
        if (coords.length > 0) {
            // Se le da un timeout pequeño en iOS/Android para asegurar que NativeMaps haya montado la vista
            setTimeout(() => {
                mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
            }, 300);
        }
    }
  }, [geocodedVenues, loading]);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#556080" />
        <Text style={{color: '#64748B', marginTop: 10, fontWeight: '600'}}>Cargando mapa en móvil...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapViewNative
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: 41.3851,
          longitude: 2.1734,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
      >
        {uniqueVenues.map(item => {
           const info = geocodedVenues[item.venue];
           if (!info) return null;
           
           const isSelected = effectiveSelectedVenue === item.venue;
           return (
             <Marker
                key={item.venue}
                coordinate={{ latitude: info.lat, longitude: info.lng }}
                onPress={() => onSelectVenue && onSelectVenue(isSelected ? null : item.venue)}
                zIndex={isSelected ? 10 : 1}
                tracksViewChanges={false}
                image={getMarkerImage(item.max_free_percent)}
             >
                 <Callout tooltip={false}>
                    <View style={styles.callout}>
                       <Text style={styles.calloutTitle}>{item.venue}</Text>
                       <Text style={styles.calloutSub}>📍 {info.address}</Text>
                       <Text style={styles.calloutStats}>⚽ {item.count} partido{item.count !== 1 ? 's' : ''}</Text>
                    </View>
                 </Callout>
              </Marker>
            );
         })}
      </MapViewNative>
      
      {selectedVenue && (
         <View style={styles.resetContainer}>
            <Text style={styles.resetText}>{selectedVenue}</Text>
            <TouchableOpacity onPress={() => onSelectVenue && onSelectVenue(null)}>
               <Text style={styles.clearMapText}>Borrar filtro</Text>
            </TouchableOpacity>
         </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F1F5F9' },
  map: { width: '100%', height: '100%' },
  resetContainer: { position: 'absolute', top: 16, right: 16, left: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.95)', padding: 14, borderRadius: 20, borderWidth: 1, borderColor: '#F1F5F9', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10 },
  resetText: { color: '#0F172A', fontWeight: '800', fontSize: 14, maxWidth: '65%' },
  clearMapText: { color: '#556080', fontWeight: '800', fontSize: 14 },
  callout: { padding: 4, width: 220, backgroundColor: '#FFF', borderRadius: 12 },
  calloutTitle: { fontWeight: '800', fontSize: 14, marginBottom: 2, color: '#0F172A' },
  calloutSub: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  calloutStats: { fontSize: 12, color: '#556080', marginTop: 4, fontWeight: '700' }
});


