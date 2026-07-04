import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SHADOWS } from '../../constants/theme';
import { saveGPSTrack, deleteGPSTrackByParticipant, fetchGPSPlayTracks } from '../../lib/services/gpsService';

interface Participant {
  id: string;
  user_name: string;
  device_number?: number | null;
  user_id: string | null;
}

type SyncStatus = 'pending' | 'connecting' | 'downloading' | 'saving' | 'completed' | 'failed';

interface GPSSyncModalProps {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  participantsList: Participant[];
  fromTable: (t: string) => string;
  showAlert: (title: string, msg: string) => void;
  onSyncSuccess?: () => void;
}

export default function GPSSyncModal({ visible, onClose, matchId, participantsList, fromTable, showAlert, onSyncSuccess }: GPSSyncModalProps) {
  const [syncing, setSyncing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  
  // Track sync statuses for each assigned player
  const [playerStatuses, setPlayerStatuses] = useState<Record<string, { status: SyncStatus; error?: string }>>({});
  const [uploadedTrackParticipantIds, setUploadedTrackParticipantIds] = useState<string[]>([]);

  // Filter list to only players who have an assigned tracker
  const assignedPlayers = participantsList.filter(p => p.device_number != null);

  const loadUploadedTracks = async () => {
    try {
      const tracks = await fetchGPSPlayTracks(matchId, fromTable);
      setUploadedTrackParticipantIds(tracks.map(t => t.participant_id).filter(Boolean) as string[]);
    } catch (err) {
      console.error('Error fetching uploaded GPS tracks:', err);
    }
  };

  useEffect(() => {
    if (visible) {
      // Reset statuses
      const initial: Record<string, { status: SyncStatus }> = {};
      assignedPlayers.forEach(p => {
        initial[p.id] = { status: 'pending' };
      });
      setPlayerStatuses(initial);
      setSyncing(false);
      setStatusText('');
      setDownloadProgress(0);
      loadUploadedTracks();
    }
  }, [visible, participantsList]);

  if (!visible) return null;

  const parseCSV = (text: string) => {
    const lines = text.split('\n');
    const result: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;
      // Handle prefix timestamp like "19:09:56.595 41.385477,..."
      const spaceIndex = line.indexOf(' ');
      if (spaceIndex > 0 && line.substring(0, spaceIndex).includes(':')) {
        line = line.substring(spaceIndex + 1).trim();
      }
      const parts = line.split(',');
      if (parts.length < 6) continue;
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      const speed = parseFloat(parts[2]);
      const sats = parseInt(parts[3], 10);
      const date = parts[4];
      const time = parts[5];
      if (isNaN(lat) || isNaN(lng) || isNaN(speed)) continue;
      result.push({ lat, lng, speed, sats, date, time });
    }
    return result;
  };

  const handleSyncNext = async () => {
    if (Platform.OS !== 'web') {
      showAlert('Web Bluetooth', 'La sincronización automática de GPS está disponible únicamente desde la versión Web del navegador (Chrome/Edge/Opera).');
      return;
    }

    if (!(navigator as any).bluetooth) {
      showAlert('No Soportado', 'Tu navegador no soporta la API Web Bluetooth. Utiliza Google Chrome.');
      return;
    }

    setSyncing(true);
    setStatusText('Iniciando búsqueda de tracker...');
    
    let device: any = null;
    let server: any = null;
    let targetParticipant: Participant | null = null;

    // NUS BLE UUIDs
    const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
    const NUS_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify

    try {
      // 1. request BLE Device
      device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix: 'AmicSport_Tracker_' }, { namePrefix: 'AmicSport_' }],
        optionalServices: [NUS_SERVICE_UUID]
      });

      const deviceName = device.name || '';
      const matchRes = deviceName.match(/AmicSport_Tracker_(\d+)/) || deviceName.match(/AmicSport_(\d+)/);
      const trackerId = matchRes ? parseInt(matchRes[1], 10) : null;

      if (trackerId === null) {
        throw new Error(`El tracker no tiene un nombre válido (${deviceName})`);
      }

      // Find the player assigned to this tracker ID
      targetParticipant = assignedPlayers.find(p => p.device_number === trackerId) || null;
      if (!targetParticipant) {
        throw new Error(`Ningún jugador está asignado al GPS #${trackerId} en este partido.`);
      }

      const pId = targetParticipant.id;
      setPlayerStatuses(prev => ({ ...prev, [pId]: { status: 'connecting' } }));
      setStatusText(`Conectando a tracker GPS #${trackerId} (${targetParticipant.user_name})...`);

      // 2. Connect GATT
      server = await device.gatt.connect();
      
      setPlayerStatuses(prev => ({ ...prev, [pId]: { status: 'downloading' } }));
      setStatusText(`Conectado. Solicitando descarga de datos...`);

      const service = await server.getPrimaryService(NUS_SERVICE_UUID);
      const rxChar = await service.getCharacteristic(NUS_RX_UUID);
      const txChar = await service.getCharacteristic(NUS_TX_UUID);

      let csvBuffer = '';
      let receivedStart = false;
      let receivedEnd = false;
      let lastDataTime = Date.now(); // se reinicia con cada chunk recibido

      // 3. Listen to Notifications
      await txChar.startNotifications();

      const onNotification = (event: any) => {
        const val = event.target.value;
        const decoder = new TextDecoder();
        const chunk = decoder.decode(val);
        csvBuffer += chunk;
        lastDataTime = Date.now(); // hay datos frescos: reinicia el reloj de inactividad

        // Con datos ya empezando a llegar, marcamos inicio.
        if (csvBuffer.length > 0) {
          receivedStart = true;
        }
        // El firmware nuevo envía el CSV pelado (sin marcadores). Mantenemos
        // compatibilidad: si un tracker viejo aún manda ---END_CSV---, lo
        // tratamos como fin inmediato.
        if (csvBuffer.includes('---END_CSV---')) {
          receivedEnd = true;
          setDownloadProgress(100);
        } else {
          // Estimate progress based on buffer size growth (arbitrary maximum size to show movement)
          const estProgress = Math.min(95, Math.round((csvBuffer.length / 15000) * 100));
          setDownloadProgress(estProgress);
        }
      };

      txChar.addEventListener('characteristicvaluechanged', onNotification);

      // 4. Send "DESCARGAR" command
      const encoder = new TextEncoder();
      const cmdBytes = encoder.encode("DESCARGAR\n");
      await rxChar.writeValue(cmdBytes);

      // Esperar el CSV completo. En vez de un tope fijo (que trunca archivos
      // grandes), usamos un timeout POR INACTIVIDAD: mientras sigan llegando
      // chunks, seguimos esperando. Solo cortamos si pasan IDLE_TIMEOUT ms sin
      // recibir nada (descarga terminada sin marcador o conexión estancada).
      const IDLE_TIMEOUT = 8000;   // ms sin datos nuevos = fin/tiempo agotado
      const HARD_CAP = 300000;     // tope absoluto de seguridad (5 min)
      const startTime = Date.now();
      while (
        !receivedEnd &&
        Date.now() - lastDataTime < IDLE_TIMEOUT &&
        Date.now() - startTime < HARD_CAP
      ) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      txChar.removeEventListener('characteristicvaluechanged', onNotification);

      // El fin se detecta por inactividad (firmware nuevo, CSV pelado) o por el
      // marcador ---END_CSV--- (compatibilidad con firmware antiguo). Si no llegó
      // nada de nada, es que el tracker no respondió.
      if (!receivedStart || csvBuffer.length === 0) {
        throw new Error("Tiempo de espera agotado: el tracker no envió datos.");
      }
      setDownloadProgress(100);

      // 5. Parse Data
      setPlayerStatuses(prev => ({ ...prev, [pId]: { status: 'saving' } }));
      setStatusText(`Guardando trayecto de ${targetParticipant.user_name} en Supabase...`);

      // Extraer el CSV. Si vienen marcadores antiguos, recortar entre ellos;
      // si no (firmware nuevo), usar el buffer entero.
      let csvData = csvBuffer;
      const startIndex = csvBuffer.indexOf('---START_CSV---');
      const endIndex = csvBuffer.indexOf('---END_CSV---');
      if (startIndex !== -1 && endIndex !== -1) {
        csvData = csvBuffer.substring(startIndex + 15, endIndex);
      } else if (startIndex !== -1) {
        csvData = csvBuffer.substring(startIndex + 15);
      }
      csvData = csvData.trim();

      const points = parseCSV(csvData);
      if (points.length === 0) {
        throw new Error("El archivo GPS no contiene puntos válidos.");
      }

      // 6. Save to Supabase
      const trackData = {
        match_id: matchId,
        participant_id: targetParticipant.id,
        user_id: targetParticipant.user_id,
        player_name: targetParticipant.user_name,
        points: points
      };

      await saveGPSTrack(trackData, fromTable);

      setPlayerStatuses(prev => ({ ...prev, [pId]: { status: 'completed' } }));
      setStatusText(`¡GPS #${trackerId} de ${targetParticipant.user_name} sincronizado con éxito!`);
      await loadUploadedTracks();
      if (onSyncSuccess) onSyncSuccess();

    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || 'Error desconocido al sincronizar.';
      if (targetParticipant) {
        setPlayerStatuses(prev => ({ ...prev, [targetParticipant!.id]: { status: 'failed', error: errMsg } }));
      }
      setStatusText(`Fallo al sincronizar: ${errMsg}`);
    } finally {
      // Disconnect
      if (device && device.gatt.connected) {
        try {
          await device.gatt.disconnect();
        } catch {}
      }
      setSyncing(false);
      setDownloadProgress(0);
    }
  };

  const handleEraseTracker = async (p: Participant) => {
    if (Platform.OS !== 'web') {
      showAlert('Web Bluetooth', 'El borrado de memoria del GPS está disponible únicamente desde la versión Web del navegador (Chrome/Edge/Opera).');
      return;
    }

    if (!(navigator as any).bluetooth) {
      showAlert('No Soportado', 'Tu navegador no soporta la API Web Bluetooth. Utiliza Google Chrome.');
      return;
    }

    setSyncing(true);
    setStatusText(`Buscando y conectando a tracker GPS #${p.device_number}...`);

    let device: any = null;
    let server: any = null;

    const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write

    try {
      device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          { name: `AmicSport_Tracker_${p.device_number}` },
          { name: `AmicSport_${p.device_number}` }
        ],
        optionalServices: [NUS_SERVICE_UUID]
      });

      setStatusText(`Conectando a GPS #${p.device_number}...`);
      server = await device.gatt.connect();

      setStatusText(`Conectado. Enviando comando de borrado (BORRAR)...`);
      const service = await server.getPrimaryService(NUS_SERVICE_UUID);
      const rxChar = await service.getCharacteristic(NUS_RX_UUID);

      const encoder = new TextEncoder();
      const eraseBytes = encoder.encode("BORRAR\n");
      await rxChar.writeValue(eraseBytes);

      await new Promise(resolve => setTimeout(resolve, 1000));
      setStatusText(`¡Memoria del GPS #${p.device_number} de ${p.user_name} borrada con éxito!`);
      showAlert('Éxito', `Memoria del GPS #${p.device_number} de ${p.user_name} borrada con éxito.`);
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || 'Error al borrar el tracker.';
      setStatusText(`Fallo al borrar: ${errMsg}`);
      showAlert('Error', `No se pudo borrar la memoria del tracker: ${errMsg}`);
    } finally {
      if (device && device.gatt.connected) {
        try {
          await device.gatt.disconnect();
        } catch {}
      }
      setSyncing(false);
    }
  };

  const handleToggleGPS = async (p: Participant, start: boolean) => {
    if (Platform.OS !== 'web') {
      showAlert('Web Bluetooth', 'El control del GPS está disponible únicamente desde la versión Web del navegador (Chrome/Edge/Opera).');
      return;
    }

    if (!(navigator as any).bluetooth) {
      showAlert('No Soportado', 'Tu navegador no soporta la API Web Bluetooth. Utiliza Google Chrome.');
      return;
    }

    setSyncing(true);
    const actionName = start ? 'Iniciar' : 'Detener';
    setStatusText(`Conectando a tracker GPS #${p.device_number} para ${actionName.toLowerCase()}...`);

    let device: any = null;
    let server: any = null;

    const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write

    try {
      device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          { name: `AmicSport_Tracker_${p.device_number}` },
          { name: `AmicSport_${p.device_number}` }
        ],
        optionalServices: [NUS_SERVICE_UUID]
      });

      setStatusText(`Conectando a GPS #${p.device_number}...`);
      server = await device.gatt.connect();

      setStatusText(`Conectado. Enviando comando (${start ? 'INICIAR' : 'PARAR'})...`);
      const service = await server.getPrimaryService(NUS_SERVICE_UUID);
      const rxChar = await service.getCharacteristic(NUS_RX_UUID);

      const encoder = new TextEncoder();
      const cmdBytes = encoder.encode(start ? "INICIAR\n" : "PARAR\n");
      await rxChar.writeValue(cmdBytes);

      await new Promise(resolve => setTimeout(resolve, 1000));
      setStatusText(`¡Comando enviado a GPS #${p.device_number} con éxito!`);
      showAlert('Éxito', `La grabación del GPS #${p.device_number} de ${p.user_name} ha sido ${start ? 'iniciada' : 'detenida'} con éxito.`);
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || 'Error al enviar comando.';
      setStatusText(`Fallo al enviar comando: ${errMsg}`);
      showAlert('Error', `No se pudo enviar el comando al tracker: ${errMsg}`);
    } finally {
      if (device && device.gatt.connected) {
        try {
          await device.gatt.disconnect();
        } catch {}
      }
      setSyncing(false);
    }
  };

  const handleDeleteDatabaseTrack = async (p: Participant) => {
    try {
      setSyncing(true);
      setStatusText(`Borrando trayectoria de ${p.user_name} de Supabase...`);
      await deleteGPSTrackByParticipant(matchId, p.id, fromTable);
      setStatusText(`Trayectoria de Supabase eliminada.`);
      await loadUploadedTracks();
      if (onSyncSuccess) onSyncSuccess();
      showAlert('Éxito', `Datos GPS de ${p.user_name} eliminados de la base de datos.`);
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || 'Error al borrar de Supabase.';
      setStatusText(`Fallo al borrar DB: ${errMsg}`);
      showAlert('Error', `No se pudo borrar de Supabase: ${errMsg}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Modal visible={visible} transparent={true} animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.content}>
          
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="bluetooth" size={24} color="#17713A" />
              <Text style={styles.title}>Sincronizar Trackers GPS</Text>
            </View>
            <TouchableOpacity onPress={onClose} disabled={syncing}>
              <Ionicons name="close" size={28} color={COLORS.TEXT_LIGHT} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Conéctate a cada tracker vía Bluetooth para descargar la sesión y subirla a Supabase. Puedes borrar la memoria del tracker o sus datos de la base de datos de manera manual con los botones correspondientes.
          </Text>

          <ScrollView style={styles.playerList} contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
            {assignedPlayers.length === 0 ? (
              <Text style={styles.emptyText}>No hay trackers asignados a ningún jugador todavía en este partido.</Text>
            ) : (
              assignedPlayers.map(p => {
                const playerState = playerStatuses[p.id] || { status: 'pending' };
                const hasUploadedData = uploadedTrackParticipantIds.includes(p.id);
                return (
                  <View key={p.id} style={styles.playerCard}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.playerInfo}>
                        <View style={styles.badgeId}>
                          <Text style={styles.badgeText}>GPS {p.device_number}</Text>
                        </View>
                        <Text style={styles.playerName} numberOfLines={1}>{p.user_name}</Text>
                      </View>
                      
                      {/* Action buttons row */}
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'center' }}>
                        {hasUploadedData && (
                          <TouchableOpacity
                            onPress={() => handleDeleteDatabaseTrack(p)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              backgroundColor: '#FADFD6',
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              borderRadius: 0,
                              gap: 4
                            }}
                          >
                            <Ionicons name="trash-outline" size={14} color={COLORS.DANGER} />
                            <Text style={{ fontSize: 11, fontFamily: FONTS.BOLD, color: COLORS.DANGER }}>Borrar DB</Text>
                          </TouchableOpacity>
                        )}
                        
                        <TouchableOpacity
                          onPress={() => handleEraseTracker(p)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: '#FFEFC2',
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 0,
                            gap: 4
                          }}
                        >
                          <Ionicons name="bluetooth-outline" size={14} color="#D97706" />
                          <Text style={{ fontSize: 11, fontFamily: FONTS.BOLD, color: '#D97706' }}>Borrar GPS</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => handleToggleGPS(p, true)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: '#E1EDDA',
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 0,
                            gap: 4
                          }}
                        >
                          <Ionicons name="play-outline" size={14} color="#15803D" />
                          <Text style={{ fontSize: 11, fontFamily: FONTS.BOLD, color: '#15803D' }}>Iniciar GPS</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => handleToggleGPS(p, false)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: '#FADFD6',
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 0,
                            gap: 4
                          }}
                        >
                          <Ionicons name="stop-outline" size={14} color="#B91C1C" />
                          <Text style={{ fontSize: 11, fontFamily: FONTS.BOLD, color: '#B91C1C' }}>Parar GPS</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    
                    <View style={styles.statusSection}>
                      {playerState.status === 'pending' && (
                        <View style={[styles.statusBadge, { backgroundColor: '#EFF2E4' }]}>
                          <Text style={[styles.statusTextBadge, { color: '#4A6353' }]}>Pendiente</Text>
                        </View>
                      )}
                      {playerState.status === 'connecting' && (
                        <View style={[styles.statusBadge, { backgroundColor: '#DEEDEF' }]}>
                          <ActivityIndicator size="small" color="#16606B" style={{ marginRight: 4 }} />
                          <Text style={[styles.statusTextBadge, { color: '#16606B' }]}>Conectando</Text>
                        </View>
                      )}
                      {playerState.status === 'downloading' && (
                        <View style={[styles.statusBadge, { backgroundColor: '#FFEFC2' }]}>
                          <ActivityIndicator size="small" color="#D97706" style={{ marginRight: 4 }} />
                          <Text style={[styles.statusTextBadge, { color: '#D97706' }]}>Descargando</Text>
                        </View>
                      )}
                      {playerState.status === 'saving' && (
                        <View style={[styles.statusBadge, { backgroundColor: '#FAF5FF' }]}>
                          <ActivityIndicator size="small" color="#9333EA" style={{ marginRight: 4 }} />
                          <Text style={[styles.statusTextBadge, { color: '#9333EA' }]}>Guardando</Text>
                        </View>
                      )}
                      {playerState.status === 'completed' && (
                        <View style={[styles.statusBadge, { backgroundColor: '#E1EDDA' }]}>
                          <Ionicons name="checkmark-circle" size={16} color={COLORS.SUCCESS} style={{ marginRight: 4 }} />
                          <Text style={[styles.statusTextBadge, { color: COLORS.SUCCESS }]}>Listo</Text>
                        </View>
                      )}
                      {playerState.status === 'failed' && (
                        <View style={[styles.statusBadge, { backgroundColor: '#FADFD6' }]}>
                          <Ionicons name="alert-circle" size={16} color={COLORS.DANGER} style={{ marginRight: 4 }} />
                          <Text style={[styles.statusTextBadge, { color: COLORS.DANGER }]}>Error</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {syncing && (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>{statusText}</Text>
              {downloadProgress > 0 && downloadProgress < 100 && (
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${downloadProgress}%` }]} />
                </View>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[styles.syncButton, syncing && { backgroundColor: COLORS.BORDER }]}
            onPress={handleSyncNext}
            disabled={syncing || assignedPlayers.length === 0}
          >
            {syncing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="bluetooth" size={20} color="#FFFFFF" />
                <Text style={styles.syncButtonText}>Sincronizar Tracker</Text>
              </>
            )}
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  content: { backgroundColor: COLORS.BACKGROUND, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, height: '75%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  subtitle: { fontSize: 13, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MUTED, marginBottom: 20, lineHeight: 18 },
  playerList: { flex: 1, marginBottom: 16 },
  emptyText: { textAlign: 'center', color: COLORS.TEXT_MUTED, fontSize: 14, marginTop: 40, fontFamily: FONTS.REGULAR },
  playerCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: COLORS.CARD_BG, borderRadius: 0, borderWidth: 1, borderColor: COLORS.BORDER },
  playerInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  badgeId: { backgroundColor: '#EFF2E4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 0, borderWidth: 1, borderColor: '#DDE3CE' },
  badgeText: { fontSize: 11, fontFamily: FONTS.BOLD, color: '#4A6353' },
  playerName: { fontSize: 15, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MAIN, flex: 1 },
  statusSection: { flexDirection: 'row', alignItems: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 0 },
  statusTextBadge: { fontSize: 12, fontFamily: FONTS.BOLD },
  progressContainer: { backgroundColor: '#FAFBF4', padding: 12, borderRadius: 0, marginBottom: 16, borderWidth: 1, borderColor: '#DDE3CE' },
  progressText: { fontSize: 13, fontFamily: FONTS.SEMI_BOLD, color: '#4A6353', marginBottom: 6 },
  progressBarBg: { height: 6, backgroundColor: '#DDE3CE', borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#17713A' },
  syncButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#17713A', paddingVertical: 14, borderRadius: 0, ...(SHADOWS.MEDIUM as any) },
  syncButtonText: { color: '#FFFFFF', fontFamily: FONTS.BOLD, fontSize: 16 }
});
