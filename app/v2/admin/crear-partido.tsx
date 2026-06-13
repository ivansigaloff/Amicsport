import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Modal, FlatList, Platform, Switch, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { useJsApiLoader } from '@react-google-maps/api';
import { Image } from 'expo-image';
import { parseMatchDate, toISODate } from '../../../lib/date';
import AdminScreen from '../../../components/v2/admin/AdminScreen';
import { Field, Button, PressableScale, C, FONTS, R, S, SHADOW } from '../../../components/v2/ui';

type SavedLocation = { id?: number; name: string; location_url: string; image_url?: string };
type IconName = React.ComponentProps<typeof Ionicons>['name'];
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

const isMatchInPast = (dateISO: string, timeStr: string) => {
  if (!dateISO || !timeStr) return false;
  const now = new Date();
  let bcnDate;
  try { bcnDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' })); } catch { bcnDate = now; }
  const [year, month, day] = dateISO.split('-').map(Number);
  const [h, m] = timeStr.split(':').map(Number);
  return new Date(year, month - 1, day, h, m, 0) < bcnDate;
};

const generateUpcomingDays = () => {
  const days: { iso: string; label: string }[] = [];
  const options = { weekday: 'short', day: 'numeric', month: 'short' } as const;
  for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() + i); days.push({ iso: toISODate(d)!, label: d.toLocaleDateString('es-ES', options) }); }
  return days;
};
const generateTimes = () => { const t: string[] = []; for (let h = 8; h <= 23; h++) { t.push(`${String(h).padStart(2, '0')}:00`); t.push(`${String(h).padStart(2, '0')}:30`); } return t; };

function SwitchRow({ icon, label, value, onChange }: { icon: IconName; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={styles.switchIcon}><Ionicons name={icon} size={18} color={C.brandDeep} /></View>
        <Text style={styles.switchLabel}>{label}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: C.border, true: C.brand }} thumbColor="#fff" />
    </View>
  );
}

function PickerBox({ icon, value, placeholder, onPress, active }: { icon: IconName; value: string; placeholder: string; onPress: () => void; active?: boolean }) {
  return (
    <PressableScale onPress={onPress} style={[styles.picker, active && { borderColor: C.brand, backgroundColor: C.brandWash }]}>
      <Ionicons name={icon} size={18} color={value ? C.brandDeep : C.textFaint} />
      <Text style={[styles.pickerText, { color: value ? C.text : C.textFaint }]} numberOfLines={1}>{value || placeholder}</Text>
      <Ionicons name="chevron-down" size={16} color={C.textFaint} />
    </PressableScale>
  );
}

