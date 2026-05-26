import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal, FlatList, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useJsApiLoader } from '@react-google-maps/api';
import { Image } from 'expo-image';
import { useEnv } from '../../hooks/use-env';
import { parseMatchDate, toISODate } from '../../lib/date';

type SavedLocation = { id?: number; name: string; location_url: string; image_url?: string };

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";

const isMatchInPast = (dateISO: string, timeStr: string) => {
  if (!dateISO || !timeStr) return false;
  const now = new Date();
  let bcnDate;
  try {
     const bcnStr = now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' });
     bcnDate = new Date(bcnStr);
  } catch (e) {
     bcnDate = now;
  }
  const [year, month, day] = dateISO.split('-').map(Number);
  const [h, m] = timeStr.split(':').map(Number);
  const matchDate = new Date(year, month - 1, day, h, m, 0);
  return matchDate < bcnDate;
};

// Helper local para generar próximas fechas
const generateUpcomingDays = () => {
  const days = [];
  const options = { weekday: 'short', day: 'numeric', month: 'short' } as const;
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d.toLocaleDateString('es-ES', options));
  }
  return days;
};

const generateTimes = () => {
  const times = [];
  for (let h = 8; h <= 23; h++) {
    times.push(`${h.toString().padStart(2, '0')}:00`);
    times.push(`${h.toString().padStart(2, '0')}:30`);
  }
  return times;
};