export default function V2CreateMatch() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId: string }>();
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [venueImageUrl, setVenueImageUrl] = useState('');
  const [date, setDate] = useState('');
  const [selectedISO, setSelectedISO] = useState('');
  const [time, setTime] = useState('');
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [price, setPrice] = useState('5.00');
  const [maxPlayers, setMaxPlayers] = useState('14');
  const [distance, setDistance] = useState('');
  const [formatEdited, setFormatEdited] = useState(false);
  const [level, setLevel] = useState('Nivel Amateur/Medio');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [loadingSaveLocation, setLoadingSaveLocation] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusColor, setStatusColor] = useState(C.textMuted as string);
  const [isFemale, setIsFemale] = useState(false);
  const [isMixed, setIsMixed] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [cancellationHours, setCancellationHours] = useState('12');
  const [requiresPayment, setRequiresPayment] = useState(false);
  const [paymentDeadlineHours, setPaymentDeadlineHours] = useState('24');

  const fetchLocations = async () => {
    setLoadingLocations(true);
    const { data, error } = await supabase.from('saved_locations').select('*');
    if (!error && data) setSavedLocations(data as SavedLocation[]);
    setLoadingLocations(false);
  };

  useEffect(() => { fetchLocations(); }, []);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('matches').select('*').eq('id', editId).single();
      if (data) {
        setTitle(data.title); setVenue(data.venue); setDate(data.date);
        setSelectedISO(data.match_date || toISODate(parseMatchDate(data.date)) || '');
        setTime(data.time); setPrice(data.price.toString()); setMaxPlayers(data.max_players.toString());
        setDistance(data.distance || ''); setFormatEdited(true); setLevel(data.level);
        setLocationUrl(data.location_url || ''); setVenueImageUrl(data.image_url || '');
        setIsFemale(data.is_female || false); setIsMixed(data.is_mixed || false);
        setIsPrivate(data.is_private || false); setIsAdvanced(data.is_advanced || false);
        setRequiresPayment(data.requires_payment || false);
        if (data.payment_deadline_hours) setPaymentDeadlineHours(String(data.payment_deadline_hours));
      }
      setLoading(false);
    })();
  }, [editId]);

  useEffect(() => { if (venue && !locationUrl) setLocationUrl(`https://www.google.com/maps/search/${encodeURIComponent(venue)}`); }, [venue]);
  useEffect(() => { if (formatEdited) return; const n = parseInt(maxPlayers); if (!isNaN(n) && n > 1) setDistance(`${Math.floor(n / 2)} vs ${Math.ceil(n / 2)}`); }, [maxPlayers, formatEdited]);

  const { isLoaded: isMapsLoaded } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries: ['places'] as any });

  const fetchVenuePhoto = async (venueName: string, url?: string): Promise<string | null> => {
    try {
      let searchQuery = venueName;
      if (url) {
        const placeMatch = url.match(/\/place\/([^\/\?]+)/);
        if (placeMatch) searchQuery = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
        else { const qMatch = url.match(/[?&]q=([^&]+)/); if (qMatch) searchQuery = decodeURIComponent(qMatch[1].replace(/\+/g, ' ')); }
      }
      setStatusMsg(`Buscando: "${searchQuery}"...`);
      try {
        const v1Res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': 'places.photos,places.id' },
          body: JSON.stringify({ textQuery: searchQuery }),
        });
        if (v1Res.status === 403) { setStatusMsg('Error 403: "Places API (New)" no habilitada en Google Console.'); setStatusColor(C.danger); }
        const v1Data = await v1Res.json();
        if (v1Data.places?.[0]?.photos?.[0]) {
          const photoName = v1Data.places[0].photos[0].name;
          return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${GOOGLE_MAPS_API_KEY}`;
        }
      } catch {}
      if (Platform.OS === 'web') {
        if (!isMapsLoaded) return null;
        const google = (window as any).google;
        const service = new google.maps.places.PlacesService(document.createElement('div'));
        return new Promise((resolve) => {
          service.findPlaceFromQuery({ query: searchQuery, fields: ['photos'] }, (results: any, status: any) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && results?.[0]?.photos?.[0]) {
              const sessionUrl = results[0].photos[0].getUrl({ maxWidth: 800 });
              const refMatch = sessionUrl.match(/[?&]1s([^&]+)/);
              if (refMatch) resolve(`https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${refMatch[1]}&key=${GOOGLE_MAPS_API_KEY}`);
              else resolve(sessionUrl);
            } else resolve(null);
          });
        });
      } else {
        const apiUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(searchQuery)}&inputtype=textquery&fields=photos&key=${GOOGLE_MAPS_API_KEY}`;
        const res = await fetch(apiUrl); const data = await res.json();
        if (data.status === 'OK' && data.candidates?.[0]?.photos?.[0]) return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${data.candidates[0].photos[0].photo_reference}&key=${GOOGLE_MAPS_API_KEY}`;
      }
    } catch (e) { console.error('Error fetching venue photo:', e); }
    return null;
  };

  useEffect(() => {
    (async () => {
      if (locationUrl && (locationUrl.includes('google.com/maps') || locationUrl.includes('goo.gl'))) { const p = await fetchVenuePhoto(venue, locationUrl); if (p) setVenueImageUrl(p); }
      else if (venue && !locationUrl) { const p = await fetchVenuePhoto(venue); if (p) setVenueImageUrl(p); }
    })();
  }, [locationUrl, venue]);

  const handleSaveLocation = async () => {
    if (!venue) return Alert.alert('Aviso', 'Introduce un nombre de ubicación antes de guardar.');
    setLoadingSaveLocation(true); setStatusMsg('Buscando foto en Google Maps...'); setStatusColor(C.brand);
    try {
      const photoUrl = await fetchVenuePhoto(venue, locationUrl);
      setStatusColor(photoUrl ? C.success : C.warning);
      const { data: existing } = await supabase.from('saved_locations').select('image_url').eq('name', venue).single();
      const finalPhotoUrl = photoUrl || (existing ? existing.image_url : null);
      const link = locationUrl || `https://www.google.com/maps/search/${encodeURIComponent(venue)}`;
      const { error, data: upsertResult } = await supabase.from('saved_locations').upsert({ name: venue, location_url: link, image_url: finalPhotoUrl }, { onConflict: 'name' }).select();
      if (error) { setStatusMsg(`Error al guardar: ${error.message}`); setStatusColor(C.danger); }
      else { if (finalPhotoUrl) setVenueImageUrl(finalPhotoUrl); await fetchLocations(); setStatusMsg('✅ Ubicación guardada'); setStatusColor(C.success); }
    } catch (err: any) { setStatusMsg(`Error: ${err.message || 'Desconocido'}`); setStatusColor(C.danger); }
    finally { setLoadingSaveLocation(false); }
  };

  const handleCreate = async () => {
    setFormError('');
    if (!venue || !date || !time || !distance) { setFormError('Faltan campos obligatorios (localidad, fecha, hora o formato).'); return; }
    const dateISO = selectedISO || toISODate(parseMatchDate(date));
    if (dateISO && isMatchInPast(dateISO, time)) { setFormError('No se puede guardar un partido en el pasado.'); return; }
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const creatorEmail = sessionData.session?.user?.email || '';
    const matchData = {
      title, venue, date, match_date: dateISO, time, price: parseFloat(price) || 0, max_players: parseInt(maxPlayers) || 10, level,
      distance: distance || 'Apto', location_url: locationUrl,
      image_url: venueImageUrl || 'https://images.unsplash.com/photo-1543351611-58f69d7c1781?q=80&w=600&auto=format&fit=crop',
      is_female: isFemale, is_mixed: isMixed, is_private: isPrivate, is_advanced: isAdvanced,
      cancellation_hours: parseInt(cancellationHours) || 12, requires_payment: requiresPayment,
      payment_deadline_hours: requiresPayment ? (parseInt(paymentDeadlineHours) || 24) : null, creator_email: creatorEmail,
    };
    const res = editId
      ? await supabase.from('matches').update(matchData).eq('id', editId)
      : await supabase.from('matches').insert({ ...matchData, joined_players: 0 });
    setLoading(false);
    if (res.error) { Alert.alert('Error', res.error.message); return; }
    const msg = editId ? 'Cambios guardados correctamente.' : 'El partido ha sido publicado.';
    if (Platform.OS === 'web') { window.alert(msg); router.replace('/v2' as any); }
    else Alert.alert('¡Éxito!', msg, [{ text: 'OK', onPress: () => router.replace('/v2' as any) }]);
  };

  const UPCOMING_DAYS = generateUpcomingDays();
  const TIMES = generateTimes();

  return (
    <AdminScreen title={editId ? 'Editar partido' : 'Agendar partido'} subtitle={editId ? 'Modifica los detalles' : 'Crea un nuevo partido'}>
      <View style={{ gap: S.lg }}>
        <Field label="Título (opcional)" icon="text-outline" value={title} onChangeText={setTitle} placeholder="Ej. Amistoso de verano" />

        {/* Venue + actions */}
        <View>
          <Text style={styles.fieldLabel}>Ubicación del recinto *</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'stretch' }}>
            <Field icon="location-outline" value={venue} onChangeText={setVenue} placeholder="Ej. Pista Municipal Sants" containerStyle={{ flex: 1 }} />
            <PressableScale onPress={() => setShowLocationModal(true)} style={styles.squareBtn}><Ionicons name="list" size={20} color={C.brandDeep} /></PressableScale>
            <PressableScale onPress={handleSaveLocation} disabled={loadingSaveLocation} style={styles.squareBtn}>{loadingSaveLocation ? <ActivityIndicator size="small" color={C.brandDeep} /> : <Ionicons name="bookmark" size={19} color={C.brandDeep} />}</PressableScale>
          </View>
          {!!statusMsg && (
            <View style={[styles.statusBanner, { borderColor: statusColor }]}>
              <Ionicons name="information-circle-outline" size={15} color={statusColor} />
              <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={2}>{statusMsg}</Text>
            </View>
          )}
          {!!venueImageUrl && (
            <View style={styles.preview}>
              <Image source={{ uri: venueImageUrl }} style={styles.previewImg} contentFit="cover" />
              <Text style={styles.previewLabel}>Previsualización del recinto</Text>
              <PressableScale onPress={() => setVenueImageUrl('')}><Ionicons name="close-circle" size={22} color={C.textFaint} /></PressableScale>
            </View>
          )}
        </View>

        {/* Date / time */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Fecha *</Text>
            <PickerBox icon="calendar-outline" value={date} placeholder="Día" onPress={() => setShowDateModal(true)} active={!!date} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Hora *</Text>
            <PickerBox icon="time-outline" value={time} placeholder="Hora" onPress={() => setShowTimeModal(true)} active={!!time} />
          </View>
        </View>

        {/* Price / spots */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Field label="Precio (€)" icon="pricetag-outline" value={price} onChangeText={(v) => { setPrice(v); if (parseFloat(v) > 0) setRequiresPayment(true); }} keyboardType="numeric" containerStyle={{ flex: 1 }} />
          <Field label="Plazas" icon="people-outline" value={maxPlayers} onChangeText={setMaxPlayers} keyboardType="numeric" containerStyle={{ flex: 1 }} />
        </View>

        {/* Level / format */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Field label="Nivel" icon="stats-chart-outline" value={level} onChangeText={setLevel} placeholder="Amateur" containerStyle={{ flex: 1 }} />
          <Field label="Formato" icon="grid-outline" value={distance} onChangeText={(v) => { setDistance(v); setFormatEdited(true); }} placeholder="7 vs 7" containerStyle={{ flex: 1 }} />
        </View>

        <Field label="Enlace Google Maps (opcional)" icon="link-outline" value={locationUrl} onChangeText={setLocationUrl} placeholder="https://maps.google.com/..." keyboardType="url" autoCapitalize="none" />

        {/* Options card */}
        <View style={styles.optionsCard}>
          <SwitchRow icon="card" label="Requiere pago" value={requiresPayment} onChange={setRequiresPayment} />
          {requiresPayment && (
            <Field label="Horas límite para pagar" icon="hourglass-outline" value={paymentDeadlineHours} onChangeText={setPaymentDeadlineHours} keyboardType="numeric" placeholder="24" containerStyle={{ marginTop: 4, marginBottom: 8 }} />
          )}
          <View style={styles.optDivider} />
          <SwitchRow icon="female" label="Femenino" value={isFemale} onChange={setIsFemale} />
          <SwitchRow icon="male-female" label="Mixto" value={isMixed} onChange={setIsMixed} />
          <SwitchRow icon="lock-closed" label="Privado" value={isPrivate} onChange={setIsPrivate} />
          <SwitchRow icon="trophy" label="Avanzado" value={isAdvanced} onChange={setIsAdvanced} />
        </View>

        <Field label="Horas límite para desapuntarse" icon="exit-outline" value={cancellationHours} onChangeText={setCancellationHours} keyboardType="numeric" placeholder="12" />

        {!!formError && (
          <View style={styles.errorBox}><Ionicons name="alert-circle" size={18} color={C.danger} /><Text style={styles.errorText}>{formError}</Text></View>
        )}

        <Button title={editId ? 'GUARDAR CAMBIOS' : 'PUBLICAR PARTIDO'} onPress={handleCreate} loading={loading} full size="lg" icon={editId ? 'save' : 'megaphone'} />
      </View>

      {/* Saved locations modal */}
      <Modal visible={showLocationModal} transparent animationType="slide" onRequestClose={() => setShowLocationModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Ubicaciones guardadas</Text><PressableScale onPress={() => setShowLocationModal(false)}><Ionicons name="close" size={26} color={C.textFaint} /></PressableScale></View>
            {loadingLocations ? <ActivityIndicator color={C.brand} style={{ marginVertical: 30 }} /> : savedLocations.length === 0 ? (
              <Text style={styles.emptyText}>No hay ubicaciones guardadas.</Text>
            ) : (
              <FlatList data={savedLocations} keyExtractor={(i) => i.id?.toString() || i.name} style={{ maxHeight: 380 }}
                renderItem={({ item }) => (
                  <View style={styles.locRow}>
                    <TouchableOpacity style={styles.locMain} onPress={() => { setVenue(item.name); setLocationUrl(item.location_url); setVenueImageUrl(item.image_url || ''); setShowLocationModal(false); }}>
                      <View style={styles.locThumb}>{item.image_url ? <Image source={{ uri: item.image_url }} style={{ width: 42, height: 42 }} /> : <Ionicons name="business" size={20} color={C.brandDeep} />}</View>
                      <View style={{ flex: 1 }}><Text style={styles.locName}>{item.name}</Text><Text style={styles.locUrl} numberOfLines={1}>{item.location_url}</Text></View>
                    </TouchableOpacity>
                    <PressableScale onPress={async () => { const { error } = await supabase.from('saved_locations').delete().eq('id', item.id); if (!error) await fetchLocations(); }} style={styles.locDelete}><Ionicons name="trash-outline" size={18} color={C.danger} /></PressableScale>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Date modal */}
      <Modal visible={showDateModal} transparent animationType="slide" onRequestClose={() => setShowDateModal(false)}>
        <View style={styles.overlay}><View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>¿Qué día?</Text><PressableScale onPress={() => setShowDateModal(false)}><Ionicons name="close" size={26} color={C.textFaint} /></PressableScale></View>
          <FlatList data={UPCOMING_DAYS} keyExtractor={(i) => i.iso} style={{ maxHeight: 400 }} renderItem={({ item }) => (
            <TouchableOpacity style={[styles.optRow, date === item.label && styles.optRowActive]} onPress={() => { setDate(item.label); setSelectedISO(item.iso); setShowDateModal(false); }}>
              <Text style={[styles.optText, date === item.label && { color: C.brandDeep, fontFamily: FONTS.bold }]}>{item.label}</Text>
              {date === item.label && <Ionicons name="checkmark-circle" size={22} color={C.brand} />}
            </TouchableOpacity>
          )} />
        </View></View>
      </Modal>

      {/* Time modal */}
      <Modal visible={showTimeModal} transparent animationType="slide" onRequestClose={() => setShowTimeModal(false)}>
        <View style={styles.overlay}><View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>¿A qué hora?</Text><PressableScale onPress={() => setShowTimeModal(false)}><Ionicons name="close" size={26} color={C.textFaint} /></PressableScale></View>
          <FlatList data={TIMES} keyExtractor={(i) => i} style={{ maxHeight: 400 }} renderItem={({ item }) => (
            <TouchableOpacity style={[styles.optRow, time === item && styles.optRowActive]} onPress={() => { setTime(item); setShowTimeModal(false); }}>
              <Text style={[styles.optText, time === item && { color: C.brandDeep, fontFamily: FONTS.bold }]}>{item}</Text>
              {time === item && <Ionicons name="checkmark-circle" size={22} color={C.brand} />}
            </TouchableOpacity>
          )} />
        </View></View>
      </Modal>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { color: C.textMuted, fontFamily: FONTS.semibold, fontSize: 13, marginBottom: 7, marginLeft: 2 },
  squareBtn: { width: 54, height: 54, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, padding: 10, borderRadius: R.sm, marginTop: 10, borderWidth: 1, borderStyle: 'dashed' },
  statusText: { fontSize: 12.5, fontFamily: FONTS.semibold, flex: 1 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, padding: 10, borderRadius: R.md, marginTop: 10, borderWidth: 1, borderColor: C.border },
  previewImg: { width: 48, height: 48 },
  previewLabel: { flex: 1, fontSize: 13, fontFamily: FONTS.semibold, color: C.text },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: S.lg, height: 54 },
  pickerText: { flex: 1, fontFamily: FONTS.semibold, fontSize: 14.5 },
  optionsCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, borderWidth: 1, borderColor: C.border, ...SHADOW.sm },
  optDivider: { height: 1, backgroundColor: C.border, marginVertical: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  switchIcon: { width: 36, height: 36, borderRadius: R.sm, backgroundColor: C.brandWash, alignItems: 'center', justifyContent: 'center' },
  switchLabel: { fontFamily: FONTS.semibold, fontSize: 15, color: C.text },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.dangerWash, padding: 12, borderRadius: R.md, borderLeftWidth: 4, borderLeftColor: C.danger },
  errorText: { color: '#B91C1C', fontSize: 13.5, fontFamily: FONTS.semibold, flex: 1 },
  overlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: S.xl, paddingBottom: S.huge, ...(Platform.OS === 'web' ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {}) },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.borderStrong, alignSelf: 'center', marginBottom: S.lg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.md },
  sheetTitle: { fontFamily: FONTS.extraBold, fontSize: 19, color: C.text },
  emptyText: { color: C.textFaint, fontFamily: FONTS.medium, textAlign: 'center', marginVertical: 30 },
  optRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: C.border },
  optRowActive: { backgroundColor: C.brandWash, borderRadius: R.sm, paddingHorizontal: 12, marginHorizontal: -12, borderBottomColor: 'transparent' },
  optText: { fontSize: 16, color: C.textMuted, fontFamily: FONTS.medium },
  locRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border },
  locMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  locThumb: { width: 42, height: 42, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  locName: { fontSize: 15, fontFamily: FONTS.bold, color: C.text },
  locUrl: { fontSize: 12.5, color: C.textMuted, marginTop: 2 },
  locDelete: { padding: 12 },
});