export default function CreateMatchScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId: string }>();
  const { fromTable, env } = useEnv();
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [venueImageUrl, setVenueImageUrl] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [showFormatModal, setShowFormatModal] = useState(false);
  
  const [price, setPrice] = useState('5.00');
  const [maxPlayers, setMaxPlayers] = useState('14');
  const [distance, setDistance] = useState(''); // Will be used to store game format (5v5 etc.)
  const [level, setLevel] = useState('Nivel Amateur/Medio');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [loadingSaveLocation, setLoadingSaveLocation] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusColor, setStatusColor] = useState('#64748B');

  // New Category Flags
  const [isFemale, setIsFemale] = useState(false);
  const [isMixed, setIsMixed] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [cancellationHours, setCancellationHours] = useState('12');
  const [requiresPayment, setRequiresPayment] = useState(false);
  const [paymentDeadlineHours, setPaymentDeadlineHours] = useState('24');

  // Function to fetch saved locations
  const fetchLocations = async () => {
    setLoadingLocations(true);
    const { data, error } = await supabase.from(fromTable('saved_locations')).select('*');
    if (!error && data) setSavedLocations(data as SavedLocation[]);
    setLoadingLocations(false);
  };

  useEffect(() => {
    // Fetch saved locations on mount
    fetchLocations();
  }, [env]);

  useEffect(() => {
    if (editId) {
      const fetchMatch = async () => {
        setLoading(true);
        const { data } = await supabase.from(fromTable('matches')).select('*').eq('id', editId).single();
        if (data) {
          setTitle(data.title);
          setVenue(data.venue);
          setDate(data.date);
          setTime(data.time);
          setPrice(data.price.toString());
          setMaxPlayers(data.max_players.toString());
          setDistance(data.distance || ''); // Using distance for format
          setLevel(data.level);
          setLocationUrl(data.location_url || '');
          setVenueImageUrl(data.image_url || '');
          setIsFemale(data.is_female || false);
          setIsMixed(data.is_mixed || false);
          setIsPrivate(data.is_private || false);
          setIsAdvanced(data.is_advanced || false);
          setRequiresPayment(data.requires_payment || false);
          if (data.payment_deadline_hours) setPaymentDeadlineHours(String(data.payment_deadline_hours));
        }
        setLoading(false);
      };
      fetchMatch();
    }
  }, [editId, env]);

  // Auto-fill Google Maps link when venue changes and locationUrl is empty
  useEffect(() => {
    if (venue && !locationUrl) {
      const link = `https://www.google.com/maps/search/${encodeURIComponent(venue)}`;
      setLocationUrl(link);
    }
  }, [venue]);

  const { isLoaded: isMapsLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: ['places'] as any
  });

  const fetchVenuePhoto = async (venueName: string, url?: string): Promise<string | null> => {
    try {
      let searchQuery = venueName;

      // Extract a better search query from the Google Maps URL if available
      if (url) {
        const placeMatch = url.match(/\/place\/([^\/\?]+)/);
        if (placeMatch) searchQuery = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
        else {
          const qMatch = url.match(/[?&]q=([^&]+)/);
          if (qMatch) searchQuery = decodeURIComponent(qMatch[1].replace(/\+/g, ' '));
        }
      }

      setStatusMsg(`Buscando: "${searchQuery}"...`);

      // 1. Try modern Places API V1 (Supports CORS & Persistent URLs)
      try {
        const v1Res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'places.photos,places.id'
          },
          body: JSON.stringify({ textQuery: searchQuery })
        });
        
        if (v1Res.status === 403) {
          setStatusMsg('Error 403: La API "Places API (New)" no está habilitada en tu consola de Google.');
          setStatusColor('#EF4444');
        }

        const v1Data = await v1Res.json();
        if (v1Data.places?.[0]?.photos?.[0]) {
          const photoName = v1Data.places[0].photos[0].name;
          const publicUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${GOOGLE_MAPS_API_KEY}`;
          console.log('Foto encontrada vía V1:', publicUrl);
          return publicUrl;
        } else {
          console.log('V1 no encontró fotos, probando fallback SDK...');
        }
      } catch (e1) {
        console.log('Error en V1:', e1);
      }

      // 2. Fallback to JS SDK (No CORS, but session URLs)
      if (Platform.OS === 'web') {
        if (!isMapsLoaded) return null;
        const google = (window as any).google;
        const service = new google.maps.places.PlacesService(document.createElement('div'));

        return new Promise((resolve) => {
          service.findPlaceFromQuery(
            { query: searchQuery, fields: ['photos'] },
            (results: any, status: any) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && results?.[0]?.photos?.[0]) {
                const sessionUrl = results[0].photos[0].getUrl({ maxWidth: 800 });
                
                // CRITICAL HACK: Extract photo_reference from session URL to build a PERSISTENT link
                // The reference is usually between "1s" and the next "&"
                const refMatch = sessionUrl.match(/[?&]1s([^&]+)/);
                if (refMatch) {
                  const photoRef = refMatch[1];
                  const persistentUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
                  console.log('Foto extraída del SDK:', persistentUrl);
                  resolve(persistentUrl);
                } else {
                  // Fallback to session URL if extraction fails
                  resolve(sessionUrl);
                }
              } else {
                resolve(null);
              }
            }
          );
        });
      } else {
        // Mobile fallback
        const apiUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(searchQuery)}&inputtype=textquery&fields=photos&key=${GOOGLE_MAPS_API_KEY}`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        if (data.status === 'OK' && data.candidates?.[0]?.photos?.[0]) {
          const photoRef = data.candidates[0].photos[0].photo_reference;
          return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
        }
      }
    } catch (e: any) {
      console.error('Error fetching venue photo:', e);
    }
    return null;
  };

  // Update photo preview in real-time when locationUrl changes
  useEffect(() => {
    const updatePhoto = async () => {
      // Reconocer tanto enlaces largos como cortos (goo.gl, maps.app.goo.gl)
      if (locationUrl && (locationUrl.includes('google.com/maps') || locationUrl.includes('goo.gl'))) {
        const photo = await fetchVenuePhoto(venue, locationUrl);
        if (photo) setVenueImageUrl(photo);
      } else if (venue && !locationUrl) {
        // Si hay nombre pero no link, probar suerte con el nombre
        const photo = await fetchVenuePhoto(venue);
        if (photo) setVenueImageUrl(photo);
      }
    };
    updatePhoto();
  }, [locationUrl, venue]);

  const handleSaveLocation = async () => {
    if (!venue) return Alert.alert('Aviso', 'Introduce un nombre de ubicación antes de guardar.');
    setLoadingSaveLocation(true);
    setStatusMsg('Buscando foto en Google Maps...');
    setStatusColor('#FFB81C');
    
    try {
      // Fetch photo URL from Google (prioritizing the link)
      setStatusMsg('Paso 1: Buscando foto en Google...');
      const photoUrl = await fetchVenuePhoto(venue, locationUrl);
      
      setStatusMsg(`Paso 2: Google devolvió: ${photoUrl ? photoUrl.substring(0, 60) + '...' : 'NADA (null)'}`);
      setStatusColor(photoUrl ? '#10B981' : '#F59E0B');
      
      // Check if venue already exists to preserve existing photo if the new one is null
      const { data: existing } = await supabase.from(fromTable('saved_locations')).select('image_url').eq('name', venue).single();
      const finalPhotoUrl = photoUrl || (existing ? existing.image_url : null);
      
      setStatusMsg(`Paso 3: URL final a guardar: ${finalPhotoUrl ? finalPhotoUrl.substring(0, 60) + '...' : 'NINGUNA'}`);
      
      const link = locationUrl || `https://www.google.com/maps/search/${encodeURIComponent(venue)}`;
      const dataToSave = { 
        name: venue, 
        location_url: link,
        image_url: finalPhotoUrl 
      };
      console.log('Datos enviados a Supabase:', JSON.stringify(dataToSave));
      
      const { error, data: upsertResult } = await supabase.from(fromTable('saved_locations')).upsert(dataToSave, { onConflict: 'name' }).select();
      
      if (error) {
        setStatusMsg(`Error al guardar: ${error.message}`);
        setStatusColor('#EF4444');
      } else {
        if (finalPhotoUrl) setVenueImageUrl(finalPhotoUrl);
        await fetchLocations();
        const savedImgUrl = upsertResult?.[0]?.image_url;
        setStatusMsg(`✅ Guardado OK. image_url en DB: ${savedImgUrl ? savedImgUrl.substring(0, 50) + '...' : 'VACÍO'}`);
        setStatusColor(savedImgUrl ? '#10B981' : '#F59E0B');
      }
    } catch (err: any) {
      setStatusMsg(`Error inesperado: ${err.message || 'Desconocido'}`);
      setStatusColor('#EF4444');
    } finally {
      setLoadingSaveLocation(false);
    }
  };

  const UPCOMING_DAYS = generateUpcomingDays();
  const TIMES = generateTimes();
  const FORMATS = ['5v5', '6v6', '7v7', '8v8', '9v9', '10v10', '11v11'];

  const handleCreate = async () => {
    setFormError('');
    // Make title optional but require format (distance)
    if (!venue || !date || !time || !distance) {
      setFormError('Faltan campos obligatorios (localidad, fecha, hora o formato).');
      return Alert.alert('Aviso', 'Por favor, rellena todos los campos marcados con *');
    }

    const matchDateObj = parseMatchDate(date);
    const dateISO = toISODate(matchDateObj);
    if (dateISO && isMatchInPast(dateISO, time)) {
      setFormError('No se puede guardar un partido en el pasado.');
      return Alert.alert('Aviso', 'La fecha y hora especificadas ya han pasado.');
    }
    
    setLoading(true);
    
    // Debug: Check session more reliably
    const { data: sessionData } = await supabase.auth.getSession();
    const creatorEmail = sessionData.session?.user?.email || '';
    
    if (Platform.OS === 'web') {
      console.log('DEBUG: Email detectado:', creatorEmail);
      if (!creatorEmail) window.alert('AVISO: No se ha detectado tu email en la sesión activa.');
    }

    const matchData = {
      title,
      venue,
      date,
      time,
      price: parseFloat(price) || 0,
      max_players: parseInt(maxPlayers) || 10,
      level,
      location_url: locationUrl,
      image_url: venueImageUrl || 'https://images.unsplash.com/photo-1543351611-58f69d7c1781?q=80&w=600&auto=format&fit=crop',
      is_private: isPrivate,
      is_advanced: isAdvanced,
      cancellation_hours: parseInt(cancellationHours) || 12,
      requires_payment: requiresPayment,
      payment_deadline_hours: requiresPayment ? (parseInt(paymentDeadlineHours) || 24) : null,
      creator_email: creatorEmail
    };

    let error;
    if (editId) {
      const res = await supabase.from(fromTable('matches')).update(matchData).eq('id', editId);
      error = res.error;
    } else {
      const res = await supabase.from(fromTable('matches')).insert({
        ...matchData,
        joined_players: 0,
        distance: distance || 'Apto' // Using distance field for format 
      });

  // Auto-fill Google Maps link moved to top-level hook (see below)
      error = res.error;
    }
    if (error) {
      setLoading(false);
      Alert.alert('Error', error.message);
    } else {
      setLoading(false);
      // On Web, Alert is non-blocking. Let's wait for user or just redirect after a success message.
      if (Platform.OS === 'web') {
        window.alert(editId ? 'Cambios guardados correctamente.' : 'El partido ha sido publicado oficialmente.');
        router.dismissAll();
        router.replace('/(tabs)');
      } else {
        Alert.alert(
          '¡Éxito!', 
          editId ? 'Cambios guardados correctamente.' : 'El partido ha sido publicado oficialmente.',
          [{ text: 'OK', onPress: () => {
            router.dismissAll();
            router.replace('/(tabs)');
          }}]
        );
      }
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{editId ? 'Editar Partido' : 'Agendar Partido'}</Text>

        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        
        <View style={styles.formGroup}>
          <Text style={styles.label}>Título del Evento (Opcional)</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Ej. Amistoso de verano" placeholderTextColor="#64748B" />
          <Text style={{color: '#C05E5E', fontSize: 12, marginTop: 6, fontWeight: '500'}}>
             Si lo dejas vacío, el nombre del partido será la Ubicación por defecto.
          </Text>
        </View>

        {/* Ubicación del Recinto with dropdown and save button */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Ubicación del Recinto <Text style={{color: '#EF4444'}}>*</Text></Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={venue}
              onChangeText={setVenue}
              placeholder="Ej. Pista Municipal Sants"
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity style={styles.smallButton} onPress={() => setShowLocationModal(true)}>
              <Ionicons name="list" size={20} color="#FFB81C" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallButton} onPress={handleSaveLocation} disabled={loadingSaveLocation}>
              <Ionicons name="save" size={20} color="#FFB81C" />
            </TouchableOpacity>
          </View>
          {statusMsg ? (
            <View style={[styles.statusBanner, { borderColor: statusColor }]}>
              <Ionicons name="information-circle-outline" size={16} color={statusColor} />
              <Text style={[styles.statusText, { color: statusColor }]}>{statusMsg}</Text>
            </View>
          ) : null}
          {venueImageUrl ? (
            <View style={styles.venuePreviewContainer}>
              <Image 
                source={{ uri: venueImageUrl }} 
                style={styles.venuePreviewImage} 
                contentFit="cover"
                onLoad={() => console.log('Imagen de recinto cargada con éxito')}
                onError={(e) => setStatusMsg(`Error cargando imagen: ${JSON.stringify(e)}`)}
              />
              <View style={styles.venuePreviewTextContainer}>
                <Text style={styles.venuePreviewLabel}>Previsualización del Recinto</Text>
                <TouchableOpacity onPress={() => window.open(venueImageUrl, '_blank')}>
                  <Text style={[styles.venuePreviewSub, { color: '#2563EB', textDecorationLine: 'underline' }]}>
                    Ver imagen original (Si no carga)
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setVenueImageUrl('')}>
                <Ionicons name="close-circle" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Enlace Google Maps (Opcional)</Text>
          <TextInput
            style={styles.input}
            value={locationUrl}
            onChangeText={setLocationUrl}
            placeholder="https://maps.google.com/..."
            placeholderTextColor="#94A3B8"
            keyboardType="url"
            autoCapitalize="none"
          />
          <Text style={{color: '#C05E5E', fontSize: 12, marginTop: 6, fontWeight: '500'}}>
            Para mejor geolocalización, pega el enlace largo completo que contiene las coordenadas.
          </Text>
        </View>

        {/* Modal for selecting saved locations */}
        <Modal visible={showLocationModal} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Seleccionar Ubicación Guardada</Text>
                <TouchableOpacity onPress={() => setShowLocationModal(false)}>
                  <Ionicons name="close" size={28} color="#94A3B8" />
                </TouchableOpacity>
              </View>
              {loadingLocations ? (
                <ActivityIndicator color="#C05E5E" style={{marginVertical: 30}} />
              ) : savedLocations.length === 0 ? (
                <View style={{alignItems: 'center', marginVertical: 40}}>
                  <Text style={{color: '#94A3B8'}}>No hay ubicaciones guardadas.</Text>
                </View>
              ) : (
                <FlatList
                  data={savedLocations}
                  keyExtractor={item => item.id?.toString() || item.name}
                  renderItem={({item}) => (
                    <View style={styles.dirPlayerCardContainer}>
                      <TouchableOpacity
                        style={styles.dirPlayerCard}
                        onPress={() => {
                          setVenue(item.name);
                          setLocationUrl(item.location_url);
                          setVenueImageUrl(item.image_url || '');
                          setShowLocationModal(false);
                        }}
                      >
                        <View style={styles.locationIconContainer}>
                          {item.image_url ? (
                            <Image 
                              source={{ uri: item.image_url }} 
                              style={{ width: 40, height: 40, borderRadius: 10 }} 
                            />
                          ) : (
                            <Ionicons name="business" size={20} color="#FFB81C" />
                          )}
                        </View>
                        <View style={styles.dirPlayerInfo}>
                          <Text style={styles.dirPlayerName}>{item.name}</Text>
                          <Text style={styles.dirPlayerLvl} numberOfLines={1}>{item.location_url}</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={styles.deleteLocationBtn}
                        onPress={async () => {
                          const { error } = await supabase.from(fromTable('saved_locations')).delete().eq('id', item.id);
                          if (!error) await fetchLocations();
                        }}
                      >
                        <Ionicons name="trash-outline" size={18} color="#FF4757" />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              )}
            </View>
          </View>
        </Modal>

        {/* Cajas Interactivas para abrir Modales Puros (Cross-Platform Bug-Free) */}
        <View style={styles.row}>
          <View style={[styles.formGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.label}>Fecha <Text style={{color: '#EF4444'}}>*</Text></Text>
            <TouchableOpacity style={[styles.pickerBox, date && {backgroundColor: '#FFB81C'}]} onPress={() => setShowDateModal(true)}>
              <Ionicons name="calendar-outline" size={20} color={date ? "#FFF" : "#64748B"} style={{marginRight: 8}} />
              <Text style={{color: date ? '#FFF' : '#64748B', flex: 1, fontWeight: '600'}} numberOfLines={1}>
                {date || 'Seleccionar día'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.formGroup, { flex: 1, marginLeft: 10 }]}>
            <Text style={styles.label}>Hora <Text style={{color: '#EF4444'}}>*</Text></Text>
            <TouchableOpacity style={styles.pickerBox} onPress={() => setShowTimeModal(true)}>
              <Ionicons name="time-outline" size={20} color={time ? "#FFB81C" : "#94A3B8"} style={{marginRight: 8}} />
              <Text style={{color: time ? '#0F172A' : '#94A3B8', flex: 1, fontWeight: '500'}}>
                {time || 'Elegir hora'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.formGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.label}>Precio (€)</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={(val) => {
                setPrice(val);
                if (parseFloat(val) > 0) setRequiresPayment(true);
              }}
              keyboardType="numeric"
              placeholderTextColor="#64748B"
            />
          </View>
          <View style={[styles.formGroup, { flex: 1, marginLeft: 10 }]}>
            <Text style={styles.label}>Plazas Máximas</Text>
            <TextInput style={styles.input} value={maxPlayers} onChangeText={setMaxPlayers} keyboardType="numeric" placeholderTextColor="#64748B" />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.formGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.label}>Nivel esperado</Text>
            <TextInput style={styles.input} value={level} onChangeText={setLevel} placeholder="Amateur..." placeholderTextColor="#64748B" />
          </View>
          
          <View style={[styles.formGroup, { flex: 1, marginLeft: 10 }]}>
            <Text style={styles.label}>Formato <Text style={{color: '#EF4444'}}>*</Text></Text>
            <TouchableOpacity style={styles.pickerBox} onPress={() => setShowFormatModal(true)}>
              <Ionicons name="people-outline" size={20} color={distance ? "#FFB81C" : "#94A3B8"} style={{marginRight: 8}} />
              <Text style={{color: distance ? '#0F172A' : '#94A3B8', flex: 1, fontWeight: '500'}} numberOfLines={1}>
                {distance || 'Elegir formato'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.categoriesContainer}>
          <View style={styles.categoryRow}>
            <View style={styles.categoryLabelRow}>
              <Ionicons name="female" size={20} color="#FFB81C" />
              <Text style={styles.categoryLabel}>Femenino</Text>
            </View>
            <Switch value={isFemale} onValueChange={setIsFemale} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
          </View>

          <View style={styles.categoryRow}>
            <View style={styles.categoryLabelRow}>
              <Ionicons name="male-female" size={20} color="#FFB81C" />
              <Text style={styles.categoryLabel}>Mixto</Text>
            </View>
            <Switch value={isMixed} onValueChange={setIsMixed} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
          </View>

          <View style={styles.categoryRow}>
            <View style={styles.categoryLabelRow}>
              <Ionicons name="lock-closed" size={20} color="#FFB81C" />
              <Text style={styles.categoryLabel}>Privado</Text>
            </View>
            <Switch value={isPrivate} onValueChange={setIsPrivate} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
          </View>

          <View style={styles.categoryRow}>
            <View style={styles.categoryLabelRow}>
              <Ionicons name="trophy" size={20} color="#FFB81C" />
              <Text style={styles.categoryLabel}>Avanzado</Text>
            </View>
            <Switch value={isAdvanced} onValueChange={setIsAdvanced} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
          </View>

          <View style={[styles.categoryRow, { borderBottomWidth: 0 }]}>
            <View style={styles.categoryLabelRow}>
              <Ionicons name="card" size={20} color="#FFB81C" />
              <Text style={styles.categoryLabel}>Requiere Pago</Text>
            </View>
            <Switch value={requiresPayment} onValueChange={setRequiresPayment} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
          </View>
        </View>

        {requiresPayment && (
          <View style={styles.formGroup}>
            <Text style={styles.label}>Horas límite para pagar plaza</Text>
            <TextInput
              style={styles.input}
              value={paymentDeadlineHours}
              onChangeText={setPaymentDeadlineHours}
              keyboardType="numeric"
              placeholder="24"
              placeholderTextColor="#64748B"
            />
            <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
              Los jugadores deben pagar antes de estas horas o perderán la plaza.
            </Text>
          </View>
        )}
        
        {/* Horas de cancelación */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Horas límite para desapuntarse</Text>
          <TextInput 
            style={styles.input} 
            value={cancellationHours} 
            onChangeText={setCancellationHours} 
            keyboardType="numeric" 
            placeholder="12" 
            placeholderTextColor="#64748B" 
          />
          <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
            Los jugadores no podrán salir si faltan menos de estas horas.
          </Text>
        </View>

        {formError ? (
          <View style={{ backgroundColor: '#FEE2E2', padding: 12, borderRadius: 12, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#EF4444' }}>
            <Text style={{ color: '#B91C1C', fontSize: 14, fontWeight: '600' }}>{formError}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={[styles.submitButton, loading && { opacity: 0.7 }]} onPress={handleCreate} disabled={loading}>
          {loading ? <ActivityIndicator color="#0B1021" /> : <Text style={styles.submitButtonText}>{editId ? 'GUARDAR CAMBIOS' : 'PUBLICAR PARTIDO'}</Text>}
        </TouchableOpacity>

      </ScrollView>

      {/* Modal Personalizado para Fechas (Funciona 100% en Web/iOS/Android sin errores de Metro dependencies) */}
      <Modal visible={showDateModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>¿Qué día?</Text>
              <TouchableOpacity onPress={() => setShowDateModal(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={UPCOMING_DAYS}
              keyExtractor={(i) => i}
              renderItem={({item}) => (
                <TouchableOpacity style={[styles.modalOption, date === item && styles.modalOptionActive]} onPress={() => { setDate(item); setShowDateModal(false); }}>
                  <Text style={[styles.modalOptionText, date === item && {color: '#FFF'}]}>{item}</Text>
                  {date === item && <Ionicons name="checkmark-circle" size={24} color="#FF4757" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Modal Personalizado para Hora */}
      <Modal visible={showTimeModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>¿A qué hora?</Text>
              <TouchableOpacity onPress={() => setShowTimeModal(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={TIMES}
              keyExtractor={(i) => i}
              renderItem={({item}) => (
                <TouchableOpacity style={[styles.modalOption, time === item && styles.modalOptionActive]} onPress={() => { setTime(item); setShowTimeModal(false); }}>
                  <Text style={[styles.modalOptionText, time === item && {color: '#FFF'}]}>{item}</Text>
                  {time === item && <Ionicons name="checkmark-circle" size={24} color="#FF4757" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Modal Personalizado para Formato */}
      <Modal visible={showFormatModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Formato del Partido</Text>
              <TouchableOpacity onPress={() => setShowFormatModal(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <View style={{ marginBottom: 16 }}>
              <TextInput 
                style={styles.input} 
                value={distance} 
                onChangeText={setDistance} 
                placeholder="Introducir formato libre (ej. 5v5 rotando)" 
                placeholderTextColor="#94A3B8"
              />
            </View>
            <FlatList
              data={FORMATS}
              keyExtractor={(i) => i}
              renderItem={({item}) => (
                <TouchableOpacity style={[styles.modalOption, distance === item && styles.modalOptionActive]} onPress={() => { setDistance(item); setShowFormatModal(false); }}>
                  <Text style={[styles.modalOptionText, distance === item && {color: '#FFF'}]}>{item}</Text>
                  {distance === item && <Ionicons name="checkmark-circle" size={24} color="#FF4757" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: '#FFFFFF' },
  backButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  container: { flex: 1, padding: 24 },
  formGroup: { marginBottom: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  smallButton: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  dirPlayerCard: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dirPlayerInfo: { flexDirection: 'column' },
  dirPlayerName: { fontSize: 16, fontWeight: '600', color: '#0F172A' },
  dirPlayerLvl: { fontSize: 14, color: '#64748B', marginTop: 4 },
  label: { fontSize: 14, color: '#64748B', marginBottom: 10, fontWeight: '700' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#F1F5F9', color: '#0F172A', fontSize: 16, padding: 18, fontWeight: '500' },
  pickerBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#F1F5F9', padding: 18, height: 60 },
  submitButton: { backgroundColor: '#FFB81C', padding: 20, borderRadius: 20, alignItems: 'center', marginTop: 20, shadowColor: '#FFB81C', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  submitButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  // Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFFFFF', height: '65%', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  modalOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalOptionActive: { backgroundColor: '#F1F5F9', borderRadius: 16, paddingHorizontal: 16, marginHorizontal: -16 },
  modalOptionText: { fontSize: 17, color: '#64748B', fontWeight: '600' },
  // Modal Saved Locations specific
  dirPlayerCardContainer: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  locationIconContainer: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  deleteLocationBtn: { padding: 12 },
  // Venue Preview specific
  venuePreviewContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 12, borderRadius: 16, marginTop: 12, borderWidth: 1, borderColor: '#F1F5F9' },
  venuePreviewImage: { width: 50, height: 50, borderRadius: 12, marginRight: 12 },
  venuePreviewTextContainer: { flex: 1 },
  venuePreviewLabel: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  venuePreviewSub: { fontSize: 11, color: '#64748B', marginTop: 2 },
  statusBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 10, borderRadius: 12, marginTop: 12, borderWidth: 1, borderStyle: 'dashed' },
  statusText: { fontSize: 13, fontWeight: '600', marginLeft: 8 },
  categoriesContainer: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#F1F5F9' },
  categoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  categoryLabelRow: { flexDirection: 'row', alignItems: 'center' },
  categoryLabel: { marginLeft: 12, fontSize: 16, fontWeight: '600', color: '#0F172A' },
});
